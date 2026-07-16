import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { dismissOnboardingIfPresent } from './helpers/onboarding.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const userDataRoot = await mkdtemp(join(tmpdir(), 'responsiver-remote-e2e-'))
const screenshotRoot = join(root, 'output', 'playwright')
await mkdir(screenshotRoot, { recursive: true })
let submittedMethod = null
const requests = []

const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`)
  if (request.url === '/') {
    response.writeHead(302, { location: '/home?mode=mobile#copy' })
    response.end()
    return
  }
  if (request.url === '/form') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Formulaire local</title></head><body><form method="post" action="/posted"><input name="value" value="test"><button>Envoyer</button></form></body></html>')
    return
  }
  if (request.url === '/posted') {
    submittedMethod = request.method
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Formulaire reçu</title></head><body>POST local reçu</body></html>')
    return
  }
  if (request.url === '/scroll') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Défilement synchronisé</title><style>html,body{margin:0}section{height:900px;padding:20px;box-sizing:border-box}section:nth-child(even){background:#eee}</style></head><body><main><section>Un</section><section>Deux</section><section>Trois</section><section>Quatre</section></main></body></html>`)
    return
  }
  if (request.url === '/inner-scroll') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Défilement interne synchronisé</title><style>html,body{height:100%;margin:0;overflow:hidden}main{height:100%;overflow:auto}section{height:900px;padding:20px;box-sizing:border-box}section:nth-child(even){background:#eee}</style></head><body><main><section>Un</section><section>Deux</section><section>Trois</section><section>Quatre</section></main></body></html>`)
    return
  }
  if (request.url === '/inner-scroll-shifted') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Défilement interne décalé</title><style>html,body{height:100%;margin:0;overflow:hidden}.tiny{width:80px;height:20px;overflow:auto}.tiny span{display:block;width:500px;height:40px}main{height:calc(100% - 20px);overflow:auto}section{height:900px;padding:20px;box-sizing:border-box}section:nth-child(even){background:#eee}</style></head><body><div class="tiny"><span>Contrôle secondaire</span></div><main><section>Un</section><section>Deux</section><section>Trois</section><section>Quatre</section></main></body></html>`)
    return
  }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="fr"><head><title>Audit distant contrôlé</title><style>
    body{margin:0;background:#fff;color:#111}.fixture-nav{width:100%}.fixture-nav ul{display:flex;gap:24px;min-width:1600px;margin:0;padding:12px;list-style:none}.copy{font-size:10px;line-height:11px;width:260px}.wide{width:900px;height:20px}
  </style></head><body><nav class="fixture-nav" aria-label="Navigation de test"><ul><li><a href="#un">Un</a></li><li><a href="#deux">Deux</a></li><li><a href="#trois">Trois</a></li></ul></nav><p class="copy">Ce paragraphe volontairement petit permet de vérifier la lisibilité typographique mobile avec une preuve mesurée.</p><div class="wide">Débordement contrôlé</div></body></html>`)
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Le serveur distant de test n’a pas démarré.')
const origin = `http://127.0.0.1:${address.port}`

const application = await electron.launch({
  executablePath: electronPath,
  args: [root],
  env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userDataRoot },
  timeout: 30_000
})

