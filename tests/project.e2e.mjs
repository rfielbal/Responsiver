import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const projectPath = process.argv[2]
if (!projectPath) throw new Error('Usage : npm run test:project -- /chemin/du/projet')

const root = fileURLToPath(new URL('..', import.meta.url))
const selectedName = basename(resolve(projectPath))
const testStateRoot = await mkdtemp(join(tmpdir(), 'responsiver-project-e2e-'))
const application = await electron.launch({ executablePath: electronPath, args: [root], env: { ...process.env, RESPONSIVER_USER_DATA_DIR: testStateRoot }, timeout: 30_000 })

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(20_000)
  await page.getByLabel('Chemin local').fill(resolve(projectPath))
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.waitForFunction(() => {
    const name = document.querySelector('.project-identity strong')?.textContent?.trim()
    return Boolean(name && name !== 'Aucun projet ouvert')
  })
  const projectName = (await page.locator('.project-identity strong').textContent())?.trim() || selectedName
  const output = join(root, 'output', 'playwright')
  await mkdir(output, { recursive: true })
  const result = await Promise.race([
    page.locator('.readiness-card').waitFor({ state: 'visible' }).then(() => 'blocked'),
    page.locator('iframe').first().waitFor({ state: 'visible' }).then(() => 'ready')
  ])

  if (result === 'blocked') {
    const diagnostic = await page.locator('.readiness-card').textContent()
    assert.match(diagnostic, /Rendu non exploitable|Aucun rendu exploitable|compilation|compiler|sources doivent être compilées/i)
    assert.equal(await page.locator('.workbench').count(), 0)
    assert.equal(await page.locator('iframe').count(), 0)
    await page.locator('.projects-page').screenshot({ path: join(output, 'project-e2e-blocked.png'), animations: 'disabled' })
    process.stdout.write(`E2E projet : ${projectName}, entrée diagnostiquée sans preview blanche — OK\n`)
  } else {
    const routeSelect = page.locator('.browser-bar select')
    const selectedRoute = await routeSelect.inputValue()
    const routeValues = await routeSelect.locator('option').evaluateAll((options) => options.map((option) => option.value))
    assert.ok(selectedRoute.startsWith('/'))
    assert.ok(routeValues.length >= 1)
    assert.ok(routeValues.includes(selectedRoute))

    const projectFrame = page.frameLocator('iframe').first()
    await projectFrame.locator('body').waitFor({ state: 'attached' })
    const preloader = projectFrame.locator('#preloader')
    if (await preloader.count()) await preloader.waitFor({ state: 'hidden' }).catch(() => undefined)

    await page.getByRole('tab', { name: 'Thème' }).click()
    await page.locator('.theme-diagnosis').waitFor({ state: 'visible' })
    const missingVariant = page.locator('.theme-options label:not(.is-existing) input').first()
    if (await missingVariant.count()) {
      if (await missingVariant.isDisabled()) {
        assert.match(await page.locator('.manual-review').filter({ hasText: 'Palette automatique indisponible' }).textContent(), /plutôt qu’un thème illisible/)
        assert.equal(await page.locator('.proposal-decision').count(), 0)
      } else {
        await missingVariant.check()
        const decision = page.locator('.proposal-decision')
        await decision.waitFor({ state: 'visible' })
        assert.match(await decision.textContent(), /Aperçu non validé/)
        assert.equal(await missingVariant.isChecked(), true)
      }
    } else {
      const nativeVariant = page.locator('.theme-options input').first()
      await nativeVariant.check()
      await page.locator('.native-theme-preview').waitFor({ state: 'visible' })
    }

    await page.getByRole('tab', { name: /Constats/ }).click()
    const externalNotice = page.locator('.issue-item').filter({ hasText: 'Ressource externe indisponible' })
    if (await externalNotice.count()) {
      await externalNotice.first().click()
      await projectFrame.locator('body').waitFor({ state: 'attached' })
    }

    await page.screenshot({ path: join(output, 'project-e2e.png'), fullPage: true })
    process.stdout.write(`E2E projet : ${projectName}, ${routeValues.length} route(s), preview et thèmes locaux — OK\n`)
  }
} finally {
  await application.close()
  await rm(testStateRoot, { recursive: true, force: true })
}
