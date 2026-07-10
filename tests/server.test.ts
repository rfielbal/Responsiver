import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startProjectServer } from '../src/main/project-server.ts'

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
  assert.match(await page.text(), /data-responsiver-bridge/)
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
