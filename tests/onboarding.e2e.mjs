import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const stateRoot = await mkdtemp(join(tmpdir(), 'responsiver-onboarding-e2e-'))
const userDataRoot = join(stateRoot, 'user-data')
const screenshotRoot = join(root, 'output', 'playwright')
const pageErrors = []
await Promise.all([mkdir(userDataRoot, { recursive: true }), mkdir(screenshotRoot, { recursive: true })])

async function launchResponsiver() {
  let application = null
  try {
    application = await electron.launch({
      executablePath: electronPath,
      args: [root],
      env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userDataRoot },
      timeout: 30_000
    })
    const page = await application.firstWindow({ timeout: 45_000 })
    page.setDefaultTimeout(12_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    return { application, page }
  } catch (error) {
    await application?.close().catch(() => undefined)
    throw error
  }
}

let running = null
try {
  running = await launchResponsiver()
  let { application, page } = running
  let dialog = page.getByRole('dialog', { name: 'Prise en main de Responsiver' })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.match((await dialog.locator('.onboarding-topbar').textContent()) ?? '', /ÉTAPE 01 \/ 06/)
  assert.equal(await page.locator('.nav-rail').getAttribute('aria-hidden'), 'true')
  assert.equal(await page.locator('.nav-rail').evaluate((element) => element.inert), true)
  assert.equal(await page.locator('.app-main').evaluate((element) => element.inert), true)

  const firstStepButton = dialog.getByRole('button', { name: /Étape 1 sur 6/ })
  await firstStepButton.focus()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog.getByRole('button', { name: 'Continuer' }).evaluate((element) => document.activeElement === element), true)
  await page.keyboard.press('Tab')
  assert.equal(await firstStepButton.evaluate((element) => document.activeElement === element), true)

  await dialog.getByRole('button', { name: 'Continuer' }).click()
  assert.match((await dialog.locator('.onboarding-topbar').textContent()) ?? '', /ÉTAPE 02 \/ 06/)
  await page.keyboard.press('ArrowLeft')
  assert.match((await dialog.locator('.onboarding-topbar').textContent()) ?? '', /ÉTAPE 01 \/ 06/)
  await dialog.getByRole('button', { name: /Étape 4 sur 6/ }).click()
  assert.match((await dialog.locator('.onboarding-topbar').textContent()) ?? '', /ÉTAPE 04 \/ 06/)
  assert.equal(await dialog.getByRole('button', { name: /Étape 4 sur 6/ }).getAttribute('aria-current'), 'step')
  await page.screenshot({ path: join(screenshotRoot, 'onboarding-desktop.png'), animations: 'disabled' })

  await dialog.getByRole('button', { name: /Étape 1 sur 6/ }).click()
  await dialog.getByRole('checkbox', { name: 'Ne plus afficher au démarrage' }).check()
  await dialog.getByRole('button', { name: 'Passer pour le moment' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Ouvrir')
  assert.equal(await page.locator('.nav-rail').getAttribute('aria-hidden'), null)
  assert.equal(await page.locator('.nav-rail').evaluate((element) => element.inert), false)
  await application.close()
  running = null
  console.log('E2E · guide automatique, pagination et masquage persistant')

  running = await launchResponsiver()
  ;({ application, page } = running)
  await page.locator('.projects-page').waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('dialog', { name: 'Prise en main de Responsiver' }).count(), 0)
  const guideTrigger = page.getByRole('button', { name: 'Ouvrir le guide de prise en main' })
  await page.getByRole('button', { name: 'Replier le menu latéral' }).click()
  assert.equal(await guideTrigger.isVisible(), true)
  await guideTrigger.click()
  dialog = page.getByRole('dialog', { name: 'Prise en main de Responsiver' })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.getByRole('checkbox', { name: 'Ne plus afficher au démarrage' }).isChecked(), true)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ouvrir le guide de prise en main')

  await guideTrigger.click()
  dialog = page.getByRole('dialog', { name: 'Prise en main de Responsiver' })
  await dialog.getByRole('checkbox', { name: 'Ne plus afficher au démarrage' }).uncheck()
  await dialog.getByRole('button', { name: 'Fermer le guide' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await application.close()
  running = null
  console.log('E2E · relance depuis le rail, restitution du focus et réactivation')

  running = await launchResponsiver()
  ;({ application, page } = running)
  dialog = page.getByRole('dialog', { name: 'Prise en main de Responsiver' })
  await dialog.waitFor({ state: 'visible' })
  await page.setViewportSize({ width: 390, height: 844 })
  const box = await dialog.boundingBox()
  assert.ok(box)
  assert.ok(box.x >= 0 && box.y >= 0)
  assert.ok(box.x + box.width <= 390.5 && box.y + box.height <= 844.5)
  for (const locator of [
    dialog.getByRole('button', { name: /Étape 1 sur 6/ }),
    dialog.getByRole('button', { name: 'Fermer le guide' }),
    dialog.getByRole('button', { name: 'Passer pour le moment' }),
    dialog.getByRole('button', { name: 'Continuer' }),
    dialog.locator('.onboarding-preference')
  ]) {
    const targetBox = await locator.boundingBox()
    assert.ok(targetBox && targetBox.height >= 44, `Cible tactile trop petite : ${targetBox?.height ?? 0}px.`)
  }
  await page.screenshot({ path: join(screenshotRoot, 'onboarding-mobile.png'), animations: 'disabled' })
  for (let index = 0; index < 5; index += 1) await dialog.getByRole('button', { name: 'Continuer' }).click()
  assert.match((await dialog.locator('.onboarding-topbar').textContent()) ?? '', /ÉTAPE 06 \/ 06/)
  await dialog.getByRole('button', { name: 'Terminer le guide' }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: 'Ouvrir le guide de prise en main' }).isVisible(), true)
  assert.deepEqual(pageErrors, [])
  console.log('E2E · réaffichage au lancement, responsive mobile et fin de visite')
} finally {
  if (running) await running.application.close().catch(() => undefined)
  await rm(stateRoot, { recursive: true, force: true })
}
