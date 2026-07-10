import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const registerPath = fileURLToPath(new URL('../register.mjs', import.meta.url))

test('affiche un manifeste Native Messaging sans effectuer d’installation', () => {
  const result = spawnSync(process.execPath, [
    registerPath,
    '--platform', 'macos',
    '--extension-id', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--host-path', '/Applications/Responsiver.app/Contents/Resources/companion/native-host/host.mjs',
    '--format', 'manifest'
  ], { encoding: 'utf8', shell: false })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout), {
    name: 'fr.responsiver.desktop',
    description: 'Pont local minimal entre Chrome et Responsiver',
    path: '/Applications/Responsiver.app/Contents/Resources/companion/native-host/host.mjs',
    type: 'stdio',
    allowed_origins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']
  })
})

test('refuse un identifiant Chrome non conforme', () => {
  const result = spawnSync(process.execPath, [
    registerPath,
    '--platform', 'macos',
    '--extension-id', 'invalid',
    '--host-path', '/tmp/host.mjs'
  ], { encoding: 'utf8', shell: false })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /32 caractères/)
})
