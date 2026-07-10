import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { consumeExtensionInbox, resolveExtensionInbox, type ExtensionOpenUrlRequest } from '../src/main/extension-inbox.ts'

function envelope(now: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const requestId = randomUUID()
  return {
    schemaVersion: 1,
    spoolId: randomUUID(),
    receivedAt: new Date(now).toISOString(),
    request: {
      version: 1,
      type: 'open-url',
      requestId,
      sentAt: new Date(now).toISOString(),
      source: 'chrome-extension',
      payload: { url: 'https://example.com/atelier', title: 'Atelier', viewport: { width: 1440, height: 900 }, devicePixelRatio: 2 },
      ...overrides
    }
  }
}

async function fixture(context: TestContext): Promise<{ root: string; inbox: string }> {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-extension-inbox-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const inbox = join(root, 'extension-inbox')
  await mkdir(inbox)
  return { root, inbox }
}

test('le chemin configuré doit rester absolu', () => {
  assert.throws(() => resolveExtensionInbox('/tmp/user-data', 'relative/inbox'), /invalide/)
  assert.equal(resolveExtensionInbox('/tmp/user-data', '/tmp/custom-inbox'), '/tmp/custom-inbox')
})

test('une demande Chrome valide est réclamée puis supprimée', async (context) => {
  const { inbox } = await fixture(context)
  const now = Date.parse('2026-07-10T12:00:00.000Z')
  const id = randomUUID()
  await writeFile(join(inbox, `open-url-${now}-${id}.json`), JSON.stringify(envelope(now)), { mode: 0o600 })
  const received: ExtensionOpenUrlRequest[] = []
  const count = await consumeExtensionInbox(inbox, async (request) => { received.push(request) }, { now: () => now })
  assert.equal(count, 1)
  assert.equal(received[0]?.url, 'https://example.com/atelier')
  assert.deepEqual(await readdir(inbox), [])
})

test('les liens symboliques, schémas inconnus et demandes expirées sont supprimés sans effet', async (context) => {
  const { root, inbox } = await fixture(context)
  const now = Date.parse('2026-07-10T12:00:00.000Z')
  const expired = now - 11 * 60 * 1_000
  await writeFile(join(inbox, `open-url-${expired}-${randomUUID()}.json`), JSON.stringify(envelope(expired)))
  await writeFile(join(inbox, `open-url-${now}-${randomUUID()}.json`), JSON.stringify({ schemaVersion: 99 }))
  const outside = join(root, 'outside.json')
  await writeFile(outside, JSON.stringify(envelope(now)))
  await symlink(outside, join(inbox, `open-url-${now + 1}-${randomUUID()}.json`))
  let called = 0
  const count = await consumeExtensionInbox(inbox, async () => { called += 1 }, { now: () => now })
  assert.equal(count, 0)
  assert.equal(called, 0)
  assert.deepEqual(await readdir(inbox), [])
})
