import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const demoRoot = join(root, 'demo', 'atelier')
const demoFiles = ['index.html', 'journal.html', 'styles.css', 'script.js']
const packaged = process.argv.includes('--packaged')
const testStateRoot = await mkdtemp(join(tmpdir(), 'responsiver-electron-e2e-'))
const userDataRoot = join(testStateRoot, 'user-data')
const incompleteRoot = join(testStateRoot, 'Site incomplet')
const runtimeBlankRoot = join(testStateRoot, 'Bundle en erreur')
const directTextRoot = join(testStateRoot, 'Page texte')
const delayedMountRoot = join(testStateRoot, 'Montage différé')
const mixedRuntimeThemeRoot = join(testStateRoot, 'Thème par route')
await mkdir(join(incompleteRoot, 'images'), { recursive: true })
await mkdir(runtimeBlankRoot, { recursive: true })
await mkdir(directTextRoot, { recursive: true })
await mkdir(delayedMountRoot, { recursive: true })
await mkdir(mixedRuntimeThemeRoot, { recursive: true })
await mkdir(userDataRoot, { recursive: true })
await writeFile(join(incompleteRoot, 'index.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title></title><link rel="stylesheet" href="styles.css"></head><body><header></html>')
await writeFile(join(incompleteRoot, 'styles.css'), '')
await writeFile(join(incompleteRoot, 'images', 'portrait.jpg'), Buffer.from('image non référencée'))
await writeFile(join(runtimeBlankRoot, 'index.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Bundle en erreur</title><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>')
await writeFile(join(runtimeBlankRoot, 'styles.css'), 'body { margin: 0; background: #fff; }')
await writeFile(join(runtimeBlankRoot, 'app.js'), 'throw new Error("Erreur de montage contrôlée")')
await writeFile(join(directTextRoot, 'index.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Page texte</title></head><body>Texte visible directement</body></html>')
await writeFile(join(delayedMountRoot, 'index.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Montage différé</title></head><body><late-shell></late-shell><script src="app.js"></script></body></html>')
await writeFile(join(delayedMountRoot, 'app.js'), 'customElements.define("late-shell", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }) } }); setTimeout(() => { document.querySelector("late-shell").shadowRoot.innerHTML = "<main>Interface montée tardivement dans le Shadow DOM</main>" }, 2500)')
await writeFile(join(mixedRuntimeThemeRoot, 'index.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Accueil sombre</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Accueil sombre</h1><a href="about.html">À propos</a></main></body></html>')
await writeFile(join(mixedRuntimeThemeRoot, 'about.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Route claire</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Route claire dynamique</h1></main><script src="route-theme.js"></script></body></html>')
await writeFile(join(mixedRuntimeThemeRoot, 'styles.css'), ':root { --background: #10110f; --text: #f8f7f3; } body { margin: 0; background: var(--background); color: var(--text); }')
await writeFile(join(mixedRuntimeThemeRoot, 'route-theme.js'), 'document.body.style.backgroundColor = "#ffffff"; document.body.style.color = "#111111"')
const applicationExecutable = packaged
  ? join(root, 'dist', 'mac-arm64', 'Responsiver.app', 'Contents', 'MacOS', 'Responsiver')
  : electronPath
const sourcesBefore = new Map(await Promise.all(demoFiles.map(async (file) => [file, await readFile(join(demoRoot, file), 'utf8')])))
const pageErrors = []

const application = await electron.launch({
  executablePath: applicationExecutable,
  args: packaged ? [] : [root],
  env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userDataRoot },
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

  const rail = page.locator('.app-shell')
  await page.getByRole('button', { name: 'Replier le menu latéral' }).click()
  await page.waitForFunction(() => document.querySelector('.app-shell')?.classList.contains('is-rail-collapsed'))
  assert.equal(await page.getByRole('button', { name: 'Laboratoire', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: 'Déployer le menu latéral' }).click()
  assert.equal(await rail.evaluate((element) => element.classList.contains('is-rail-collapsed')), false)
  console.log('E2E · rail latéral repliable et navigation accessible')

  await page.getByLabel('Chemin local').fill(incompleteRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  const readinessCard = page.locator('.readiness-card')
  await readinessCard.waitFor({ state: 'visible' })
  assert.match(await readinessCard.textContent(), /Aucun rendu exploitable/)
  assert.match(await readinessCard.textContent(), /Aucun contenu visible/)
  assert.equal(await page.locator('.workbench').count(), 0)
  await dismissToast()
  await page.locator('.projects-page').screenshot({ path: join(root, 'output', 'playwright', 'electron-import-diagnostic.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Voir le diagnostic' }).click()
  await page.locator('.stage-canvas .preview-diagnostic').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.stage-canvas iframe').count(), 0)
  assert.match(await page.locator('.stage-canvas .preview-diagnostic').textContent(), /runner reste arrêté/)
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  console.log('E2E · projet incomplet diagnostiqué sans écran blanc silencieux')

  await page.getByLabel('Chemin local').fill(runtimeBlankRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  const runtimeDiagnostic = page.locator('.stage-canvas .preview-diagnostic')
  await runtimeDiagnostic.waitFor({ state: 'visible', timeout: 8_000 })
  assert.match(await runtimeDiagnostic.textContent(), /aucun contenu visible n’a été produit/)
  assert.match(await runtimeDiagnostic.textContent(), /1 erreur de script ou de ressource/)
  const runtimeErrorAlert = page.locator('.runtime-alert--errors')
  await runtimeErrorAlert.waitFor({ state: 'visible' })
  assert.match(await runtimeErrorAlert.textContent(), /1 erreur observée pendant le rendu/)
  assert.match(await runtimeErrorAlert.textContent(), /Erreur de montage contrôlée/)
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  console.log('E2E · bundle local défaillant détecté après le smoke-test runtime')

  await writeFile(join(runtimeBlankRoot, 'styles.css'), 'body { margin: 0; } body::before { content: "Interface peinte par pseudo-élément"; display: block; padding: 24px; color: #111; }')
  await writeFile(join(runtimeBlankRoot, 'app.js'), 'setTimeout(() => { throw new Error("Erreur de montage contrôlée") }, 2300)')
  await page.getByLabel('Chemin local').fill(runtimeBlankRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  const pseudoBody = page.frameLocator('.stage-canvas iframe').first().locator('body')
  await pseudoBody.waitFor({ state: 'attached' })
  assert.match(await pseudoBody.evaluate((body) => getComputedStyle(body, '::before').content), /Interface peinte/)
  await page.waitForTimeout(3_000)
  assert.equal(await page.locator('.stage-canvas .preview-diagnostic').count(), 0)
  const lateRuntimeAlert = page.locator('.runtime-alert--errors')
  await lateRuntimeAlert.waitFor({ state: 'visible' })
  assert.match(await lateRuntimeAlert.textContent(), /Erreur de montage contrôlée/)
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  console.log('E2E · pseudo-élément reconnu et erreur tardive remontée sans masquer le site')

  await page.getByLabel('Chemin local').fill(directTextRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.frameLocator('.stage-canvas iframe').first().getByText('Texte visible directement').waitFor({ state: 'visible' })
  await page.waitForTimeout(2_000)
  assert.equal(await page.locator('.stage-canvas .preview-diagnostic').count(), 0)
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  console.log('E2E · texte direct du body reconnu comme contenu réellement peint')

  await page.getByLabel('Chemin local').fill(delayedMountRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  const delayedDiagnostic = page.locator('.stage-canvas .preview-diagnostic')
  await delayedDiagnostic.waitFor({ state: 'visible', timeout: 5_000 })
  await page.frameLocator('.stage-canvas iframe').first().getByText('Interface montée tardivement').waitFor({ state: 'visible', timeout: 6_000 })
  await delayedDiagnostic.waitFor({ state: 'detached', timeout: 3_000 })
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  console.log('E2E · smoke-test requalifié après un montage Shadow DOM tardif')

  await page.getByLabel('Chemin local').fill(mixedRuntimeThemeRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.locator('.browser-bar select').selectOption('/about.html')
  await page.frameLocator('.stage-canvas iframe').first().getByText('Route claire dynamique').waitFor({ state: 'visible' })
  await page.getByRole('tab', { name: 'Thème' }).click()
  await page.getByText('Thème sombre détecté').waitFor({ state: 'visible' })
  const routeLightTheme = page.getByRole('radio', { name: /Clair/ })
  assert.doesNotMatch(await routeLightTheme.locator('xpath=..').textContent(), /Déjà présent/)
  await routeLightTheme.check()
  await page.locator('.proposal-decision').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.native-theme-preview').count(), 0)
  await page.locator('.proposal-decision').getByRole('button', { name: 'Écarter' }).click()
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  console.log('E2E · apparence claire d’une route distincte du thème global')

  await page.getByRole('button', { name: 'Ouvrir la démo locale' }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  const sourceFrame = page.frameLocator('.stage-canvas iframe').first()
  const sourceOrigin = new URL(await page.locator('.stage-canvas iframe').first().getAttribute('src')).origin
  console.log('E2E · démo ouverte dans le runner local')

  await page.getByRole('button', { name: 'Code', exact: true }).click()
  const liveCodeFrame = page.locator('.code-live-preview iframe')
  await liveCodeFrame.waitFor({ state: 'visible' })
  assert.equal(new URL(await liveCodeFrame.getAttribute('src')).origin, sourceOrigin)
  await page.locator('.code-files button').filter({ hasText: 'styles.css' }).click()
  const monacoEditor = page.locator('.monaco-editor').first()
  await monacoEditor.waitFor({ state: 'visible' })
  await monacoEditor.click({ position: { x: 180, y: 120 } })
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n/* aperçu code e2e */\n')
  const stylesEntry = page.locator('.code-files button').filter({ hasText: 'styles.css' })
  await stylesEntry.locator('i.is-dirty').waitFor({ state: 'visible' })
  await page.waitForFunction((originalOrigin) => {
    const frame = document.querySelector('.code-live-preview iframe')
    return frame?.src && new URL(frame.src).origin !== originalOrigin
  }, sourceOrigin)
  await page.locator('.code-page').screenshot({ path: join(root, 'output', 'playwright', 'electron-code-studio.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Écarter', exact: true }).click()
  await stylesEntry.locator('i.is-dirty').waitFor({ state: 'detached' })
  await page.waitForFunction((originalOrigin) => {
    const frame = document.querySelector('.code-live-preview iframe')
    return frame?.src && new URL(frame.src).origin === originalOrigin
  }, sourceOrigin)
  await page.getByRole('button', { name: 'Laboratoire', exact: true }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  console.log('E2E · studio code, overlay temps réel et annulation vérifiés')

  // La navigation est exercée dans le site, et non simulée depuis le sélecteur de Responsiver.
  await sourceFrame.getByRole('link', { name: 'Journal', exact: true }).evaluate((link) => link.click())
  await waitForActivePath('/journal.html')
  assert.equal(await page.locator('.browser-bar select').inputValue(), '/journal.html')
  await sourceFrame.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Collection', exact: true }).evaluate((link) => link.click())
  await waitForActivePath('/index.html')
  await sourceFrame.getByRole('link', { name: 'Journal', exact: true }).evaluate((link) => link.click())
  await waitForActivePath('/journal.html')
  assert.ok(await page.locator('.issue-item').count() >= 2)
  assert.ok((await page.locator('.issue-item small').allTextContents()).every((label) => label.includes('/journal.html')), 'Les constats runtime et statiques doivent rester limités à la route active.')
  await sourceFrame.locator('body').evaluate(() => history.pushState({ responsiverTest: true }, '', '/collection?filtre=tous'))
  await waitForActivePath('/collection?filtre=tous')
  assert.equal(await page.locator('.browser-bar select').inputValue(), '/collection?filtre=tous')
  assert.match(await page.locator('.browser-bar select option:checked').textContent(), /Page courante/)
  assert.ok(await page.locator('.issue-item').count() > 0, 'Une route SPA inconnue doit conserver les constats du document d’entrée.')
  await page.locator('.browser-bar select').selectOption('/journal.html')
  await waitForActivePath('/journal.html')
  console.log('E2E · navigation réelle multi-page synchronisée')

  const navigationIssue = page.locator('.issue-item').filter({ hasText: 'Navigation déséquilibrée à cette largeur' })
  await navigationIssue.click()
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
    overflowX: getComputedStyle(element).overflowX
  }))
  const afterNavigationStyle = await afterDocument.locator('.site-nav').evaluate((element) => ({
    minWidth: getComputedStyle(element).minWidth,
    overflowX: getComputedStyle(element).overflowX
  }))
  assert.equal(beforeNavigationStyle.minWidth, '720px')
  assert.equal(afterNavigationStyle.minWidth, '0px')
  assert.equal(beforeNavigationStyle.overflowX, 'visible')
  assert.equal(afterNavigationStyle.overflowX, 'auto')
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
  assert.equal(await navigationIssue.evaluate((element) => element.classList.contains('is-accepted')), false)

  await navigationIssue.click()
  await beforeAfter.waitFor({ state: 'visible' })
  await afterDocument.locator(revealSelector).waitFor({ state: 'attached' })
  await page.locator('.proposal-decision').getByRole('button', { name: 'Valider' }).click()
  await page.waitForFunction(() => document.querySelector('.issue-item.is-accepted')?.textContent?.includes('Navigation déséquilibrée à cette largeur'))
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
  await eastHandle.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction((previousWidth) => Number(document.querySelectorAll('.dimension-fields input')[0]?.value) === previousWidth + 4, resizedWidth)
  const widthAfterEastKey = Number(await widthInput.inputValue())
  await page.getByRole('button', { name: 'Redimensionner depuis le bord gauche' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction((previousWidth) => Number(document.querySelectorAll('.dimension-fields input')[0]?.value) === previousWidth - 4, widthAfterEastKey)
  await page.getByRole('button', { name: 'Redimensionner depuis le bord inférieur' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction((previousHeight) => Number(document.querySelectorAll('.dimension-fields input')[1]?.value) === previousHeight + 4, initialHeight)
  const heightAfterSouthKey = Number(await heightInput.inputValue())
  await page.getByRole('button', { name: 'Redimensionner depuis le bord supérieur' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction((previousHeight) => Number(document.querySelectorAll('.dimension-fields input')[1]?.value) === previousHeight - 4, heightAfterSouthKey)
  await page.getByRole('button', { name: 'Ajuster à la zone' }).click()
  await page.getByRole('button', { name: 'Intervertir la largeur et la hauteur' }).click()
  await page.getByRole('button', { name: 'Afficher la prévisualisation en plein écran' }).click()
  await page.locator('.stage-column.is-fullscreen').waitFor({ state: 'visible' })
  const fullscreenDialog = page.getByRole('dialog', { name: 'Prévisualisation en plein écran' })
  assert.equal(await fullscreenDialog.getAttribute('aria-modal'), 'true')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Quitter le plein écran de la prévisualisation')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.stage-column.is-fullscreen')?.contains(document.activeElement))), true)
  assert.equal(await page.locator('.stage-column.is-fullscreen iframe').count(), 1)
  await page.waitForFunction(() => {
    const transform = document.querySelector('.stage-column.is-fullscreen .device-shell')?.style.transform ?? ''
    return Number(transform.match(/scale\(([^)]+)\)/)?.[1] ?? 0) > 1
  })
  await page.frameLocator('.stage-column.is-fullscreen iframe').first().locator('body').click({ position: { x: 300, y: 300 } })
  await page.keyboard.press('Escape')
  await page.locator('.stage-column.is-fullscreen').waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Afficher la prévisualisation en plein écran')
  console.log('E2E · redimensionnement manuel et plein écran vérifiés')

  await page.getByRole('tab', { name: /Correctifs/ }).click()
  assert.equal(await page.locator('.fix-list article').count(), 2)
  await page.getByRole('button', { name: 'Construire le staging' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: /^Staging/ }).isEnabled(), true)
  await dismissToast()
  console.log('E2E · premier staging construit depuis les choix validés')

  // Toute mutation du plan invalide immédiatement le staging et verrouille l'export.
  await page.locator('.fix-list article').filter({ hasText: 'stabilise le menu' }).getByRole('button').click()
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
  await page.getByRole('tab', { name: 'Assistant' }).click()
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
  await page.locator('.message--system').filter({ hasText: 'Ajustement validé et ajouté au plan' }).last().waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: /^Staging/ }).isDisabled(), true)
  await dismissToast()
  await page.getByRole('tab', { name: /Correctifs/ }).click()
  assert.equal(await page.locator('.fix-list article').count(), 2)
  await page.getByRole('button', { name: 'Construire le staging' }).click()
  await page.locator('.staging-summary').waitFor({ state: 'visible' })
  await dismissToast()
  console.log('E2E · ajustement déterministe prévisualisé, validé et reconstruit')

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

  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  let recentIncomplete = page.locator('.recent-row').filter({ hasText: 'Site incomplet' })
  await recentIncomplete.waitFor({ state: 'visible' })
  assert.match(await recentIncomplete.textContent(), /Disponible/)
  await recentIncomplete.getByRole('button', { name: 'Réanalyser' }).click()
  await page.locator('.project-identity').getByText('Site incomplet', { exact: true }).waitFor()
  await page.locator('.readiness-card').waitFor({ state: 'visible' })
  assert.equal(await page.locator('iframe').count(), 0)
  await page.getByRole('button', { name: 'Ouvrir la démo locale' }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  recentIncomplete = page.locator('.recent-row').filter({ hasText: 'Site incomplet' })
  await recentIncomplete.waitFor({ state: 'visible' })
  await dismissToast()
  await page.locator('.projects-page').screenshot({ path: join(root, 'output', 'playwright', 'electron-project-history.png'), animations: 'disabled' })
  await recentIncomplete.getByRole('button', { name: 'Retirer Site incomplet de l’historique' }).click()
  await recentIncomplete.waitFor({ state: 'detached' })
  console.log('E2E · ancien projet local retrouvé puis retiré sans supprimer ses sources')

  for (const [file, source] of sourcesBefore) assert.equal(await readFile(join(demoRoot, file), 'utf8'), source, `${file} ne doit pas être modifié.`)
  assert.ok(pageErrors.includes('Erreur de montage contrôlée'))
  assert.deepEqual(pageErrors.filter((message) => message !== 'Erreur de montage contrôlée'), [])
  process.stdout.write('E2E Electron v0.6 : import qualifié, smoke-test runtime, historique, navigation, propositions, thème, redimensionnement, staging, révision et export — OK\n')
} finally {
  await application.close()
  await rm(testStateRoot, { recursive: true, force: true })
}
