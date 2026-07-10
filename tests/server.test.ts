import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LOCAL_RUNTIME_AUDIT_LIMITS, startProjectServer } from '../src/main/project-server.ts'

function requestWithHost(origin: string, path: string, host: string, method = 'GET'): Promise<{ status: number; body: string }> {
  const url = new URL(path, origin)
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { Host: host } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.once('error', reject)
    request.end()
  })
}

test('le runner sert uniquement localhost, injecte le bridge et gère les médias partiels', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-server-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>Runner</title></head><body>Source</body></html>')
  await writeFile(join(root, 'media.bin'), Buffer.from('0123456789'))
  await writeFile(join(root, 'clip.mp4'), Buffer.from('0123456789'))
  const server = await startProjectServer(root)
  context.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const page = await fetch(`${server.origin}/index.html`)
  assert.equal(page.status, 200)
  const pageBody = await page.text()
  assert.match(pageBody, /data-responsiver-bridge/)
  assert.match(pageBody, /focus-selector/)
  assert.match(pageBody, /set-theme-preview/)
  assert.match(pageBody, /render-status/)
  assert.match(pageBody, /runtimeErrors\.length >= 12/)
  assert.match(pageBody, /element\.shadowRoot/)
  assert.match(pageBody, /document\.createTreeWalker/)
  assert.match(pageBody, /'::before', '::after'/)
  assert.match(pageBody, /const seenFindings = new Set\(\)/)
  assert.match(pageBody, /findingCount: findings\.length/)
  assert.match(pageBody, /proposal: clean\(proposal/)
  assert.match(pageBody, /confidence: Math\.max/)
  assert.match(pageBody, /route,\s+viewport/)
  assert.match(pageBody, /layout\.viewport-overflow/)
  assert.match(pageBody, /layout\.clipped-content/)
  assert.match(pageBody, /layout\.truncated-text/)
  assert.match(pageBody, /layout\.navigation-wrap/)
  assert.match(pageBody, /layout\.element-overlap/)
  assert.match(pageBody, /layout\.density-hierarchy/)
  assert.match(pageBody, /layout\.useful-area-overflow/)
  assert.match(pageBody, /typography\.disproportionate/)
  assert.match(pageBody, /interaction\.small-target/)
  assert.match(pageBody, /layout\.fixed-obstruction/)
  assert.match(pageBody, /media\.image-error/)
  assert.match(pageBody, /media\.image-distortion/)
  assert.match(pageBody, /accessibility\.low-contrast/)
  assert.match(pageBody, new RegExp('const AUDIT_MAX_NODES = ' + LOCAL_RUNTIME_AUDIT_LIMITS.maxNodes))
  assert.match(pageBody, new RegExp('const AUDIT_MAX_FINDINGS = ' + LOCAL_RUNTIME_AUDIT_LIMITS.maxFindings))
  assert.match(pageBody, new RegExp('const AUDIT_MAX_FINDINGS_PER_RULE = ' + LOCAL_RUNTIME_AUDIT_LIMITS.maxFindingsPerRule))
  assert.match(pageBody, new RegExp('const AUDIT_MAX_LEGACY_OVERFLOWS = ' + LOCAL_RUNTIME_AUDIT_LIMITS.maxLegacyOverflows))
  assert.match(pageBody, new RegExp('const AUDIT_MAX_CONTRAST_CHECKS = ' + LOCAL_RUNTIME_AUDIT_LIMITS.maxContrastChecks))
  const bridgeSource = pageBody.match(/<script data-responsiver-bridge>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(bridgeSource)
  assert.doesNotThrow(() => new Function(bridgeSource))
  assert.match(page.headers.get('content-security-policy') ?? '', /connect-src 'self'/)
  assert.equal(page.headers.get('cache-control'), 'no-store')

  const partial = await fetch(`${server.origin}/clip.mp4`, { headers: { Range: 'bytes=2-5' } })
  assert.equal(partial.status, 206)
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(await partial.text(), '2345')

  const host = new URL(server.origin).host
  assert.equal((await requestWithHost(server.origin, '/', 'malveillant.test')).status, 421)
  assert.equal((await requestWithHost(server.origin, '/', host, 'POST')).status, 405)
  assert.equal((await fetch(`${server.origin}/%2e%2e/package.json`)).status, 404)
  assert.equal((await fetch(`${server.origin}/media.bin`)).status, 403)
})

test('un serveur staged privilégie ses fichiers virtuels', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-overlay-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body>Source</body></html>')
  const overrides = new Map<string, Buffer>([
    ['index.html', Buffer.from('<!doctype html><html><body>Staging</body></html>')],
    ['.responsiver/responsiver.generated.css', Buffer.from('body { color: green; }')]
  ])
  const server = await startProjectServer(root, { mode: 'staged', overrides })
  context.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  assert.match(await (await fetch(`${server.origin}/`)).text(), /Staging/)
  assert.match(await (await fetch(`${server.origin}/.responsiver/responsiver.generated.css`)).text(), /green/)
})

test('une proposition possède son origine et ses overlays éphémères', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-proposal-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><nav>Source</nav></body></html>')
  const overrides = new Map<string, Buffer>([
    ['index.html', Buffer.from('<!doctype html><html><body><nav>Proposition</nav></body></html>')]
  ])
  const server = await startProjectServer(root, { mode: 'proposal', overrides })
  context.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const response = await fetch(`${server.origin}/`)
  assert.equal(response.headers.get('x-responsiver-mode'), 'proposal')
  assert.match(await response.text(), /Proposition/)
})

