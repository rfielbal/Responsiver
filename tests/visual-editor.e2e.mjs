import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { dismissOnboardingIfPresent } from './helpers/onboarding.mjs'

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
  await dismissOnboardingIfPresent(page)
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
  const composer = page.getByRole('button', { name: 'Composer' })
  await composer.waitFor({ state: 'visible' })
  assert.equal(await composer.getAttribute('aria-pressed'), 'true')
  const visualFrame = page.frameLocator('.visual-canvas iframe').first()
  await visualFrame.locator('[data-responsiver-composer-active]').waitFor({ state: 'attached' })
  await page.getByRole('button', { name: /Afficher à 100 %/ }).click()

  const privateFieldProbe = await visualFrame.locator('body').evaluate(() => {
    const input = document.createElement('input')
    input.value = 'secret-ne-jamais-transmettre'
    input.setAttribute('aria-label', 'mot de passe privé')
    document.body.append(input)
    Object.assign(window, { __responsiverComposerKeyEvents: 0 })
    window.addEventListener('keydown', () => { window.__responsiverComposerKeyEvents += 1 })
    return input.value
  })
  assert.equal(privateFieldProbe, 'secret-ne-jamais-transmettre')
  await visualFrame.locator('body').evaluate(() => parent.postMessage({
    channel: 'responsiver-preview',
    type: 'design-commit',
    protocol: 1,
    sessionId: 'forged',
    documentId: 'forged',
    revision: 1,
    gestureId: 'forged',
    kind: 'move',
    strategy: 'flow-translate',
    mutations: []
  }, '*'))
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.visual-change-count').textContent(), '0')

  const heroCopy = visualFrame.locator('.hero-copy')
  // Ce scénario couvre volontairement le déplacement dans un flux block ;
  // la réorganisation Flex/Grid possède sa propre stratégie atomique.
  await heroCopy.evaluate((element) => { if (element.parentElement) element.parentElement.style.display = 'block' })
  await heroCopy.scrollIntoViewIfNeeded()
  const moveBox = await heroCopy.boundingBox()
  assert.ok(moveBox)
  const moveStart = { x: moveBox.x + moveBox.width / 2, y: moveBox.y + moveBox.height / 2 }
  await page.mouse.move(moveStart.x, moveStart.y)
  await page.mouse.down()
  await page.mouse.move(moveStart.x + 34, moveStart.y + 18, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.visual-change-count')?.textContent === '1')
  const translated = await heroCopy.evaluate(async (element) => {
    for (let index = 0; index < 30; index += 1) {
      const value = getComputedStyle(element).translate
      if (value !== 'none') return value
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return getComputedStyle(element).translate
  })
  assert.notEqual(translated, 'none')
  await page.keyboard.press('Enter')
  assert.equal(await visualFrame.locator('body').evaluate(() => window.__responsiverComposerKeyEvents), 0)
  await heroCopy.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const widthBefore = await heroCopy.evaluate((element) => element.getBoundingClientRect().width)
  const eastHandle = visualFrame.locator('[data-responsiver-composer-handle="e"]')
  const handleRect = await eastHandle.evaluate((element) => element.getBoundingClientRect().toJSON())
  const iframeBox = await page.locator('.visual-canvas iframe').first().boundingBox()
  const frameViewport = await visualFrame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(iframeBox)
  const scaleX = iframeBox.width / frameViewport.width
  const scaleY = iframeBox.height / frameViewport.height
  const handlePoint = { x: iframeBox.x + Math.min(frameViewport.width - 3, handleRect.left + 3) * scaleX, y: iframeBox.y + (handleRect.top + handleRect.height / 2) * scaleY }
  await eastHandle.hover()
  await page.mouse.down()
  await page.mouse.move(handlePoint.x - 48 * scaleX, handlePoint.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => Number(document.querySelector('.visual-change-count')?.textContent) >= 2)
  const widthAfter = await heroCopy.evaluate(async (element, before) => {
    for (let index = 0; index < 30; index += 1) {
      const width = element.getBoundingClientRect().width
      if (width < before - 10) return width
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return element.getBoundingClientRect().width
  }, widthBefore)
  assert.ok(widthAfter < widthBefore - 10, JSON.stringify({ widthBefore, widthAfter }))

  const countBeforeTextHeight = Number(await page.locator('.visual-change-count').textContent())
  const southTextHandle = visualFrame.locator('[data-responsiver-composer-handle="s"]')
  const southTextRect = await southTextHandle.evaluate((element) => element.getBoundingClientRect().toJSON())
  const southTextPoint = { x: iframeBox.x + (southTextRect.left + southTextRect.width / 2) * scaleX, y: iframeBox.y + (southTextRect.top + southTextRect.height / 2) * scaleY }
  await southTextHandle.hover()
  await page.mouse.down()
  await page.mouse.move(southTextPoint.x, southTextPoint.y + 36 * scaleY, { steps: 8 })
  await page.mouse.up()
  await page.locator('.toast').filter({ hasText: 'hauteur d’un texte reste fluide' }).waitFor({ state: 'visible' })
  assert.equal(Number(await page.locator('.visual-change-count').textContent()), countBeforeTextHeight)

  await page.getByRole('button', { name: 'Annuler la dernière modification' }).click()
  await page.waitForFunction(() => document.querySelector('.visual-change-count')?.textContent === '1')
  const restoredWidth = await heroCopy.evaluate(async (element, expected) => {
    for (let index = 0; index < 30; index += 1) {
      const width = element.getBoundingClientRect().width
      if (Math.abs(width - expected) < 2) return width
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return element.getBoundingClientRect().width
  }, widthBefore)
  assert.ok(Math.abs(restoredWidth - widthBefore) < 2)
  await page.getByRole('button', { name: 'Rétablir la modification' }).click()
  await page.waitForFunction(() => Number(document.querySelector('.visual-change-count')?.textContent) >= 2)
  await page.locator('.visual-editor-page').screenshot({ path: join(root, 'output', 'playwright', 'electron-visual-composer.png'), animations: 'disabled' })

  const directTextProbe = visualFrame.locator('.composer-direct-text-probe')
  const imageProbe = visualFrame.locator('.composer-image-probe')
  await visualFrame.locator('.hero-copy').evaluate((element) => {
    const directText = document.createElement('div')
    directText.className = 'composer-direct-text-probe'
    directText.textContent = 'Texte direct protégé'
    directText.style.cssText = 'display:block;width:180px;margin:16px 0;'
    const image = document.createElement('img')
    image.className = 'composer-image-probe'
    image.alt = ''
    image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="%23d8c8b7"/></svg>'
    image.style.cssText = 'display:block;width:120px;height:auto;margin:16px 0;'
    element.after(directText, image)
  })
  await directTextProbe.waitFor({ state: 'visible' })
  await directTextProbe.scrollIntoViewIfNeeded()
  const directTextBox = await directTextProbe.boundingBox()
  assert.ok(directTextBox)
  await page.mouse.click(directTextBox.x + directTextBox.width / 2, directTextBox.y + directTextBox.height / 2)
  await page.locator('.visual-target-card code').filter({ hasText: 'composer-direct-text-probe' }).waitFor({ state: 'visible' })
  const directTextCount = Number(await page.locator('.visual-change-count').textContent())
  const southDirectTextHandle = visualFrame.locator('[data-responsiver-composer-handle="s"]')
  const southDirectTextRect = await southDirectTextHandle.evaluate((element) => element.getBoundingClientRect().toJSON())
  const southDirectTextPoint = { x: iframeBox.x + (southDirectTextRect.left + southDirectTextRect.width / 2) * scaleX, y: iframeBox.y + (southDirectTextRect.top + southDirectTextRect.height / 2) * scaleY }
  await southDirectTextHandle.hover()
  await page.mouse.down()
  await page.mouse.move(southDirectTextPoint.x, southDirectTextPoint.y + 24 * scaleY, { steps: 8 })
  await page.mouse.up()
  await page.locator('.toast').filter({ hasText: 'hauteur d’un texte reste fluide' }).waitFor({ state: 'visible' })
  assert.equal(Number(await page.locator('.visual-change-count').textContent()), directTextCount)

  await imageProbe.waitFor({ state: 'visible' })
  await imageProbe.scrollIntoViewIfNeeded()
  const imageBox = await imageProbe.boundingBox()
  assert.ok(imageBox)
  await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2)
  await page.locator('.visual-target-card code').filter({ hasText: 'composer-image-probe' }).waitFor({ state: 'visible' })
  const imageWidthBefore = await imageProbe.evaluate((element) => element.getBoundingClientRect().width)
  const southImageHandle = visualFrame.locator('[data-responsiver-composer-handle="s"]')
  const southImageRect = await southImageHandle.evaluate((element) => element.getBoundingClientRect().toJSON())
  const southImagePoint = { x: iframeBox.x + (southImageRect.left + southImageRect.width / 2) * scaleX, y: iframeBox.y + (southImageRect.top + southImageRect.height / 2) * scaleY }
  await southImageHandle.hover()
  await page.mouse.down()
  await page.mouse.move(southImagePoint.x, southImagePoint.y + 24 * scaleY, { steps: 8 })
  await page.mouse.up()
  const imageWidthAfter = await imageProbe.evaluate(async (element, before) => {
    for (let index = 0; index < 30; index += 1) {
      const width = element.getBoundingClientRect().width
      if (width > before + 10) return width
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return element.getBoundingClientRect().width
  }, imageWidthBefore)
  assert.ok(imageWidthAfter > imageWidthBefore + 10, JSON.stringify({ imageWidthBefore, imageWidthAfter }))

  const frozenAction = visualFrame.locator('.product > button').first()
  await frozenAction.scrollIntoViewIfNeeded()
  const frozenRect = await frozenAction.evaluate((element) => element.getBoundingClientRect().toJSON())
  await page.mouse.click(iframeBox.x + (frozenRect.left + frozenRect.width / 2) * scaleX, iframeBox.y + (frozenRect.top + frozenRect.height / 2) * scaleY)
  assert.equal(await visualFrame.locator('[data-bag-panel]').getAttribute('aria-hidden'), 'true')
  await page.getByRole('button', { name: 'Tester' }).click()
  await visualFrame.locator('[data-responsiver-composer-active]').waitFor({ state: 'detached' })
  assert.equal(await visualFrame.locator('[data-responsiver-reveal-target]').count(), 0)
  await frozenAction.click()
  assert.equal(await visualFrame.locator('[data-bag-panel]').getAttribute('aria-hidden'), 'false')
  await page.keyboard.press('Enter')
  assert.ok(await visualFrame.locator('body').evaluate(() => window.__responsiverComposerKeyEvents) > 0)

  await page.getByRole('button', { name: 'Avant / après' }).click()
  const beforeTranslate = await page.frameLocator('.visual-before-after iframe').nth(0).locator('.hero-copy').evaluate((element) => getComputedStyle(element).translate)
  const afterTranslate = await page.frameLocator('.visual-before-after iframe').nth(1).locator('.hero-copy').evaluate(async (element) => {
    for (let index = 0; index < 60; index += 1) {
      const value = getComputedStyle(element).translate
      if (value !== 'none') return value
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return getComputedStyle(element).translate
  })
  assert.equal(beforeTranslate, 'none')
  assert.notEqual(afterTranslate, 'none')

  await page.getByRole('button', { name: 'Propriétés' }).click()
  const propertyFrame = page.frameLocator('.visual-canvas iframe').first()
  await propertyFrame.locator('.site-nav').click({ position: { x: 2, y: 2 } })
  await page.locator('.visual-target-card code').filter({ hasText: 'site-nav' }).waitFor({ state: 'visible' })
  const gapField = page.locator('.visual-control-scroll details').filter({ hasText: 'Mise en page' }).locator('label').filter({ hasText: 'Espacement' }).locator('input')
  await gapField.fill('24px')
  await gapField.press('Enter')
  await page.waitForFunction(() => Number(document.querySelector('.visual-change-count')?.textContent) >= 3)
  await page.getByRole('button', { name: 'Appliquer au projet' }).click()
  await page.locator('.toast').filter({ hasText: /ajustement.*visuel.*appliqué/i }).waitFor({ state: 'visible' })
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
  assert.match(generatedCss, /translate:/)
  assert.match(generatedCss, /width: min\(/)
  assert.match(generatedCss, /height: auto !important/)
  console.log('E2E visuel · composition directe, gel, resize, historique, test, comparaison et application — OK')
} finally {
  await application.close()
  await rm(state, { recursive: true, force: true })
}
