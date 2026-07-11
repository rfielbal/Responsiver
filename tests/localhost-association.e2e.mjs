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

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end('<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>Localhost associé à chaud</title></head><body><main>Session conservée</main></body></html>')
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Le serveur localhost factice n’a pas démarré.')
const origin = `http://127.0.0.1:${address.port}`

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

  const files = await page.evaluate((projectId) => window.responsiver.listWorkspaceFiles(projectId), linked.id)
  assert.deepEqual(files.map((file) => file.path), ['composer.json', 'package.json', 'styles.css'])
  const source = await page.evaluate(
    ({ projectId }) => window.responsiver.readWorkspaceFile(projectId, 'styles.css'),
    { projectId: linked.id }
  )
  const overlay = await page.evaluate(
    ({ projectId, version }) => window.responsiver.replaceWorkspaceFile(projectId, 'styles.css', 'body { color: #b94d32; }\n', version),
    { projectId: linked.id, version: source.version }
  )
  assert.equal(overlay.dirty, true)
  assert.equal(await readFile(join(firstRoot, 'styles.css'), 'utf8'), 'body { color: #111; }\n', 'prévisualiser ne doit jamais écrire dans les sources')

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