test('un artefact monté sert son entrée, ses assets absolus et ses overlays', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-mounted-'))
  await mkdir(join(root, 'dist', 'assets'), { recursive: true })
  await mkdir(join(root, 'dist', '.responsiver'), { recursive: true })
  await mkdir(join(root, '.responsiver'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body>Shell source</body></html>')
  await writeFile(join(root, 'package.json'), '{"private":true}')
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body>Artefact<script src="/assets/app.js"></script></body></html>')
  await writeFile(join(root, 'dist', 'assets', 'app.js'), 'document.body.dataset.build = "ready"')
  await writeFile(join(root, 'dist', '.responsiver', 'secret.css'), 'body { color: red; }')
  await symlink(join(root, 'package.json'), join(root, 'dist', 'leak.json'))
  await writeFile(join(root, '.responsiver', 'index.html'), '<!doctype html><html><body>Fichier projet masqué</body></html>')
  await assert.rejects(() => startProjectServer(root, { previewBasePath: '../dist' }), /Base de prévisualisation non autorisée/)
  const overrides = new Map<string, Buffer>([
    ['dist/index.html', Buffer.from('<!doctype html><html><body>Artefact corrigé<script src="/assets/app.js"></script></body></html>')],
    ['.responsiver/responsiver.generated.css', Buffer.from('body { color: green; }')],
    ['dist/.responsiver/artifact.generated.css', Buffer.from('body { color: purple; }')]
  ])
  const server = await startProjectServer(root, { mode: 'staged', overrides, previewBasePath: 'dist' })
  context.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const mountedRoot = await fetch(`${server.origin}/`)
  assert.equal(mountedRoot.headers.get('x-responsiver-base'), 'dist')
  assert.match(await mountedRoot.text(), /Artefact corrigé/)
  assert.match(await (await fetch(`${server.origin}/dist/index.html`)).text(), /Artefact corrigé/)
  assert.match(await (await fetch(`${server.origin}/assets/app.js`)).text(), /dataset\.build/)
  assert.match(await (await fetch(`${server.origin}/route/virtuelle`)).text(), /Artefact corrigé/)
  assert.match(await (await fetch(`${server.origin}/.responsiver/responsiver.generated.css`)).text(), /green/)
  assert.match(await (await fetch(`${server.origin}/.responsiver/artifact.generated.css`)).text(), /purple/)
  assert.equal((await fetch(`${server.origin}/package.json`)).status, 404)
  assert.equal((await fetch(`${server.origin}/dist/leak.json`)).status, 404)
  assert.equal((await fetch(`${server.origin}/.responsiver`)).status, 404)
  assert.equal((await fetch(`${server.origin}/.responsiver/index.html`)).status, 404)
  assert.equal((await fetch(`${server.origin}/.responsiver/secret.css`)).status, 404)
  assert.equal((await fetch(`${server.origin}/dist/.responsiver/secret.css`)).status, 404)
})

test('le mount .output/public ne rend pas les fichiers serveur voisins accessibles', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-output-'))
  await mkdir(join(root, '.output', 'public'), { recursive: true })
  await mkdir(join(root, '.output', 'server'), { recursive: true })
  await writeFile(join(root, '.output', 'public', 'index.html'), '<!doctype html><html><body>Public</body></html>')
  await writeFile(join(root, '.output', 'server', 'secret.js'), 'secret')
  const server = await startProjectServer(root, { previewBasePath: '.output/public' })
  context.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  assert.match(await (await fetch(`${server.origin}/`)).text(), /Public/)
  assert.equal((await fetch(`${server.origin}/.output/server/secret.js`)).status, 404)
})

test('un artefact imbriqué est monté à sa vraie racine web', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-nested-mount-'))
  await mkdir(join(root, 'dist', 'app', 'browser', 'assets'), { recursive: true })
  await writeFile(join(root, 'dist', 'app', 'browser', 'index.html'), '<!doctype html><html><body>App<script src="/assets/main.js"></script></body></html>')
  await writeFile(join(root, 'dist', 'app', 'browser', 'assets', 'main.js'), 'document.body.dataset.ready = "true"')
  await writeFile(join(root, 'dist', 'secret.txt'), 'hors du mount')
  const server = await startProjectServer(root, { previewBasePath: 'dist/app/browser' })
  context.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const page = await fetch(`${server.origin}/`)
  assert.equal(page.headers.get('x-responsiver-base'), 'dist/app/browser')
  assert.match(await page.text(), /App/)
  assert.match(await (await fetch(`${server.origin}/assets/main.js`)).text(), /dataset\.ready/)
  assert.equal((await fetch(`${server.origin}/dist/secret.txt`)).status, 404)
  await assert.rejects(() => startProjectServer(root, { previewBasePath: 'dist/../secret' }), /Base de prévisualisation non autorisée/)
})

test('un mount symbolique extérieur au projet est refusé au démarrage', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-symlink-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'responsiver-symlink-outside-'))
  await writeFile(join(outside, 'index.html'), '<!doctype html><html><body>Secret extérieur</body></html>')
  await symlink(outside, join(root, 'dist'))
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  await assert.rejects(() => startProjectServer(root, { previewBasePath: 'dist' }), /hors du projet/)
})
