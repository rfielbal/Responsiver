import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const state = await mkdtemp(join(tmpdir(), 'responsiver-visual-e2e-'))
const userData = join(state, 'user-data')
const projectRoot = join(state, 'project')
await mkdir(userData, { recursive: true })
await cp(join(root, 'demo', 'atelier'), projectRoot, { recursive: true })
const application = await electron.launch({ executablePath: electronPath, args: [root], env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userData }, timeout: 30_000 })

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(12_000)
  await page.waitForLoadState('domcontentloaded')
  await page.getByLabel('Chemin local').fill(projectRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  await page.evaluate(() => {
    Object.assign(window, { __responsiverVisualMessages: [] })
    window.addEventListener('message', (event) => {
      const message = event.data
      if (message?.channel === 'responsiver-preview' && String(message.type).startsWith('inspector-')) window.__responsiverVisualMessages.push(message)
    })
  })
  await page.frameLocator('.stage-canvas iframe').first().locator('body').press('F12')
  await page.waitForFunction(() => document.querySelector('.stage-inspect')?.getAttribute('aria-pressed') === 'true')
  await page.waitForTimeout(250)
  const target = page.frameLocator('.stage-canvas iframe').first().locator('.site-nav')
  await target.hover({ position: { x: 2, y: 2 } })
  await target.click({ position: { x: 2, y: 2 } })
  await page.waitForTimeout(250)
  const messages = await page.evaluate(() => window.__responsiverVisualMessages)
  assert.ok(messages.some((message) => message.type === 'inspector-started'), JSON.stringify(messages))
  assert.ok(messages.some((message) => message.type === 'inspector-selected'), JSON.stringify(messages))
  await page.locator('.quick-inspector code').filter({ hasText: 'site-nav' }).waitFor({ state: 'visible' })
  await page.locator('.quick-inspector').getByRole('button', { name: 'Modifier dans l’Atelier' }).click()
  await page.locator('.visual-editor-page').waitFor({ state: 'visible' })
  assert.match(await page.locator('.visual-target-card code').textContent(), /site-nav/)
  const gapField = page.locator('.visual-control-scroll details').filter({ hasText: 'Mise en page' }).locator('label').filter({ hasText: 'Espacement' }).locator('input')
  await gapField.fill('24px')
  await gapField.press('Enter')
  await page.waitForFunction(() => document.querySelector('.visual-change-count')?.textContent === '1')
  await page.getByRole('button', { name: 'Appliquer au projet' }).click()
  await page.locator('.toast').filter({ hasText: 'ajustement visuel appliqué' }).waitFor({ state: 'visible' })
  const generatedCss = await readFile(join(projectRoot, '.responsiver', 'responsiver.generated.css'), 'utf8')
  const appliedState = await page.frameLocator('.stage-canvas iframe').first().locator('html').evaluate(async () => {
    const route = document.documentElement.getAttribute('data-responsiver-route')
    const selector = `html[data-responsiver-route="${route}"] > body > header.site-header > nav.site-nav`
    return {
      route,
      width: innerWidth,
      media: matchMedia('(max-width: 767px)').matches,
      selectorMatches: document.querySelectorAll(selector).length,
      gap: getComputedStyle(document.querySelector('.site-nav')).gap,
      sheets: [...document.styleSheets].map((sheet) => sheet.href || 'inline'),
      fetchedCss: await fetch('/.responsiver/responsiver.generated.css').then((response) => response.text())
    }
  })
  assert.ok(appliedState.route, JSON.stringify(appliedState))
  assert.ok(appliedState.width <= 767, JSON.stringify(appliedState))
  assert.match(appliedState.fetchedCss, /gap: 24px !important/)
  assert.equal(appliedState.gap, '24px', JSON.stringify({ ...appliedState, generatedCss }))
  assert.match(generatedCss, /gap: 24px !important/)
  console.log('E2E visuel · F12, sélection, application route-scopée et rendu réel — OK')
} finally {
  await application.close()
  await rm(state, { recursive: true, force: true })
}
