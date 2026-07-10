import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

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

  await page.getByRole('button', { name: 'Toutes les pages' }).click()
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
  assert.deepEqual(pageErrors, [])
  process.stdout.write('E2E distant : redirection, audit mobile et formulaire localhost — OK\n')
} finally {
  await application.close().catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
  await rm(userDataRoot, { recursive: true, force: true })
}
