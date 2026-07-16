import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { dismissOnboardingIfPresent } from './helpers/onboarding.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const stateRoot = await mkdtemp(join(tmpdir(), 'responsiver-studio-e2e-'))
const projectRoot = join(stateRoot, 'Projet Studio')
const userDataRoot = join(stateRoot, 'user-data')
const screenshotRoot = join(root, 'output', 'playwright')
const overlayPath = join(stateRoot, 'reference.png')
const pageErrors = []

await Promise.all([
  mkdir(projectRoot, { recursive: true }),
  mkdir(userDataRoot, { recursive: true }),
  mkdir(screenshotRoot, { recursive: true })
])

await writeFile(join(projectRoot, 'index.html'), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Studio</title>
<style>body{margin:0;font:16px system-ui;background:#f6f4ef;color:#20211f}header{position:sticky;top:0;padding:20px;background:#fff;border-bottom:1px solid #ccc}main{min-height:2200px;padding:24px}.spacer{height:1450px}.panel{padding:32px;background:#dce8df}.panel[hidden]{display:none}</style></head>
<body><header><a href="second.html">Deuxième page</a> <button id="toggle" type="button" aria-pressed="false" aria-controls="panel">Afficher le panneau</button></header>
<main><h1>Planche responsive</h1><div class="spacer"></div><section id="bottom"><h2>Repère de défilement</h2><div id="panel" class="panel" hidden>Panneau synchronisé</div></section></main>
<script>document.querySelector('#toggle').addEventListener('click',event=>{const active=event.currentTarget.getAttribute('aria-pressed')!=='true';event.currentTarget.setAttribute('aria-pressed',String(active));document.querySelector('#panel').hidden=!active})</script></body></html>`)
await writeFile(join(projectRoot, 'second.html'), '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Deuxième</title></head><body><h1>Deuxième page synchronisée</h1><a href="index.html">Retour</a></body></html>')
await writeFile(join(projectRoot, 'internal.html'), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Défilement interne</title>
<style>html,body{height:100%;margin:0;overflow:hidden}body{font:16px system-ui;background:#f6f4ef;color:#20211f}main{height:100%;overflow:auto}.head{position:sticky;top:0;padding:20px;background:#fff;border-bottom:1px solid #ccc}.spacer{height:1500px}.target{min-height:300px;padding:32px;background:#dce8df}</style></head>
<body><main><div class="head"><a href="index.html">Accueil</a><h1>Défilement dans un conteneur</h1></div><div class="spacer"></div><section class="target"><h2>Repère interne synchronisé</h2></section></main></body></html>`)
await writeFile(overlayPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+3X3sWQAAAABJRU5ErkJggg==', 'base64'))

const application = await electron.launch({
  executablePath: electronPath,
  args: [root],
  env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userDataRoot },
  timeout: 30_000
})

try {
  const page = await application.firstWindow({ timeout: 45_000 })
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await dismissOnboardingIfPresent(page)

  await page.getByLabel('Chemin local').fill(projectRoot)
  await page.locator('.path-bar').getByRole('button', { name: 'Ouvrir' }).click()
  await page.locator('.stage-canvas iframe').first().waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /Studio/ }).click()
  const wall = page.locator('.studio-wall')
  await wall.waitFor({ state: 'visible' })
  assert.equal(await page.locator('.studio-screen').count(), 3)
  await page.getByRole('button', { name: 'Afficher le panneau de constats' }).waitFor({ state: 'visible' })
  assert.equal(await page.locator('.lab-grid > .inspector').count(), 0)
  const stageWidthWithoutPanel = (await page.locator('.stage-column').boundingBox())?.width ?? 0
  await page.getByRole('button', { name: 'Afficher le panneau de constats' }).click()
  await page.locator('.lab-grid > .inspector').waitFor({ state: 'visible' })
  const stageWidthWithPanel = (await page.locator('.stage-column').boundingBox())?.width ?? 0
  assert.ok(stageWidthWithoutPanel > stageWidthWithPanel)
  await page.getByRole('button', { name: 'Masquer le panneau de constats' }).click()

  await page.getByLabel('Suite', { exact: true }).selectOption('suite-mobile')
  await page.waitForFunction(() => document.querySelectorAll('.studio-screen').length === 5)
  assert.equal(await page.locator('.studio-screen.is-pilot').count(), 1)
  assert.equal(await page.locator('.studio-screen.is-linked').count(), 5)

  await page.getByRole('button', { name: 'Grille', exact: true }).click()
  assert.match(await wall.getAttribute('class') ?? '', /studio-wall--grid/)
  const focusCard = page.locator('.studio-screen').nth(2)
  await focusCard.hover()
  const focusButton = focusCard.getByRole('button', { name: /Afficher .* en focus/ })
  await focusButton.click()
  assert.match(await wall.getAttribute('class') ?? '', /studio-wall--focus/)
  assert.equal(await page.locator('.studio-screen.is-focused').count(), 1)

  const isolatedCard = page.locator('.studio-screen').last()
  const isolatedName = await isolatedCard.locator('.studio-screen__identity strong').textContent()
  await isolatedCard.hover()
  await isolatedCard.getByRole('button', { name: new RegExp(`Isoler ${isolatedName}`) }).click()
  await isolatedCard.waitFor({ state: 'visible' })
  assert.match(await isolatedCard.getAttribute('class') ?? '', /is-isolated/)

  await page.getByLabel('Régler les synchronisations').click()
  await page.getByLabel('Interactions sûres').check()
  await page.getByLabel('Régler les synchronisations').click()
  await page.evaluate(() => {
    window.__studioSyncMessages = []
    window.addEventListener('message', (event) => {
      if (event.data?.channel === 'responsiver-preview' && String(event.data?.type ?? '').startsWith('sync-')) window.__studioSyncMessages.push({ type: event.data.type, eventId: event.data.eventId, documentId: event.data.documentId })
    })
  })
  const pilotFrame = page.locator('.studio-screen.is-pilot iframe').contentFrame()
  const pilotIframeBox = await page.locator('.studio-screen.is-pilot iframe').boundingBox()
  const pilotViewport = await pilotFrame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const pilotToggleRect = await pilotFrame.locator('#toggle').evaluate((element) => {
    const rectangle = element.getBoundingClientRect()
    return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
  })
  assert.ok(pilotIframeBox)
  await page.mouse.click(
    pilotIframeBox.x + (pilotToggleRect.x + pilotToggleRect.width / 2) * pilotIframeBox.width / pilotViewport.width,
    pilotIframeBox.y + (pilotToggleRect.y + pilotToggleRect.height / 2) * pilotIframeBox.height / pilotViewport.height
  )
  await pilotFrame.locator('#toggle[aria-pressed="true"]').waitFor({ state: 'attached' })
  const linkedFrames = page.locator('.studio-screen.is-linked iframe')
  const linkedCount = await linkedFrames.count()
  assert.ok(linkedCount >= 2)
  try {
    for (let index = 0; index < linkedCount; index += 1) {
      await linkedFrames.nth(index).contentFrame().locator('#toggle[aria-pressed="true"]').waitFor({ state: 'attached' })
    }
  } catch (error) {
    const values = []
    for (let index = 0; index < linkedCount; index += 1) values.push(await linkedFrames.nth(index).contentFrame().locator('#toggle').getAttribute('aria-pressed').catch(() => null))
    const messages = await page.evaluate(() => window.__studioSyncMessages)
    throw new Error(`${error.message}\nDiagnostic synchronisation : ${JSON.stringify({ values, messages })}`)
  }
  assert.equal(await isolatedCard.locator('iframe').contentFrame().locator('#toggle').getAttribute('aria-pressed'), 'false')

  await pilotFrame.locator('#bottom').scrollIntoViewIfNeeded()
  for (let index = 0; index < linkedCount; index += 1) {
    await linkedFrames.nth(index).contentFrame().locator('html').evaluate(async () => {
      for (let attempt = 0; attempt < 90 && scrollY <= 900; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
      if (scrollY <= 900) throw new Error(`Défilement synchronisé absent : ${scrollY}px.`)
    })
  }

  await page.locator('.studio-screen.is-pilot .browser-bar select').selectOption('/internal.html')
  for (let index = 0; index < linkedCount; index += 1) {
    await linkedFrames.nth(index).contentFrame().getByText('Défilement dans un conteneur').waitFor({ state: 'visible' })
  }
  await page.locator('.studio-screen.is-pilot iframe').contentFrame().locator('main').evaluate((element) => element.scrollTo(0, 1_200))
  for (let index = 0; index < linkedCount; index += 1) {
    await linkedFrames.nth(index).contentFrame().locator('main').evaluate(async (element) => {
      for (let attempt = 0; attempt < 90 && element.scrollTop <= 900; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
      if (element.scrollTop <= 900) throw new Error(`Défilement interne synchronisé absent : ${element.scrollTop}px.`)
    })
  }
  assert.match(await isolatedCard.locator('iframe').getAttribute('src') ?? '', /index\.html/)

  await page.locator('.studio-screen.is-pilot .browser-bar select').selectOption('/second.html')
  for (let index = 0; index < linkedCount; index += 1) {
    await linkedFrames.nth(index).contentFrame().getByText('Deuxième page synchronisée').waitFor({ state: 'visible' })
  }
  assert.match(await isolatedCard.locator('iframe').getAttribute('src') ?? '', /index\.html/)

  await page.getByLabel('Régler la superposition d’une maquette').click()
  await page.locator('.studio-controls__file').setInputFiles(overlayPath)
  await page.waitForFunction(() => document.querySelectorAll('.studio-screen .preview-design-overlay').length === 5)
  await page.waitForFunction(() => [...document.querySelectorAll('.studio-screen .preview-design-overlay')].every((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0))
  assert.equal(await page.locator('.preview-design-overlay').first().evaluate((element) => getComputedStyle(element).pointerEvents), 'none')
  await page.getByRole('button', { name: 'Appareil', exact: true }).click()
  await page.getByRole('button', { name: /Studio/ }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.studio-screen .preview-design-overlay')].length === 5 && [...document.querySelectorAll('.studio-screen .preview-design-overlay')].every((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0))
  await page.getByLabel('Régler la superposition d’une maquette').click()
  await page.getByRole('button', { name: 'Retirer la maquette' }).click()
  await page.getByLabel('Régler la superposition d’une maquette').click()
  await page.locator('.studio-screen.is-pilot .browser-bar select').selectOption('/index.html')
  await pilotFrame.getByText('Planche responsive').waitFor({ state: 'visible' })
  await pilotFrame.locator('html').evaluate(() => scrollTo(0, 0))
  for (let index = 0; index < linkedCount; index += 1) {
    await linkedFrames.nth(index).contentFrame().locator('html').evaluate(async () => {
      for (let attempt = 0; attempt < 60 && scrollY > 20; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
      if (scrollY > 20) throw new Error(`Retour synchronisé en haut absent : ${scrollY}px.`)
    })
  }

  const documentIdentities = []
  for (let index = 0; index < linkedCount; index += 1) {
    documentIdentities.push(await linkedFrames.nth(index).contentFrame().locator('html').evaluate(() => {
      window.__responsiverDocumentIdentity ||= `${Date.now()}-${Math.random()}`
      return window.__responsiverDocumentIdentity
    }))
  }
  await pilotFrame.locator('#bottom').evaluate((element) => { location.hash = element.id })
  await page.waitForTimeout(700)
  for (let index = 0; index < linkedCount; index += 1) {
    const identity = await linkedFrames.nth(index).contentFrame().locator('html').evaluate(() => window.__responsiverDocumentIdentity)
    assert.equal(identity, documentIdentities[index], `L’ancre ne doit pas remonter la vue liée ${index + 1}.`)
  }

  await page.getByLabel('Ouvrir la bibliothèque d’appareils').click()
  const library = page.getByRole('dialog', { name: 'Composer la planche d’écrans' })
  await library.waitFor({ state: 'visible' })
  assert.ok(await library.locator('.studio-device-card').count() >= 60)
  await library.getByPlaceholder('Modèle, marque, format…').fill('Surface Pro')
  assert.ok(await library.locator('.studio-device-card').count() >= 1)
  await library.locator('.studio-library__active button').last().click()
  await library.getByRole('button', { name: 'Format personnalisé' }).click()
  const customForm = library.locator('.studio-custom-device')
  await customForm.getByLabel('Nom').fill('Viewport QA')
  await customForm.getByLabel('Largeur').fill('412')
  await customForm.getByLabel('Hauteur').fill('915')
  await customForm.getByLabel('DPR').fill('2.75')
  await customForm.getByRole('button', { name: 'Créer le format' }).click()
  await library.locator('.studio-device-chip', { hasText: 'Viewport QA' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelectorAll('.studio-screen').length === 5)
  await library.getByRole('button', { name: 'Utiliser cette planche' }).click()

  await page.waitForTimeout(5_200)
  await wall.evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0 })
  await page.screenshot({ path: join(screenshotRoot, 'studio-multi-ecrans.png'), animations: 'disabled' })
  assert.deepEqual(pageErrors, [])
  console.log('E2E · Studio 1–5 écrans, suites, focus, isolation, synchronisations, overlay et bibliothèque')
} finally {
  await application.close().catch(() => undefined)
  await rm(stateRoot, { recursive: true, force: true })
}