try {
  const page = await application.firstWindow()
  await dismissOnboardingIfPresent(page)
  page.setDefaultTimeout(30_000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.getByLabel('Adresse locale').fill(origin)
  await page.getByRole('button', { name: 'Connecter', exact: true }).click()
  const openingNotice = page.locator('.toast')
  await openingNotice.waitFor({ state: 'visible', timeout: 40_000 }).catch(async (error) => {
    const webContentsState = await application.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => ({ url: contents.getURL(), loading: contents.isLoading(), destroyed: contents.isDestroyed() })))
    const preparation = await page.locator('.preparation-overlay').textContent().catch(() => null)
    throw new Error(`${error.message}\nRequêtes: ${JSON.stringify(requests)}\nWebContents: ${JSON.stringify(webContentsState)}\nPréparation: ${preparation}`)
  })
  const openingText = await openingNotice.textContent()
  if (!openingText?.includes('Localhost ouvert')) throw new Error(`La session distante ne s’est pas ouverte : ${openingText ?? 'raison inconnue'}`)
  await page.locator('.remote-preview').waitFor({ state: 'visible' })
  await page.getByLabel('Adresse de la page distante').waitFor({ state: 'visible' })
  await page.waitForFunction((expected) => document.querySelector('[aria-label="Adresse de la page distante"]')?.value === `${expected}/home?mode=mobile#copy`, origin)

  await page.getByText('Viewport mobile non déclaré').first().waitFor({ state: 'visible' })
  await page.getByText('Texte difficile à lire sur mobile').first().waitFor({ state: 'visible' })
  await page.getByText('Navigation déséquilibrée à cette largeur').first().waitFor({ state: 'visible' })
  assert.match(await page.locator('.activity-bar').textContent(), /constats cumulés · 5 largeurs/)

  await page.getByRole('button', { name: /Studio/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.studio-screen--remote').length === 3)
  const overlayButton = page.locator('summary[aria-controls="studio-overlay-popover"]')
  assert.equal(await overlayButton.getAttribute('aria-disabled'), 'true')
  assert.match(await overlayButton.getAttribute('title'), /réservée aux rendus locaux/)
  const captureButton = page.getByRole('button', { name: /capture groupée des vues URL natives/i })
  assert.equal(await captureButton.isDisabled(), true)
  const remoteCards = page.locator('.studio-screen--remote')
  assert.equal(await remoteCards.count(), 3)
  assert.equal(await remoteCards.filter({ has: page.locator('.studio-screen__pilot.is-active') }).count(), 1)
  const pilotCard = page.locator('.studio-screen--remote.is-pilot')
  await pilotCard.getByLabel('Adresse de la page distante').fill(`${origin}/scroll`)
  await pilotCard.getByLabel('Adresse de la page distante').press('Enter')
  await page.waitForFunction((expected) => [...document.querySelectorAll('.studio-screen--remote.is-linked [aria-label="Adresse de la page distante"]')].every((input) => input.value === expected), `${origin}/scroll`, { timeout: 12_000 }).catch(async (error) => {
    const values = await page.locator('.studio-screen--remote').evaluateAll((cards) => cards.map((card) => ({ classes: card.className, value: card.querySelector('[aria-label="Adresse de la page distante"]')?.value, footer: card.querySelector(':scope > footer code')?.textContent })))
    const synchronizations = await page.getByLabel(/Régler les synchronisations/).getAttribute('aria-label')
    const toast = await page.locator('.toast').textContent().catch(() => null)
    const remoteContents = await application.evaluate(({ webContents }, expectedOrigin) => webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith(expectedOrigin)).map((contents) => ({ id: contents.id, url: contents.getURL(), loading: contents.isLoading() })), origin)
    throw new Error(`${error.message}\nStudio distant : ${JSON.stringify(values)}\nSynchronisations : ${synchronizations}\nToast : ${toast}\nWebContents : ${JSON.stringify(remoteContents)}`)
  })
  await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const views = webContents.getAllWebContents().filter((contents) => contents.getURL() === `${expectedOrigin}/scroll`).sort((left, right) => left.id - right.id)
    if (views.length !== 3) throw new Error(`Trois vues distantes attendues, ${views.length} trouvée(s).`)
    await views[0].executeJavaScript('scrollTo(0, 1700)')
  }, origin)
  const synchronizedScroll = async () => application.evaluate(async ({ webContents }, expectedOrigin) => {
    const views = webContents.getAllWebContents().filter((contents) => contents.getURL() === `${expectedOrigin}/scroll`)
    return Promise.all(views.map((contents) => contents.executeJavaScript('scrollY')))
  }, origin)
  const scrollDeadline = Date.now() + 8_000
  let scrollValues = await synchronizedScroll()
  while ((scrollValues.length !== 3 || scrollValues.some((value) => value < 900)) && Date.now() < scrollDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    scrollValues = await synchronizedScroll()
  }
  assert.equal(scrollValues.length, 3)
  assert.ok(scrollValues.every((value) => value >= 900), `Défilements distants non synchronisés : ${scrollValues.join(', ')}`)

  const isolatedCard = remoteCards.last()
  const isolatedName = await isolatedCard.locator('.studio-screen__identity strong').textContent()
  await isolatedCard.getByRole('button', { name: new RegExp(`Isoler ${isolatedName}`) }).click()
  await pilotCard.getByLabel('Adresse de la page distante').fill(`${origin}/form`)
  await pilotCard.getByLabel('Adresse de la page distante').press('Enter')
  await page.waitForFunction((expected) => [...document.querySelectorAll('.studio-screen--remote.is-linked [aria-label="Adresse de la page distante"]')].every((input) => input.value === expected), `${origin}/form`)
  assert.equal(await isolatedCard.getByLabel('Adresse de la page distante').inputValue(), `${origin}/scroll`)
  const isolatedScroll = await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const isolated = webContents.getAllWebContents().find((contents) => contents.getURL() === `${expectedOrigin}/scroll`)
    if (!isolated) throw new Error('Vue isolée introuvable après la navigation du pilote.')
    return isolated.executeJavaScript('scrollY')
  }, origin)
  assert.ok(isolatedScroll >= 900, `La vue isolée a perdu sa position de scroll : ${isolatedScroll}px.`)
  await pilotCard.getByLabel('Adresse de la page distante').fill(`${origin}/home?mode=mobile#copy`)
  await pilotCard.getByLabel('Adresse de la page distante').press('Enter')
  await page.waitForFunction((expected) => [...document.querySelectorAll('.studio-screen--remote.is-linked [aria-label="Adresse de la page distante"]')].every((input) => input.value === expected), `${origin}/home?mode=mobile#copy`)
  await page.getByRole('button', { name: 'Appareil', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.remote-preview').length === 1)

  const auditLimits = await page.evaluate(() => window.responsiver.auditRemote([
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, touch: true }
  ]))
  assert.equal(auditLimits.truncated, false)
  assert.ok(auditLimits.scannedNodes > 0 && auditLimits.scannedNodes <= auditLimits.maxNodes)
  assert.equal(auditLimits.maxNodes, 5_000)
  assert.equal(auditLimits.maxFindings, 60)
  assert.equal(auditLimits.maxTotalFindings, 20)
  assert.ok(auditLimits.findings.every((finding) => finding.routePath === '/home?mode=mobile#copy'))
  const focus = await page.evaluate(() => window.responsiver.focusRemoteFinding('.copy'))
  assert.deepEqual(focus, { found: true, selector: '.copy', path: '/home?mode=mobile#copy' })

  const addressInput = page.getByLabel('Adresse de la page distante')
  await addressInput.fill(`${origin}/form`)
  await addressInput.press('Enter')
  await page.waitForFunction((expected) => document.querySelector('[aria-label="Adresse de la page distante"]')?.value === expected, `${origin}/form`)
  await page.getByText('2 routes auditées').waitFor({ state: 'visible', timeout: 30_000 })

  await page.getByRole('group', { name: 'Portée des constats' }).getByRole('button', { name: /Toutes les pages/ }).click()
  await page.locator('.issue-item').filter({ hasText: 'Texte difficile à lire sur mobile' }).first().click()
  await page.waitForFunction((expected) => document.querySelector('[aria-label="Adresse de la page distante"]')?.value === expected, `${origin}/home?mode=mobile#copy`)
  await page.getByText(/élément mesuré est mis en évidence/i).waitFor({ state: 'visible' })

  await page.getByRole('button', { name: 'Exporter', exact: true }).click()
  await page.getByRole('heading', { name: 'Rapport exploitable' }).waitFor({ state: 'visible' })
  assert.match(await page.locator('.remote-report-ledger').textContent(), /2 routes/)
  await page.locator('.remote-report-page').screenshot({ path: join(screenshotRoot, 'remote-report.png'), animations: 'disabled' })
  await page.getByRole('button', { name: /Revenir au laboratoire/ }).click()
  await page.locator('.remote-preview').waitFor({ state: 'visible' })
  const restoredAddressInput = page.getByLabel('Adresse de la page distante')
  await restoredAddressInput.fill(`${origin}/form`)
  await restoredAddressInput.press('Enter')
  await page.waitForFunction((expected) => document.querySelector('[aria-label="Adresse de la page distante"]')?.value === expected, `${origin}/form`)
  await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    if (!remote) throw new Error('WebContents distant introuvable.')
    await remote.executeJavaScript('document.querySelector("form").requestSubmit()')
  }, origin)
  const deadline = Date.now() + 10_000
  while (submittedMethod === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(submittedMethod, 'POST')
  await page.waitForFunction((expected) => document.querySelector('[aria-label="Adresse de la page distante"]')?.value === expected, `${origin}/posted`)
  await page.getByRole('button', { name: 'Afficher la prévisualisation en plein écran' }).click()
  await page.locator('.stage-column.is-fullscreen').waitFor({ state: 'visible' })
  await application.evaluate(({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === `${expectedOrigin}/posted`)
      .sort((left, right) => left.id - right.id)[0]
    if (!remote) throw new Error('Vue distante principale introuvable pour tester la sortie par Échap.')
    remote.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  }, origin)
  await page.locator('.stage-column.is-fullscreen').waitFor({ state: 'detached' })
  const multiView = await page.evaluate(async (expectedOrigin) => {
    const project = await window.responsiver.openRemoteUrl({ url: `${expectedOrigin}/scroll`, mode: 'localhost' })
    const secondaryIds = ['e2e-secondary-1', 'e2e-secondary-2', 'e2e-secondary-3', 'e2e-secondary-4']
    const secondaryStates = []
    for (const viewId of secondaryIds) {
      const request = { projectId: project.id, viewId }
      await window.responsiver.setRemoteBounds({
        ...request,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        scale: 1,
        visible: false,
        viewport: { width: 390, height: 844, mobile: true, touch: true }
      })
      secondaryStates.push(await window.responsiver.getRemoteState(request))
    }
    let overflowMessage = ''
    try {
      await window.responsiver.getRemoteState({ projectId: project.id, viewId: 'e2e-secondary-5' })
    } catch (error) {
      overflowMessage = error instanceof Error ? error.message : String(error)
    }
    const request = { projectId: project.id, viewId: secondaryIds[0] }
    const legacy = await window.responsiver.getRemoteState()
    const requestedScroll = { version: 1, xProgress: 0, yProgress: 0.6, anchor: { kind: 'section', index: 2, viewportOffset: 0.15 } }
    await window.responsiver.applyRemoteScroll({ projectId: project.id, snapshot: requestedScroll })
    const sourceScroll = await window.responsiver.readRemoteScroll({ projectId: project.id })
    const targetScroll = await window.responsiver.applyRemoteScroll({ ...request, snapshot: sourceScroll })
    await Promise.all(secondaryIds.map((viewId) => window.responsiver.releaseRemoteView({ projectId: project.id, viewId })))

    const replacementIds = ['e2e-replacement-1', 'e2e-replacement-2', 'e2e-replacement-3', 'e2e-replacement-4']
    const replacementStates = await Promise.all(replacementIds.map((viewId) => window.responsiver.getRemoteState({ projectId: project.id, viewId })))
    await window.responsiver.navigateRemote('url', `${expectedOrigin}/inner-scroll`, { projectId: project.id })
    await Promise.all(replacementIds.map((viewId, index) => window.responsiver.navigateRemote('url', `${expectedOrigin}/${index === 0 ? 'inner-scroll-shifted' : 'inner-scroll'}`, { projectId: project.id, viewId })))
    const documentToInnerScroll = await window.responsiver.applyRemoteScroll({ projectId: project.id, viewId: replacementIds[0], snapshot: sourceScroll })
    const requestedInnerScroll = { version: 1, xProgress: 0, yProgress: 0.65, container: { kind: 'scrollable', index: 0 }, anchor: null }
    const sourceInnerScroll = await window.responsiver.applyRemoteScroll({ projectId: project.id, snapshot: requestedInnerScroll })
    const targetInnerScroll = await window.responsiver.applyRemoteScroll({ projectId: project.id, viewId: replacementIds[0], snapshot: sourceInnerScroll })
    await Promise.all(replacementIds.map((viewId) => window.responsiver.releaseRemoteView({ projectId: project.id, viewId })))
    return { projectId: project.id, secondaryStates, replacementStates, overflowMessage, legacy, sourceScroll, targetScroll, documentToInnerScroll, sourceInnerScroll, targetInnerScroll }
  }, origin)
  assert.deepEqual(multiView.secondaryStates.map((state) => state.viewId), ['e2e-secondary-1', 'e2e-secondary-2', 'e2e-secondary-3', 'e2e-secondary-4'])
  assert.ok(multiView.secondaryStates.every((state) => state.path === '/scroll'))
  assert.match(multiView.overflowMessage, /limite le Studio distant à 5 vues/)
  assert.equal(multiView.legacy.viewId, undefined)
  assert.equal(multiView.legacy.path, '/scroll')
  assert.deepEqual(Object.keys(multiView.sourceScroll).sort(), ['anchor', 'version', 'xProgress', 'yProgress'])
  assert.ok(multiView.sourceScroll.yProgress > 0.4)
  assert.ok(Math.abs(multiView.sourceScroll.yProgress - multiView.targetScroll.yProgress) < 0.08)
  assert.deepEqual(multiView.targetScroll.anchor?.kind, multiView.sourceScroll.anchor?.kind)
  assert.deepEqual(multiView.replacementStates.map((state) => state.viewId), ['e2e-replacement-1', 'e2e-replacement-2', 'e2e-replacement-3', 'e2e-replacement-4'])
  assert.ok(multiView.replacementStates.every((state) => state.path === '/scroll'))
  assert.deepEqual(multiView.documentToInnerScroll.container, { kind: 'scrollable', index: 1 })
  assert.ok(multiView.documentToInnerScroll.yProgress > 0.4)
  assert.deepEqual(multiView.sourceInnerScroll.container, { kind: 'scrollable', index: 0 })
  assert.ok(multiView.sourceInnerScroll.yProgress > 0.4)
  assert.ok(Math.abs(multiView.sourceInnerScroll.yProgress - multiView.targetInnerScroll.yProgress) < 0.08)
  assert.deepEqual(multiView.targetInnerScroll.container, { kind: 'scrollable', index: 1 })
  assert.deepEqual(pageErrors, [])
  process.stdout.write('E2E distant : redirection, audit mobile, formulaire localhost et multi-vue — OK\n')
} finally {
  await application.close().catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
  await rm(userDataRoot, { recursive: true, force: true })
}
