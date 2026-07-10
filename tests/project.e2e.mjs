import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const projectPath = process.argv[2]
if (!projectPath) throw new Error('Usage : npm run test:project -- /chemin/du/projet')

const root = fileURLToPath(new URL('..', import.meta.url))
const expectedName = basename(resolve(projectPath))
const application = await electron.launch({ executablePath: electronPath, args: [root], timeout: 30_000 })

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(20_000)
  await page.getByLabel('Chemin local').fill(resolve(projectPath))
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.locator('.project-identity').getByText(expectedName, { exact: true }).waitFor()
  await page.locator('iframe').first().waitFor({ state: 'visible' })

  assert.equal(await page.locator('.browser-bar select').inputValue(), '/index.html')
  const routes = await page.locator('.browser-bar select option').allTextContents()
  assert.ok(routes.length >= 1)
  assert.ok(routes.some((route) => route === 'index.html'))

  const previewTitle = await page.frameLocator('iframe').first().locator('title').textContent()
  assert.ok(previewTitle?.trim())
  const projectFrame = page.frameLocator('iframe').first()
  await projectFrame.locator('body').waitFor({ state: 'attached' })
  const preloader = projectFrame.locator('#preloader')
  if (await preloader.count()) await preloader.waitFor({ state: 'hidden' })

  const aboutLink = projectFrame.getByRole('link', { name: 'À propos', exact: true })
  if (await aboutLink.count()) {
    await aboutLink.evaluate((link) => link.click())
    await page.waitForFunction(() => document.querySelector('.browser-bar code')?.textContent?.includes('#manifesto'))
  }

  const activeRouteLabels = await page.locator('.issue-item small').allTextContents()
  assert.ok(activeRouteLabels.every((label) => label === '/index.html' || !label.startsWith('/')))

  await page.getByRole('tab', { name: 'Thème' }).click()
  await page.getByText('Thème sombre détecté').waitFor()
  const lightTheme = page.getByRole('radio', { name: /Clair/ })
  assert.equal(await lightTheme.isChecked(), false)
  await lightTheme.check()
  await page.locator('.proposal-decision').filter({ hasText: 'Variante claire' }).waitFor({ state: 'visible' })
  assert.match(await page.locator('.proposal-decision').textContent(), /Aperçu non validé/)
  await page.frameLocator('.stage-canvas iframe').first().locator('html[data-responsiver-generated-theme="light"]').waitFor({ state: 'attached' })

  await page.getByRole('tab', { name: /Constats/ }).click()
  const externalNotice = page.locator('.issue-item').filter({ hasText: 'Ressource externe indisponible' })
  if (await externalNotice.count()) {
    await externalNotice.first().click()
    await projectFrame.locator('body').waitFor({ state: 'attached' })
    if (await preloader.count()) await preloader.waitFor({ state: 'hidden' })
  }

  const output = join(root, 'output', 'playwright')
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, 'project-e2e.png'), fullPage: true })
  process.stdout.write(`E2E projet : ${expectedName}, ${routes.length} route(s), thème sombre et preview locale — OK\n`)
} finally {
  await application.close()
}
