import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const demoRoot = join(root, 'demo', 'atelier')
const packaged = process.argv.includes('--packaged')
const applicationExecutable = packaged
  ? join(root, 'dist', 'mac-arm64', 'Responsiver.app', 'Contents', 'MacOS', 'Responsiver')
  : electronPath
const sourceHtmlBefore = await readFile(join(demoRoot, 'index.html'), 'utf8')
const sourceCssBefore = await readFile(join(demoRoot, 'styles.css'), 'utf8')
const pageErrors = []

const application = await electron.launch({
  executablePath: applicationExecutable,
  args: packaged ? [] : [root],
  timeout: 30_000
})

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(10_000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')

  await page.getByRole('button', { name: 'Ouvrir la démo locale' }).click()
  await page.locator('iframe').first().waitFor({ state: 'visible' })
  console.log('E2E · démo ouverte')
  const sourceOrigin = new URL(await page.locator('iframe').first().getAttribute('src')).origin

  await page.frameLocator('iframe').first().getByRole('link', { name: 'Journal', exact: true }).evaluate((link) => link.click())
  await page.locator('.browser-bar select').waitFor()
  await page.waitForFunction(() => document.querySelector('.browser-bar select')?.value === '/journal.html')
  assert.equal(await page.locator('.browser-bar select').inputValue(), '/journal.html')
  assert.equal(await page.locator('.issue-item').count(), 2)
  console.log('E2E · navigation journal synchronisée')

  await page.locator('.issue-item').filter({ hasText: 'Largeur minimale rigide' }).click()
  await page.getByRole('button', { name: 'Retenir ce correctif' }).click()
  console.log('E2E · deux correctifs retenus')
  await page.locator('.issue-item').filter({ hasText: 'Texte forcé sur une ligne' }).click()
  await page.getByRole('button', { name: 'Retenir ce correctif' }).click()

  await page.getByRole('tab', { name: 'Thème' }).click()
  await page.getByText('Thème sombre détecté').waitFor()
  const lightTheme = page.getByRole('radio', { name: /Clair/ })
  if (!(await lightTheme.isChecked())) await lightTheme.check()
  assert.equal(await lightTheme.isChecked(), true)
  console.log('E2E · thème sombre détecté, variante claire sélectionnée')

  await page.getByRole('tab', { name: /Correctifs/ }).click()
  assert.equal(await page.locator('.fix-list article').count(), 2)
  await page.getByRole('button', { name: 'Construire le staging' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /Staging/ }).waitFor({ state: 'visible' })
  console.log('E2E · staging construit')

  await page.getByRole('button', { name: 'Révision' }).click()
  const firstPatch = await page.locator('.diff-panel pre').textContent()
  console.log('E2E · patch contient le thème', firstPatch.includes('data-responsiver-generated-theme'))
  await page.getByRole('button', { name: 'Laboratoire' }).click()
  await page.locator('iframe').first().waitFor({ state: 'visible' })

  const stagedFrame = page.locator('iframe').first()
  await page.waitForFunction((origin) => {
    const frame = document.querySelector('iframe')
    return Boolean(frame?.src && new URL(frame.src).origin !== origin)
  }, sourceOrigin)
  const stagedOrigin = new URL(await stagedFrame.getAttribute('src')).origin
  assert.notEqual(stagedOrigin, sourceOrigin)

  const stagingDocument = page.frameLocator('iframe').first()
  console.log('E2E · iframe staging', await stagedFrame.getAttribute('src'))
  console.log('E2E · attribut thème', await stagingDocument.locator('html').getAttribute('data-responsiver-generated-theme'))
  await stagingDocument.locator('html[data-responsiver-generated-theme="light"]').waitFor({ state: 'attached' })
  assert.equal(await stagingDocument.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor), 'rgb(244, 242, 236)')
  assert.equal(await stagingDocument.locator('html').evaluate((html) => html.scrollWidth <= html.clientWidth + 1), true)
  console.log('E2E · thème clair et largeur validés')

  await stagingDocument.getByRole('link', { name: 'Collection' }).first().evaluate((link) => link.click())
  await page.waitForFunction(() => document.querySelector('.browser-bar select')?.value === '/index.html')
  await page.frameLocator('iframe').first().locator('html[data-responsiver-generated-theme="light"]').waitFor({ state: 'attached' })
  console.log('E2E · thème multi-page validé')

  await page.getByRole('tab', { name: 'Conversation' }).click()
  await page.getByLabel('Nouvel ajustement').fill('Mets les angles droits sur les composants')
  await page.getByRole('button', { name: 'Appliquer' }).click()
  await page.locator('.message--system').filter({ hasText: 'Ajustement interprété' }).waitFor()
  await page.frameLocator('iframe').first().locator('html[data-responsiver-generated-instructions]').waitFor({ state: 'attached' })
  console.log('E2E · conversation locale validée')

  await page.getByRole('button', { name: 'Comparer' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.comparison-grid iframe').length === 3)
  console.log('E2E · comparaison trois appareils validée')

  await page.getByRole('button', { name: 'Révision' }).click()
  await page.locator('.visual-comparison').waitFor()
  assert.equal(await page.locator('.visual-comparison iframe').count(), 2)
  assert.match(await page.locator('.diff-panel pre').textContent(), /responsiver\.generated/)
  console.log('E2E · révision et patch validés')

  await page.getByRole('button', { name: 'Exporter' }).click()
  await page.locator('.export-readiness.is-ready').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Copier', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Exporter une copie' }).isEnabled(), true)

  await page.screenshot({ path: join(root, 'output', 'playwright', 'electron-e2e.png'), fullPage: true })
  assert.equal(await readFile(join(demoRoot, 'index.html'), 'utf8'), sourceHtmlBefore)
  assert.equal(await readFile(join(demoRoot, 'styles.css'), 'utf8'), sourceCssBefore)
  assert.deepEqual(pageErrors, [])
  process.stdout.write('E2E Electron : démo, navigation, staging, thème, conversation, comparaison et export — OK\n')
} finally {
  await application.close()
}
