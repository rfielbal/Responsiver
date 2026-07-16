import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { dismissOnboardingIfPresent } from './helpers/onboarding.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const state = await mkdtemp(join(tmpdir(), 'responsiver-matrix-e2e-'))
const userData = join(state, 'user-data')
const projectRoot = join(state, 'project')
const screenshotRoot = join(root, 'output', 'playwright')
await mkdir(userData, { recursive: true })
await mkdir(screenshotRoot, { recursive: true })
await cp(join(root, 'demo', 'atelier'), projectRoot, { recursive: true })
const fixtureHtmlPath = join(projectRoot, 'index.html')
const fixtureHtml = await readFile(fixtureHtmlPath, 'utf8')
await writeFile(fixtureHtmlPath, fixtureHtml
  .replace('</head>', '<style>.site-nav > * { pointer-events: none !important; }</style></head>')
  .replace('<nav class="site-nav"', '<button class="menu-toggle" style="position:fixed;right:8px;bottom:8px;z-index:99" type="button" aria-controls="matrix-nav" aria-expanded="false">Menu</button>\n      <nav class="site-nav"')
  .replace('<script src="./script.js"></script>', `<script>
      document.querySelector('.menu-toggle')?.addEventListener('click', (event) => {
        event.currentTarget.setAttribute('aria-expanded', event.currentTarget.getAttribute('aria-expanded') === 'true' ? 'false' : 'true')
      })
    </script>
    <script src="./script.js"></script>`))
