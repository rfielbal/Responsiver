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
  const revealInCanvas = async (locator) => {
    await locator.scrollIntoViewIfNeeded()
    const stage = page.locator('.visual-canvas .preview-stage').first()
    const stageBox = await stage.boundingBox()
    let targetBox = await locator.boundingBox()
    assert.ok(stageBox)
    assert.ok(targetBox)
    const inset = 24
    const deltaX = targetBox.x < stageBox.x + inset ? targetBox.x - stageBox.x - inset : targetBox.x + targetBox.width > stageBox.x + stageBox.width - inset ? targetBox.x + targetBox.width - stageBox.x - stageBox.width + inset : 0
    const deltaY = targetBox.y < stageBox.y + inset ? targetBox.y - stageBox.y - inset : targetBox.y + targetBox.height > stageBox.y + stageBox.height - inset ? targetBox.y + targetBox.height - stageBox.y - stageBox.height + inset : 0
    if (deltaX || deltaY) {
      await stage.evaluate((element, delta) => { element.scrollLeft += delta.x; element.scrollTop += delta.y }, { x: deltaX, y: deltaY })
      await page.waitForTimeout(80)
      targetBox = await locator.boundingBox()
      assert.ok(targetBox)
    }
    return targetBox
  }
  await visualFrame.locator('[data-responsiver-composer-active]').waitFor({ state: 'attached' })
  assert.equal(await page.getByLabel('Tailles concernées').inputValue(), 'mobile')
  assert.equal(await page.getByLabel('Pages concernées').inputValue(), 'current')
  assert.equal(await page.locator('.visual-scope-summary, .visual-toolbar .code-capability').count(), 0)
  const earlyGapField = page.locator('.visual-control-scroll details').filter({ hasText: 'Mise en page' }).locator('label').filter({ hasText: 'Espacement' }).locator('input')
  await earlyGapField.fill('url(http://valeur-refusee.test)')
  await earlyGapField.press('Enter')
  const activeToast = page.locator('.toast')
  await activeToast.waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Afficher l’Atelier en plein écran' }).click()
  const visualFullscreen = page.getByRole('dialog', { name: 'Atelier visuel en plein écran' })
  await visualFullscreen.waitFor({ state: 'visible' })
  assert.equal(await visualFullscreen.getAttribute('aria-modal'), 'true')
  assert.equal(await activeToast.evaluate((element) => element.inert), true)
  assert.equal(await activeToast.getAttribute('aria-hidden'), 'true')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Quitter le plein écran de l’Atelier')
  await page.evaluate(() => {
    const dialog = document.querySelector('.visual-workspace.is-fullscreen')
    const focusable = dialog ? [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')].filter((element) => element instanceof HTMLElement && !element.closest('[inert]') && element.getClientRects().length > 0) : []
    focusable.at(-1)?.focus()
  })
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.visual-workspace.is-fullscreen')?.contains(document.activeElement))), true)
  await page.evaluate(() => {
    const dialog = document.querySelector('.visual-workspace.is-fullscreen')
    const focusable = dialog ? [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')].filter((element) => element instanceof HTMLElement && !element.closest('[inert]') && element.getClientRects().length > 0) : []
    focusable[0]?.focus()
  })
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.visual-workspace.is-fullscreen')?.contains(document.activeElement))), true)
  await page.keyboard.press('Escape')
  await visualFullscreen.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Afficher l’Atelier en plein écran')
  assert.equal(await activeToast.evaluate((element) => element.inert), false)
  await activeToast.getByRole('button', { name: 'Fermer' }).click()
  await page.keyboard.press('F12')
  await page.waitForFunction(() => document.querySelector('.visual-mode-switch button[aria-pressed="true"]')?.textContent?.includes('Inspecter'))
  await page.getByRole('button', { name: 'Composer' }).click()
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
  // Le déplacement libre reste une translation même dans une grille ; Maj est
  // désormais requis pour demander explicitement une réorganisation du flux.
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
  const rapidNudgeBefore = await heroCopy.evaluate((element) => {
    const rectangle = element.getBoundingClientRect()
    return { left: rectangle.left, top: rectangle.top }
  })
  await heroCopy.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }))
  })
  await page.waitForFunction(() => document.querySelector('.visual-mode-switch button[aria-pressed="true"]')?.textContent?.includes('Inspecter'))
  await visualFrame.locator('[data-responsiver-composer-active]').waitFor({ state: 'detached' })
  const rapidNudgeAfter = await heroCopy.evaluate(async (element, before) => {
    for (let index = 0; index < 60; index += 1) {
      const rectangle = element.getBoundingClientRect()
      if (rectangle.left > before.left + .5 && rectangle.top > before.top + .5) return { left: rectangle.left, top: rectangle.top }
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const rectangle = element.getBoundingClientRect()
    return { left: rectangle.left, top: rectangle.top }
  }, rapidNudgeBefore)
  assert.ok(rapidNudgeAfter.left > rapidNudgeBefore.left + .5, JSON.stringify({ rapidNudgeBefore, rapidNudgeAfter }))
  assert.ok(rapidNudgeAfter.top > rapidNudgeBefore.top + .5, JSON.stringify({ rapidNudgeBefore, rapidNudgeAfter }))
  await page.getByRole('button', { name: 'Composer' }).click()
  await visualFrame.locator('[data-responsiver-composer-active]').waitFor({ state: 'attached' })
  await page.keyboard.press('Enter')
  assert.equal(await visualFrame.locator('body').evaluate(() => window.__responsiverComposerKeyEvents), 0)
  await heroCopy.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(350)
  const rapidNudgeSettled = await heroCopy.evaluate((element) => {
    const rectangle = element.getBoundingClientRect()
    return { left: rectangle.left, top: rectangle.top }
  })
  assert.ok(Math.abs(rapidNudgeSettled.left - rapidNudgeAfter.left) < .5, JSON.stringify({ rapidNudgeAfter, rapidNudgeSettled }))
  assert.ok(Math.abs(rapidNudgeSettled.top - rapidNudgeAfter.top) < .5, JSON.stringify({ rapidNudgeAfter, rapidNudgeSettled }))

  const widthBefore = await heroCopy.evaluate((element) => element.getBoundingClientRect().width)
  const eastHandle = visualFrame.locator('[data-responsiver-composer-handle="e"]')
  const iframeBox = await page.locator('.visual-canvas iframe').first().boundingBox()
  const frameViewport = await visualFrame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(iframeBox)
  const scaleX = iframeBox.width / frameViewport.width
  const scaleY = iframeBox.height / frameViewport.height
  await eastHandle.hover()
  const eastHandleBox = await eastHandle.boundingBox()
  assert.ok(eastHandleBox)
  const eastStart = { x: eastHandleBox.x + eastHandleBox.width / 2, y: eastHandleBox.y + eastHandleBox.height / 2 }
  await page.mouse.move(eastStart.x, eastStart.y)
  await page.mouse.down()
  await page.mouse.move(eastStart.x - 48 * scaleX, eastStart.y, { steps: 8 })
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
  const heightBefore = await heroCopy.evaluate((element) => element.getBoundingClientRect().height)
  const southTextHandle = visualFrame.locator('[data-responsiver-composer-handle="s"]')
  await southTextHandle.hover()
  const southTextBox = await southTextHandle.boundingBox()
  assert.ok(southTextBox)
  const southTextStart = { x: southTextBox.x + southTextBox.width / 2, y: southTextBox.y + southTextBox.height / 2 }
  await page.mouse.move(southTextStart.x, southTextStart.y)
  await page.mouse.down()
  await page.mouse.move(southTextStart.x, southTextStart.y + 36 * scaleY, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction((before) => Number(document.querySelector('.visual-change-count')?.textContent) > before, countBeforeTextHeight)
  const heightAfter = await heroCopy.evaluate(async (element, before) => {
    for (let index = 0; index < 30; index += 1) {
      const height = element.getBoundingClientRect().height
      if (height > before + 10) return height
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return element.getBoundingClientRect().height
  }, heightBefore)
  assert.ok(heightAfter > heightBefore + 10, JSON.stringify({ heightBefore, heightAfter }))

  await page.getByRole('button', { name: 'Annuler la dernière modification' }).click()
  await page.waitForFunction((expected) => Number(document.querySelector('.visual-change-count')?.textContent) === expected, countBeforeTextHeight)
  const restoredHeight = await heroCopy.evaluate(async (element, expected) => {
    for (let index = 0; index < 30; index += 1) {
      const height = element.getBoundingClientRect().height
      if (Math.abs(height - expected) < 2) return height
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return element.getBoundingClientRect().height
  }, heightBefore)
  assert.ok(Math.abs(restoredHeight - heightBefore) < 2)
  await page.getByRole('button', { name: 'Rétablir la modification' }).click()
  await page.waitForFunction((before) => Number(document.querySelector('.visual-change-count')?.textContent) > before, countBeforeTextHeight)
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
  const directTextBox = await revealInCanvas(directTextProbe)
  await page.mouse.click(directTextBox.x + directTextBox.width / 2, directTextBox.y + directTextBox.height / 2)
  await page.locator('.visual-target-card code').filter({ hasText: 'composer-direct-text-probe' }).waitFor({ state: 'visible' })
  const directTextCount = Number(await page.locator('.visual-change-count').textContent())
  const directTextHeightBefore = await directTextProbe.evaluate((element) => element.getBoundingClientRect().height)
  const southDirectTextHandle = visualFrame.locator('[data-responsiver-composer-handle="s"]')
  await southDirectTextHandle.hover()
  const southDirectTextBox = await southDirectTextHandle.boundingBox()
  assert.ok(southDirectTextBox)
  const southDirectTextStart = { x: southDirectTextBox.x + southDirectTextBox.width / 2, y: southDirectTextBox.y + southDirectTextBox.height / 2 }
  await page.mouse.move(southDirectTextStart.x, southDirectTextStart.y)
  await page.mouse.down()
  await page.mouse.move(southDirectTextStart.x, southDirectTextStart.y + 24 * scaleY, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction((before) => Number(document.querySelector('.visual-change-count')?.textContent) > before, directTextCount)
  const directTextHeightAfter = await directTextProbe.evaluate(async (element, before) => {
    for (let index = 0; index < 30; index += 1) {
      const height = element.getBoundingClientRect().height
      if (height > before + 10) return height
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return element.getBoundingClientRect().height
  }, directTextHeightBefore)
  assert.ok(directTextHeightAfter > directTextHeightBefore + 10, JSON.stringify({ directTextHeightBefore, directTextHeightAfter }))

  await imageProbe.waitFor({ state: 'visible' })
  const imageBox = await revealInCanvas(imageProbe)
  await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2)
  await page.locator('.visual-target-card code').filter({ hasText: 'composer-image-probe' }).waitFor({ state: 'visible' })
  await imageProbe.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(250)
  const imageChangeCount = Number(await page.locator('.visual-change-count').textContent())
  const imageWidthBefore = await imageProbe.evaluate((element) => element.getBoundingClientRect().width)
  const southImageHandle = visualFrame.locator('[data-responsiver-composer-handle="s"]')
  await southImageHandle.hover()
  const southImageBox = await southImageHandle.boundingBox()
  assert.ok(southImageBox)
  const southImageStart = { x: southImageBox.x + southImageBox.width / 2, y: southImageBox.y + southImageBox.height / 2 }
  await page.mouse.move(southImageStart.x, southImageStart.y)
  await page.mouse.down()
  await page.mouse.move(southImageStart.x, southImageStart.y + 24 * scaleY, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction((before) => Number(document.querySelector('.visual-change-count')?.textContent) > before, imageChangeCount)
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
  const frozenBox = await revealInCanvas(frozenAction)
  await page.mouse.click(frozenBox.x + frozenBox.width / 2, frozenBox.y + frozenBox.height / 2)
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

  await page.getByRole('button', { name: 'Inspecter', exact: true }).first().click()
  const propertyFrame = page.frameLocator('.visual-canvas iframe').first()
  await propertyFrame.locator('.site-nav').click({ position: { x: 2, y: 2 } })
  await page.locator('.visual-target-card code').filter({ hasText: 'site-nav' }).waitFor({ state: 'visible' })
  const gapField = page.locator('.visual-control-scroll details').filter({ hasText: 'Mise en page' }).locator('label').filter({ hasText: 'Espacement' }).locator('input')
  await gapField.fill('24px')
  await gapField.press('Enter')
  await page.waitForFunction(() => Number(document.querySelector('.visual-change-count')?.textContent) >= 3)
  const generatedCssPath = join(projectRoot, '.responsiver', 'responsiver.generated.css')
  await page.getByRole('button', { name: 'Réviser sans modifier' }).click()
  await page.getByRole('heading', { name: 'Révision' }).waitFor({ state: 'visible' })
  assert.equal(await page.locator('.review-summary > div').filter({ hasText: 'Sources modifiées' }).locator('strong').textContent(), '0')
  await assert.rejects(readFile(generatedCssPath, 'utf8'), { code: 'ENOENT' })
  await page.getByRole('button', { name: 'Atelier visuel', exact: true }).click()
  await page.locator('.visual-editor-page').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Appliquer aux fichiers' }).click()
  await page.locator('.toast').filter({ hasText: /ajustement.*visuel.*appliqué/i }).waitFor({ state: 'visible' })
  const generatedCss = await readFile(generatedCssPath, 'utf8')
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

  // Une preview démontée avant la vérification d'un geste ne doit jamais
  // conserver silencieusement ce changement dans le futur export.
  await page.getByRole('button', { name: 'Atelier visuel', exact: true }).click()
  await page.locator('.visual-editor-page').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Composer' }).click()
  const interruptionFrame = page.frameLocator('.visual-canvas iframe').first()
  await interruptionFrame.locator('[data-responsiver-composer-active]').waitFor({ state: 'attached' })
  const interruptionTarget = interruptionFrame.locator('.site-nav')
  const interruptionBox = await revealInCanvas(interruptionTarget)
  await page.mouse.click(interruptionBox.x + 2, interruptionBox.y + 2)
  await page.locator('.visual-target-card code').filter({ hasText: 'site-nav' }).waitFor({ state: 'visible' })
  await page.waitForTimeout(240)
  const countBeforeInterruptedPreview = Number(await page.locator('.visual-change-count').textContent())
  await interruptionTarget.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  await page.waitForFunction(
    (before) => Number(document.querySelector('.visual-change-count')?.textContent) > before,
    countBeforeInterruptedPreview,
    { polling: 'raf' }
  )
  await page.getByRole('button', { name: 'Avant / après' }).evaluate((button) => button.click())
  await page.locator('.visual-before-after').waitFor({ state: 'visible' })
  await page.waitForFunction(
    (before) => Number(document.querySelector('.visual-change-count')?.textContent) === before,
    countBeforeInterruptedPreview
  )
  await page.locator('.toast').filter({ hasText: /prévisualisation.*interrompue/i }).waitFor({ state: 'visible' })
  console.log('E2E visuel · composition directe, gel, resize, historique, test, comparaison et application — OK')
} finally {
  await application.close()
  await rm(state, { recursive: true, force: true })
}
