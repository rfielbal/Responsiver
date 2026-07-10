import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { persistOpenUrlRequest, resolveInboxPath } from '../spool.mjs'
import { validateOpenUrlRequest } from '../protocol.mjs'

function request() {
  return validateOpenUrlRequest({
    version: 1,
    type: 'open-url',
    requestId: '16d78d65-d774-45a4-aec7-d7cb4133fcbb',
    sentAt: '2026-07-10T09:00:00.000Z',
    source: 'chrome-extension',
    payload: {
      url: 'http://localhost:5173/dashboard',
      title: 'Dashboard local',
      viewport: { width: 1280, height: 720 },
      devicePixelRatio: 1
    }
  })
}

test('résout les emplacements utilisateur sur chaque plateforme', () => {
  assert.equal(
    resolveInboxPath({ platform: 'darwin', env: {}, home: '/Users/raphael' }),
    '/Users/raphael/Library/Application Support/Responsiver/extension-inbox'
  )
  assert.equal(
    resolveInboxPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/home/r/.config' }, home: '/home/r' }),
    '/home/r/.config/Responsiver/extension-inbox'
  )
  assert.equal(
    resolveInboxPath({ platform: 'win32', env: { APPDATA: 'C:\\Users\\r\\AppData\\Roaming' }, home: '' }),
    'C:\\Users\\r\\AppData\\Roaming\\Responsiver\\extension-inbox'
  )
})

test('écrit atomiquement une demande sans exposer l’URL dans le nom', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'responsiver-native-spool-'))
  const inboxPath = path.join(root, 'inbox')
  const result = await persistOpenUrlRequest(request(), {
    inboxPath,
    now: () => Date.parse('2026-07-10T10:30:00.000Z')
  })

  const names = await readdir(inboxPath)
  assert.equal(names.length, 1)
  assert.match(names[0], /^open-url-1783679400000-[0-9a-f-]{36}\.json$/)
  assert.ok(!names[0].includes('localhost'))
  assert.ok(!names.some((name) => name.endsWith('.tmp')))

  const stored = JSON.parse(await readFile(path.join(inboxPath, names[0]), 'utf8'))
  assert.equal(stored.schemaVersion, 1)
  assert.equal(stored.spoolId, result.spoolId)
  assert.equal(stored.request.payload.url, 'http://localhost:5173/dashboard')

  if (process.platform !== 'win32') {
    const directoryMode = (await stat(inboxPath)).mode & 0o777
    const fileMode = (await stat(path.join(inboxPath, names[0]))).mode & 0o777
    assert.equal(directoryMode, 0o700)
    assert.equal(fileMode, 0o600)
  }
})

test('refuse un chemin de test relatif', () => {
  assert.throws(
    () => resolveInboxPath({ env: { RESPONSIVER_EXTENSION_INBOX: './relative' } }),
    { code: 'UNSAFE_INBOX' }
  )
})