const originalCss = await readFile(join(projectRoot, 'styles.css'), 'utf8')
const originalHtml = await readFile(join(projectRoot, 'index.html'), 'utf8')
const generatedStyles = join(projectRoot, '.responsiver', 'responsiver.generated.css')
const application = await electron.launch({ executablePath: electronPath, args: [root], env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userData }, timeout: 30_000 })

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(20_000)
  await page.waitForLoadState('domcontentloaded')
  await dismissOnboardingIfPresent(page)
  await page.getByLabel('Chemin local').fill(projectRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })

  // La cascade doit relier la règle calculée comme gagnante au fichier et à
  // l'emplacement estimé de sa déclaration.
  await page.getByRole('button', { name: 'Inspecter', exact: true }).click()
  await page.locator('.stage-inspect.is-active:not(.is-starting)').waitFor({ state: 'visible' })
  const preview = page.frameLocator('.stage-canvas iframe').first()
  await preview.locator('.site-nav').click({ position: { x: 4, y: 4 } })
  const inspector = page.locator('.quick-inspector')
  await inspector.locator('code').filter({ hasText: '.site-nav' }).first().waitFor({ state: 'visible' })
  await inspector.getByRole('tab', { name: /Origine/ }).click()
  const property = inspector.locator('.cascade-panel select')
  await property.waitFor({ state: 'visible' })
  await property.selectOption('min-width')
  const sourceLink = inspector.locator('.cascade-winner button').filter({ hasText: /styles\.css:40/ })
  await sourceLink.waitFor({ state: 'visible' })
  await sourceLink.click()
  await page.locator('.code-editor-toolbar').getByText('styles.css', { exact: true }).waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
  const visibleLineNumbers = await page.locator('.margin-view-overlays .line-numbers').allTextContents()
  assert.ok(visibleLineNumbers.map((value) => value.trim()).includes('40'), `La ligne 40 doit être révélée dans Monaco (lignes visibles : ${visibleLineNumbers.join(', ')}).`)
  console.log('E2E · cascade gagnante reliée à styles.css:40 et ouverte dans Monaco')

  // Correction Express construit le staging, compare les mêmes vues et ne
  // touche au disque qu'après la confirmation explicite du résultat vert.
  await page.getByRole('button', { name: 'Laboratoire', exact: true }).click()
  await page.getByRole('tab', { name: /Code & structure/ }).click()
  const rigidWidth = page.locator('.issue-row').filter({ hasText: 'Largeur minimale rigide' }).first()
  await rigidWidth.waitFor({ state: 'visible' })
  await rigidWidth.getByRole('checkbox').check()
  const express = page.locator('.change-plan-bar').getByRole('button', { name: /Corriger et vérifier \(1\)/ })
  await express.click()
  const verdict = page.locator('.express-verdict.is-passed')
  const verificationOutcome = page.locator('.express-verdict, .matrix-verdict').first()
  await verificationOutcome.waitFor({ state: 'visible', timeout: 90_000 })
  assert.match(await verificationOutcome.getAttribute('class') ?? '', /is-passed/, await verificationOutcome.textContent() ?? 'La vérification Express n’a pas produit de verdict vert.')
  await verdict.waitFor({ state: 'visible' })
  assert.match(await verdict.textContent(), /0 régression/)
  assert.equal(await readFile(join(projectRoot, 'styles.css'), 'utf8'), originalCss, 'La vérification ne doit pas écrire les sources.')

  await page.getByRole('button', { name: 'Matrice', exact: true }).click()
  const board = page.locator('.matrix-board')
  await board.waitFor({ state: 'visible' })
  const matrixHeader = page.locator('.matrix-hero')
  const matrixHeaderBox = await matrixHeader.boundingBox()
  assert.ok(matrixHeaderBox && matrixHeaderBox.height <= 90, `L’en-tête de la Matrice doit rester compact (${matrixHeaderBox?.height ?? 'absent'} px).`)
  assert.equal(await matrixHeader.locator('button:visible').count(), 1, 'Une seule action de matrice doit rester visible en permanence.')
  await matrixHeader.getByRole('button', { name: 'Comparer la version préparée' }).waitFor({ state: 'visible' })
  await matrixHeader.locator('.matrix-more-actions > summary').click()
  await matrixHeader.getByRole('button', { name: 'Auditer de nouveau la source' }).waitFor({ state: 'visible' })
  await matrixHeader.locator('.matrix-more-actions > summary').click()

  const matrixVerdict = page.locator('.matrix-verdict')
  assert.match(await matrixVerdict.textContent(), /Comparaison validée/)
  assert.equal(await matrixVerdict.getAttribute('open'), null, 'Le détail d’un verdict validé doit être replié par défaut.')
  assert.match(await matrixVerdict.locator('summary').textContent(), /\d+ corrigés.*\d+ nouveaux.*\d+ restants/s)
  await matrixVerdict.locator('summary').click()
  await matrixVerdict.locator('.matrix-verdict-details').waitFor({ state: 'visible' })
  assert.match(await matrixVerdict.locator('.matrix-verdict-details').textContent(), /vues comparées.*aucun nouveau défaut/i)
  await matrixVerdict.locator('summary').click()
  assert.equal(await matrixVerdict.getAttribute('open'), null)
  assert.ok(await page.locator('.matrix-cell').count() >= 6)
  await page.locator('.app-main').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: join(screenshotRoot, 'matrix-responsive.png'), animations: 'disabled' })

  const navigationRow = page.locator('.matrix-grid-route').filter({ hasText: 'Navigation ouverte' }).filter({ hasText: '/index.html' })
  await navigationRow.locator('xpath=following-sibling::button[1]').click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.device-controls input').nth(0).inputValue(), '393', 'Une cellule doit restaurer son format dans le Laboratoire.')
  await page.frameLocator('.stage-canvas iframe').locator('.menu-toggle[aria-expanded="true"]').waitFor({ state: 'visible' })
  console.log('E2E · cellule de matrice rouverte au bon format et dans son état navigation ouverte')

  await page.getByRole('tab', { name: 'Correctifs', exact: true }).click()
  const applyVerified = page.locator('.express-verdict').getByRole('button', { name: 'Appliquer la version vérifiée' })

  // Une source qui n'appartient pas aux fichiers écrits par le staging peut
  // tout de même modifier le rendu. Le fingerprint projet doit donc invalider
  // le verdict avant la moindre écriture.
  const concurrentCss = `${originalCss}\n/* Mutation externe après vérification. */\n`
  await writeFile(join(projectRoot, 'styles.css'), concurrentCss)
  await applyVerified.click()
  await page.locator('.toast').filter({ hasText: /changé|modifi|vérification.*valide/i }).waitFor({ state: 'visible' })
  assert.equal(await readFile(join(projectRoot, 'styles.css'), 'utf8'), concurrentCss)
  assert.equal(await readFile(join(projectRoot, 'index.html'), 'utf8'), originalHtml, 'Le rejet de la preuve périmée ne doit modifier aucun autre fichier.')
  await assert.rejects(readFile(generatedStyles, 'utf8'), { code: 'ENOENT' })

  await writeFile(join(projectRoot, 'styles.css'), originalCss)
  await page.locator('.express-verdict').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Corriger et vérifier', exact: true }).click()
  await verificationOutcome.waitFor({ state: 'visible', timeout: 90_000 })
  assert.match(await verificationOutcome.getAttribute('class') ?? '', /is-passed/, await verificationOutcome.textContent() ?? 'La revérification Express n’a pas produit de verdict vert.')
  await verdict.waitFor({ state: 'visible' })
  assert.match(await verdict.textContent(), /0 régression/)
  console.log('E2E · mutation externe bloquée puis version restaurée revérifiée')

  await page.locator('.express-verdict').getByRole('button', { name: 'Appliquer la version vérifiée' }).click()
  await page.locator('.toast').filter({ hasText: 'Correctif vérifié appliqué' }).waitFor({ state: 'visible' })
  assert.match(await readFile(generatedStyles, 'utf8'), /\.site-nav/)
  assert.notEqual(await readFile(join(projectRoot, 'index.html'), 'utf8'), originalHtml)
  const undo = page.locator('.change-plan-bar').getByRole('button', { name: 'Annuler la dernière application' })
  await undo.waitFor({ state: 'visible' })
  await undo.click()
  await page.locator('.toast').filter({ hasText: 'dernière application a été annulée' }).waitFor({ state: 'visible' })
  assert.equal(await readFile(join(projectRoot, 'styles.css'), 'utf8'), originalCss)
  assert.equal(await readFile(join(projectRoot, 'index.html'), 'utf8'), originalHtml)
  await assert.rejects(readFile(generatedStyles, 'utf8'), { code: 'ENOENT' })
  console.log('E2E · Correction Express vérifiée, appliquée exactement puis annulée')
} finally {
  await application.close()
  await rm(state, { recursive: true, force: true })
}
