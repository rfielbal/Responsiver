import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = await mkdtemp(join(tmpdir(), 'responsiver-localhost-link-'))
const userDataRoot = join(fixtureRoot, 'user-data')
const firstRoot = join(fixtureRoot, 'sources-a')
const secondRoot = join(fixtureRoot, 'sources-b')
await Promise.all([mkdir(userDataRoot), mkdir(firstRoot), mkdir(secondRoot)])
const [canonicalFirstRoot, canonicalSecondRoot] = await Promise.all([realpath(firstRoot), realpath(secondRoot)])
await writeFile(join(firstRoot, 'styles.css'), 'body { color: #111; }\n')
await writeFile(join(firstRoot, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0', tailwindcss: '^4.0.0' } }))
await writeFile(join(firstRoot, 'composer.json'), JSON.stringify({ require: { 'symfony/framework-bundle': '^7.0' } }))
await writeFile(join(secondRoot, 'theme.css'), 'body { background: #fff; }\n')

const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  const finish = () => response.end('<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Localhost associé à chaud</title></head><body><main>Session conservée</main></body></html>')
  if (request.url?.startsWith('/lent') || request.url?.startsWith('/workspace-lent')) setTimeout(finish, 350)
  else finish()
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Le serveur localhost factice n’a pas démarré.')
const origin = `http://127.0.0.1:${address.port}`
const mainColorEdit = {
  id: 'visual-a11ce001',
  target: { selector: 'main', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true } },
  property: 'color',
  before: 'rgb(17, 17, 17)',
  after: 'rgb(185, 77, 50)',
  scope: { kind: 'all' },
  route: { kind: 'all' }
}

const application = await electron.launch({
  executablePath: electronPath,
  args: [appRoot],
  env: { ...process.env, RESPONSIVER_USER_DATA_DIR: userDataRoot },
  timeout: 30_000
})

try {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const opened = await page.evaluate((url) => window.responsiver.openRemoteUrl({ url, mode: 'localhost' }), origin)
  assert.equal(opened.source.readOnly, true)
  assert.equal(opened.source.localRoot, null)
  await assert.rejects(
    page.evaluate(({ projectId, visualEdit }) => window.responsiver.previewRemoteVisualStyle({ projectId, visualEdits: [visualEdit], route: '/' }), { projectId: opened.id, visualEdit: mainColorEdit }),
    /réservée à un localhost associé/
  )
  assert.deepEqual(
    await page.evaluate((projectId) => window.responsiver.startRemoteInspector({ projectId }), opened.id),
    { active: true, editable: false, path: '/' }
  )
  await page.evaluate((projectId) => window.responsiver.stopRemoteInspector({ projectId }), opened.id)

  const remoteIdBefore = await application.evaluate(({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.id ?? null
  }, origin)
  assert.ok(remoteIdBefore)

  const linked = await page.evaluate(
    ({ projectId, root }) => window.responsiver.associateRemoteRoot({ projectId, root }),
    { projectId: opened.id, root: firstRoot }
  )
  assert.equal(linked.source.kind, 'linked-localhost')
  assert.equal(linked.source.readOnly, false)
  assert.equal(linked.source.localRoot, canonicalFirstRoot)
  assert.equal(linked.source.url?.startsWith(origin), true)
  assert.equal(linked.capabilities.framework, 'Symfony + React + Tailwind CSS')
  await page.evaluate(() => {
    window.__responsiverRemoteShortcut = null
    window.__responsiverRemoteShortcutOff = window.responsiver.onRemoteInspectorShortcut((projectId) => {
      window.__responsiverRemoteShortcut = projectId
    })
  })
  await application.evaluate(({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    remote?.sendInputEvent({ type: 'keyDown', keyCode: 'F12' })
    remote?.sendInputEvent({ type: 'keyUp', keyCode: 'F12' })
  }, origin)
  await page.waitForFunction(() => Boolean(window.__responsiverRemoteShortcut))
  assert.equal(await page.evaluate(() => window.__responsiverRemoteShortcut), linked.id)
  await page.evaluate(() => window.__responsiverRemoteShortcutOff?.())
  await assert.rejects(
    page.evaluate((projectId) => window.responsiver.previewRemoteVisualStyle({ projectId, css: '@\\69mport "https://example.test/x.css"' }), linked.id),
    /invalide/
  )

  await page.evaluate((projectId) => window.responsiver.setRemoteBounds({
    projectId,
    x: 0,
    y: 0,
    width: 393,
    height: 600,
    scale: 1,
    visible: true,
    viewport: { width: 393, height: 852, deviceScaleFactor: 1, mobile: true, touch: true }
  }), linked.id)
  const originalColor = await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin)
  const visualPreview = await page.evaluate(
    ({ projectId, visualEdit }) => window.responsiver.previewRemoteVisualStyle({ projectId, visualEdits: [visualEdit], route: '/' }),
    { projectId: linked.id, visualEdit: mainColorEdit }
  )
  assert.equal(visualPreview.applied, true)
  assert.ok(visualPreview.bytes > 0)
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), 'rgb(185, 77, 50)')
  await page.evaluate(() => {
    window.__responsiverRemoteSelection = null
    window.__responsiverRemoteSelectionOff = window.responsiver.onRemoteInspectorSelection((selection) => {
      window.__responsiverRemoteSelection = selection
    })
  })
  assert.deepEqual(
    await page.evaluate((projectId) => window.responsiver.startRemoteInspector({ projectId }), linked.id),
    { active: true, editable: true, path: '/' }
  )
  await page.evaluate((url) => window.responsiver.navigateRemote('url', url), `${origin}/deux`)
  await page.evaluate(() => { window.__responsiverRemoteSelection = null })
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), 'rgb(185, 77, 50)', 'la CSS visuelle doit être restaurée après navigation')
  await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    await remote?.executeJavaScript('history.pushState({}, "", "/deux#section")')
  }, origin)
  await page.waitForFunction(async () => (await window.responsiver.getRemoteState()).path === '/deux#section')
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), 'rgb(185, 77, 50)', 'une navigation SPA ne doit couper ni la CSS ni l’inspecteur')
  await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    if (!remote) throw new Error('WebContents localhost introuvable pour le test de l’inspecteur.')
    const rectangle = await remote.executeJavaScript(`(() => {
      const rect = document.querySelector('main').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
    await remote.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rectangle.x, y: rectangle.y })
    await remote.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: rectangle.x, y: rectangle.y, button: 'left', clickCount: 1 })
    await remote.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rectangle.x, y: rectangle.y, button: 'left', clickCount: 1 })
  }, origin)
  await page.waitForFunction(() => Boolean(window.__responsiverRemoteSelection))
  const inspected = await page.evaluate(() => window.__responsiverRemoteSelection)
  assert.equal(inspected.projectId, linked.id)
  assert.equal(inspected.tag, 'main')
  assert.equal(inspected.route, '/deux#section')
  assert.equal(inspected.text, 'Session conservée')
  assert.equal(inspected.editable, true)
  assert.ok(inspected.rect.width > 0 && inspected.rect.height > 0)
  await page.evaluate((projectId) => window.responsiver.stopRemoteInspector({ projectId }), linked.id)
  await page.evaluate((projectId) => window.responsiver.clearRemoteVisualStyle({ projectId }), linked.id)
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), originalColor)
  const latestColorEdit = { ...mainColorEdit, id: 'visual-a11ce002', after: 'rgb(32, 104, 168)' }
  await page.evaluate(async ({ projectId, first, latest }) => {
    await Promise.all([
      window.responsiver.previewRemoteVisualStyle({ projectId, visualEdits: [first], route: '/' }),
      window.responsiver.previewRemoteVisualStyle({ projectId, visualEdits: [latest], route: '/' })
    ])
  }, { projectId: linked.id, first: mainColorEdit, latest: latestColorEdit })
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), 'rgb(32, 104, 168)', 'la dernière preview CSS concurrente doit gagner sans laisser de clé orpheline')
  const loadingColorEdit = { ...mainColorEdit, id: 'visual-a11ce003', after: 'rgb(39, 122, 86)' }
  const slowVisualNavigation = page.evaluate((url) => window.responsiver.navigateRemote('url', url), `${origin}/lent`)
  await page.waitForFunction(async () => (await window.responsiver.getRemoteState()).loading)
  const previewDuringNavigation = page.evaluate(
    ({ projectId, visualEdit }) => window.responsiver.previewRemoteVisualStyle({ projectId, visualEdits: [visualEdit], route: '/lent' }),
    { projectId: linked.id, visualEdit: loadingColorEdit }
  )
  await Promise.all([slowVisualNavigation, previewDuringNavigation])
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), 'rgb(39, 122, 86)', 'une preview CSS demandée pendant un chargement doit être réinjectée dans le nouveau document')
  await page.evaluate((projectId) => window.responsiver.clearRemoteVisualStyle({ projectId }), linked.id)
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.querySelector("main")).color')
  }, origin), originalColor, 'le nettoyage doit retirer toutes les previews CSS concurrentes')
  await page.evaluate(() => window.__responsiverRemoteSelectionOff?.())

  const files = await page.evaluate((projectId) => window.responsiver.listWorkspaceFiles(projectId), linked.id)
  assert.deepEqual(files.map((file) => file.path), ['composer.json', 'package.json', 'styles.css'])
  const source = await page.evaluate(
    ({ projectId }) => window.responsiver.readWorkspaceFile(projectId, 'styles.css'),
    { projectId: linked.id }
  )
  let overlay = await page.evaluate(
    ({ projectId, version }) => window.responsiver.replaceWorkspaceFile(projectId, 'styles.css', 'body { color: #b94d32; }\n', version),
    { projectId: linked.id, version: source.version }
  )
  assert.equal(overlay.dirty, true)
  assert.equal(await readFile(join(firstRoot, 'styles.css'), 'utf8'), 'body { color: #111; }\n', 'prévisualiser ne doit jamais écrire dans les sources')
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.body).color')
  }, origin), 'rgb(185, 77, 50)')
  const slowWorkspaceNavigation = page.evaluate((url) => window.responsiver.navigateRemote('url', url), `${origin}/workspace-lent`)
  await page.waitForFunction(async () => (await window.responsiver.getRemoteState()).loading)
  const workspaceDuringNavigation = page.evaluate(
    ({ projectId, version }) => window.responsiver.replaceWorkspaceFile(projectId, 'styles.css', 'body { color: #2068a8; }\n', version),
    { projectId: linked.id, version: overlay.version }
  )
  const [, updatedOverlay] = await Promise.all([slowWorkspaceNavigation, workspaceDuringNavigation])
  overlay = updatedOverlay
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.body).color')
  }, origin), 'rgb(32, 104, 168)', 'une preview Code modifiée pendant un chargement doit être restaurée dans le nouveau document')
  await page.evaluate(() => window.responsiver.navigateRemote('reload'))
  assert.equal(await application.evaluate(async ({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.executeJavaScript('getComputedStyle(document.body).color')
  }, origin), 'rgb(32, 104, 168)', 'la preview CSS de Code doit être restaurée après rechargement')
  assert.equal(await readFile(join(firstRoot, 'styles.css'), 'utf8'), 'body { color: #111; }\n', 'recharger la preview ne doit jamais écrire dans les sources')

  await assert.rejects(
    page.evaluate(
      ({ projectId, root }) => window.responsiver.associateRemoteRoot({ projectId, root }),
      { projectId: linked.id, root: secondRoot }
    ),
    /changements temporaires/
  )
  await page.evaluate(
    ({ projectId, version }) => window.responsiver.discardWorkspaceFile(projectId, 'styles.css', version),
    { projectId: linked.id, version: overlay.version }
  )

  const replaced = await page.evaluate(
    ({ projectId, root }) => window.responsiver.associateRemoteRoot({ projectId, root }),
    { projectId: linked.id, root: secondRoot }
  )
  assert.equal(replaced.source.localRoot, canonicalSecondRoot)
  assert.deepEqual(
    (await page.evaluate((projectId) => window.responsiver.listWorkspaceFiles(projectId), replaced.id)).map((file) => file.path),
    ['theme.css']
  )

  const remoteIdAfter = await application.evaluate(({ webContents }, expectedOrigin) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(expectedOrigin))
    return remote?.id ?? null
  }, origin)
  assert.equal(remoteIdAfter, remoteIdBefore, 'la WebContentsView distante doit être conservée')

  const theme = await page.evaluate((projectId) => window.responsiver.readWorkspaceFile(projectId, 'theme.css'), replaced.id)
  const staged = await page.evaluate(
    ({ projectId, version }) => window.responsiver.replaceWorkspaceFile(projectId, 'theme.css', 'body { background: #f5f1e8; }\n', version),
    { projectId: replaced.id, version: theme.version }
  )
  assert.equal(await readFile(join(secondRoot, 'theme.css'), 'utf8'), 'body { background: #fff; }\n')
  await page.evaluate(
    ({ projectId, version }) => window.responsiver.applyWorkspaceFile(projectId, 'theme.css', version),
    { projectId: replaced.id, version: staged.version }
  )
  assert.equal(await readFile(join(secondRoot, 'theme.css'), 'utf8'), 'body { background: #f5f1e8; }\n', 'seule l’action Appliquer écrit le fichier')

  process.stdout.write('E2E localhost : association et remplacement à chaud sans écriture implicite — OK\n')
} finally {
  await application.close().catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
  await rm(fixtureRoot, { recursive: true, force: true })
}
