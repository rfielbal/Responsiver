import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const demoRoot = join(root, 'demo', 'atelier')
const demoFiles = ['index.html', 'journal.html', 'styles.css', 'script.js']
const packaged = process.argv.includes('--packaged')
const applicationExecutable = packaged
  ? join(root, 'dist', 'mac-arm64', 'Responsiver.app', 'Contents', 'MacOS', 'Responsiver')
  : electronPath
const sourcesBefore = new Map(await Promise.all(demoFiles.map(async (file) => [file, await readFile(join(demoRoot, file), 'utf8')])))
const pageErrors = []

const application = await electron.launch({
  executablePath: applicationExecutable,
  args: packaged ? [] : [root],
  timeout: 30_000
})

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(12_000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')

  const waitForActivePath = async (path) => page.waitForFunction((expected) => document.querySelector('.browser-bar select')?.value === expected, path)
  const waitForPreviewState = async (predicate, label) => {
    const deadline = Date.now() + 12_000
    let observed = []
    while (Date.now() < deadline) {
      observed = []
      for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame())) {
        try {
          const state = await frame.evaluate(() => ({
            generatedTheme: document.documentElement.getAttribute('data-responsiver-generated-theme'),
            generatedInstructions: document.documentElement.hasAttribute('data-responsiver-generated-instructions'),
            background: document.body ? getComputedStyle(document.body).backgroundColor : null
          }))
          const candidate = { ...state, url: frame.url() }
          observed.push(candidate)
          if (predicate(candidate)) return candidate
        } catch {
          // Une iframe peut être remplacée entre la lecture de la liste et son évaluation.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    throw new Error(`${label} introuvable dans les prévisualisations actives : ${JSON.stringify(observed)}`)
  }
  const dismissToast = async () => {
    const button = page.locator('.toast button[aria-label="Fermer"]')
    if (await button.isVisible().catch(() => false)) await button.click()
  }
  const openLab = async () => {
    await page.getByRole('button', { name: 'Laboratoire', exact: true }).click()
    await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  }
  const assertExportUnavailable = async () => {
    await page.getByRole('button', { name: 'Exporter', exact: true }).click()
    const readiness = page.locator('.export-readiness')
    await readiness.waitFor({ state: 'visible' })
    assert.match(await readiness.textContent(), /Staging requis/)
    assert.equal(await readiness.evaluate((element) => element.classList.contains('is-ready')), false)
    assert.equal(await page.getByRole('button', { name: 'Copier', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Exporter une copie' }).isDisabled(), true)
  }

  await page.getByRole('button', { name: 'Ouvrir la démo locale' }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  const sourceFrame = page.frameLocator('.stage-canvas iframe').first()
  const sourceOrigin = new URL(await page.locator('.stage-canvas iframe').first().getAttribute('src')).origin
  console.log('E2E · démo ouverte dans le runner local')

  // La navigation est exercée dans le site, et non simulée depuis le sélecteur de Responsiver.
  await sourceFrame.getByRole('link', { name: 'Journal', exact: true }).evaluate((link) => link.click())
  await waitForActivePath('/journal.html')
  assert.equal(await page.locator('.browser-bar select').inputValue(), '/journal.html')
  await sourceFrame.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Collection', exact: true }).evaluate((link) => link.click())
  await waitForActivePath('/index.html')
  await sourceFrame.getByRole('link', { name: 'Journal', exact: true }).evaluate((link) => link.click())
  await waitForActivePath('/journal.html')
  assert.equal(await page.locator('.issue-item').count(), 2)
  console.log('E2E · navigation réelle multi-page synchronisée')

  const nowrapIssue = page.locator('.issue-item').filter({ hasText: 'Texte forcé sur une ligne' })
  await nowrapIssue.click()
  const beforeAfter = page.locator('.before-after-grid')
  await beforeAfter.waitFor({ state: 'visible' })
  assert.equal(await beforeAfter.locator('iframe').count(), 2)
  await page.waitForFunction((expectedPath) => {
    const frames = [...document.querySelectorAll('.before-after-grid iframe')]
    return frames.length === 2 && frames.every((frame) => new URL(frame.src).pathname === expectedPath)
  }, '/journal.html')

  const beforeDocument = page.frameLocator('.before-after-grid iframe').nth(0)
  const afterDocument = page.frameLocator('.before-after-grid iframe').nth(1)
  const revealSelector = '.site-nav[data-responsiver-reveal-target]'
  await beforeDocument.locator(revealSelector).waitFor({ state: 'attached' })
  await afterDocument.locator(revealSelector).waitFor({ state: 'attached' })
  const beforeNavigationStyle = await beforeDocument.locator('.site-nav').evaluate((element) => ({
    minWidth: getComputedStyle(element).minWidth,
    whiteSpace: getComputedStyle(element).whiteSpace
  }))
  const afterNavigationStyle = await afterDocument.locator('.site-nav').evaluate((element) => ({
    minWidth: getComputedStyle(element).minWidth,
    whiteSpace: getComputedStyle(element).whiteSpace
  }))
  assert.equal(beforeNavigationStyle.minWidth, '720px')
  assert.equal(afterNavigationStyle.minWidth, '720px')
  assert.equal(beforeNavigationStyle.whiteSpace, 'nowrap')
  assert.equal(afterNavigationStyle.whiteSpace, 'normal')
  assert.match(await page.locator('.comparison-pane--after header').textContent(), /Proposition non validée/)
  await page.screenshot({ path: join(root, 'output', 'playwright', 'electron-lab.png'), fullPage: true })
  console.log('E2E · constat localisé et avant/après isolé vérifié')

  // Une proposition consultée n'est ni un choix validé, ni un staging exportable.
  await assertExportUnavailable()
  await openLab()
  await beforeAfter.waitFor({ state: 'visible' })
  const decision = page.locator('.proposal-decision')
  await decision.getByRole('button', { name: 'Écarter' }).click()
  await decision.waitFor({ state: 'detached' })
  await page.locator('.toast').filter({ hasText: 'proposition a été écartée' }).waitFor({ state: 'visible' })
  await dismissToast()
  assert.equal(await nowrapIssue.evaluate((element) => element.classList.contains('is-accepted')), false)

  await nowrapIssue.click()
  await beforeAfter.waitFor({ state: 'visible' })
  await afterDocument.locator(revealSelector).waitFor({ state: 'attached' })
  await page.locator('.proposal-decision').getByRole('button', { name: 'Valider' }).click()
  await page.waitForFunction(() => document.querySelector('.issue-item.is-accepted')?.textContent?.includes('Texte forcé sur une ligne'))
  assert.match(await page.locator('.proposal-decision').textContent(), /Validé dans le plan/)
  await dismissToast()
  console.log('E2E · rejet puis validation explicite du correctif vérifiés')

  const issueProposalOrigin = new URL(await page.locator('.before-after-grid iframe').nth(1).getAttribute('src')).origin
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.waitForFunction((origin) => {
    const frames = [...document.querySelectorAll('.stage-canvas iframe')]
    return frames.length === 1 && Boolean(frames[0].src) && new URL(frames[0].src).origin === origin
  }, sourceOrigin)
  await page.getByRole('tab', { name: 'Thème' }).click()
  await page.getByText('Thème sombre détecté').waitFor({ state: 'visible' })
  const lightTheme = page.getByRole('radio', { name: /Clair/ })
  await lightTheme.check()
  const themeDecision = page.locator('.proposal-decision')
  await themeDecision.waitFor({ state: 'visible' })
  assert.match(await themeDecision.textContent(), /Aperçu non validé/)
  assert.equal(await lightTheme.isChecked(), true)
  await page.waitForFunction(({ originalOrigin, previousProposalOrigin }) => {
    const frames = [...document.querySelectorAll('.stage-canvas iframe')]
    if (frames.length !== 1 || !frames[0].src) return false
    const origin = new URL(frames[0].src).origin
    return origin !== originalOrigin && origin !== previousProposalOrigin
  }, { originalOrigin: sourceOrigin, previousProposalOrigin: issueProposalOrigin })
  const lightProposalState = await waitForPreviewState((state) => state.generatedTheme === 'light', 'La proposition de thème clair')
  assert.notEqual(new URL(lightProposalState.url).origin, sourceOrigin)
  assert.equal(lightProposalState.background, 'rgb(244, 242, 236)')
  await themeDecision.getByRole('button', { name: 'Valider' }).click()
  assert.match(await themeDecision.textContent(), /Validé dans le plan/)
  await dismissToast()
  console.log('E2E · variante claire prévisualisée puis validée')

  // Redimensionnement par le bord droit : les champs et les vrais pixels CSS de l'iframe suivent.
  const widthInput = page.locator('.dimension-fields input').nth(0)
  const heightInput = page.locator('.dimension-fields input').nth(1)
  const initialWidth = Number(await widthInput.inputValue())
  const initialHeight = Number(await heightInput.inputValue())
  const eastHandle = page.getByRole('button', { name: 'Redimensionner depuis le bord droit' })
  const handleBox = await eastHandle.boundingBox()
  assert.ok(handleBox, 'La poignée de redimensionnement droite doit être visible.')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 72, handleBox.y + handleBox.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForFunction((previousWidth) => Number(document.querySelectorAll('.dimension-fields input')[0]?.value) > previousWidth, initialWidth)
  const resizedWidth = Number(await widthInput.inputValue())
  assert.ok(resizedWidth > initialWidth)
  assert.equal(Number(await heightInput.inputValue()), initialHeight)
  assert.equal(await page.locator('.model-select select').inputValue(), 'custom')
  assert.equal(Number(await page.locator('.stage-canvas iframe').getAttribute('width')), resizedWidth)
  assert.equal(Number(await page.locator('.stage-canvas iframe').getAttribute('height')), initialHeight)
  await page.getByRole('button', { name: 'Afficher la prévisualisation en plein écran' }).click()
  await page.locator('.stage-column.is-fullscreen').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.stage-column.is-fullscreen iframe').count(), 1)
  await page.frameLocator('.stage-column.is-fullscreen iframe').first().locator('body').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Escape')
  await page.locator('.stage-column.is-fullscreen').waitFor({ state: 'detached' })
  console.log('E2E · redimensionnement manuel et plein écran vérifiés')

  await page.getByRole('tab', { name: /Correctifs/ }).click()
  assert.equal(await page.locator('.fix-list article').count(), 2)
  await page.getByRole('button', { name: 'Construire le staging' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: /^Staging/ }).isEnabled(), true)
  await dismissToast()
  console.log('E2E · premier staging construit depuis les choix validés')

  // Toute mutation du plan invalide immédiatement le staging et verrouille l'export.
  await page.getByRole('button', { name: 'Retirer Texte forcé sur une ligne' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: /^Staging/ }).isDisabled(), true)
  await assertExportUnavailable()
  await openLab()
  await page.getByRole('tab', { name: /Correctifs/ }).click()
  assert.equal(await page.locator('.fix-list article').count(), 1)
  await page.getByRole('button', { name: 'Construire le staging' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'visible' })
  await dismissToast()
  console.log('E2E · staging invalidé après modification puis reconstruit')

  await page.getByRole('button', { name: '3 écrans', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.comparison-grid iframe').length === 3)
  assert.equal(await page.locator('.comparison-grid iframe').count(), 3)
  console.log('E2E · comparaison simultanée sur trois appareils vérifiée')

  await page.getByRole('button', { name: 'Appareil', exact: true }).click()
  const stagingOriginBeforeInstruction = new URL(await page.locator('.stage-canvas iframe').first().getAttribute('src')).origin
  await page.getByRole('tab', { name: 'Conversation' }).click()
  await page.getByLabel('Nouvel ajustement').fill('Mets les angles droits sur les composants')
  await page.getByRole('button', { name: 'Prévisualiser' }).click()
  await page.locator('.message--system').filter({ hasText: 'Ajustement interprété et affiché en proposition' }).waitFor({ state: 'visible' })
  const instructionDecision = page.locator('.proposal-decision')
  assert.match(await instructionDecision.textContent(), /Aperçu non validé/)
  await page.waitForFunction(({ stagingOrigin, originalOrigin }) => {
    const frames = [...document.querySelectorAll('.stage-canvas iframe')]
    if (frames.length !== 1 || !frames[0].src) return false
    const origin = new URL(frames[0].src).origin
    return origin !== stagingOrigin && origin !== originalOrigin
  }, { stagingOrigin: stagingOriginBeforeInstruction, originalOrigin: sourceOrigin })
  await waitForPreviewState((state) => state.generatedInstructions, 'La proposition issue de la conversation')
  await instructionDecision.getByRole('button', { name: 'Valider' }).click()
  await page.locator('.message--system').filter({ hasText: 'Ajustement validé et ajouté au plan' }).waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: /^Staging/ }).isDisabled(), true)
  await dismissToast()
  await page.getByRole('tab', { name: /Correctifs/ }).click()
  assert.equal(await page.locator('.fix-list article').count(), 2)
  await page.getByRole('button', { name: 'Construire le staging' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'visible' })
  await dismissToast()
  console.log('E2E · conversation locale prévisualisée, validée et reconstruite')

  await page.getByRole('button', { name: /^Révision/ }).click()
  await page.locator('.visual-comparison').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.visual-comparison iframe').count(), 2)
  const revisedDocument = page.frameLocator('.visual-comparison iframe').nth(1)
  await revisedDocument.locator('html[data-responsiver-generated-theme="light"][data-responsiver-generated-instructions]').waitFor({ state: 'attached' })
  const patch = await page.locator('.diff-panel pre').textContent()
  assert.match(patch, /data-responsiver-generated-theme/)
  assert.match(patch, /data-responsiver-generated-instructions/)

  await page.getByRole('button', { name: 'Exporter', exact: true }).click()
  const ready = page.locator('.export-readiness.is-ready')
  await ready.waitFor({ state: 'visible' })
  assert.match(await ready.textContent(), /Staging prêt/)
  assert.equal(await page.getByRole('button', { name: 'Copier', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Exporter une copie' }).isEnabled(), true)
  await page.screenshot({ path: join(root, 'output', 'playwright', 'electron-e2e.png'), fullPage: true })

  for (const [file, source] of sourcesBefore) assert.equal(await readFile(join(demoRoot, file), 'utf8'), source, `${file} ne doit pas être modifié.`)
  assert.deepEqual(pageErrors, [])
  process.stdout.write('E2E Electron v0.4 : navigation, propositions, ciblage, thème, redimensionnement, plein écran, staging, conversation, révision et export — OK\n')
} finally {
  await application.close()
}
