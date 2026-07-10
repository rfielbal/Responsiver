import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { NativeMessageDecoder, encodeNativeMessage } from '../protocol.mjs'

const hostPath = fileURLToPath(new URL('../host.mjs', import.meta.url))

test('traite un échange complet stdin/stdout et dépose la demande', async () => {
  const inboxPath = await mkdtemp(path.join(tmpdir(), 'responsiver-native-host-'))
  const request = {
    version: 1,
    type: 'open-url',
    requestId: '7c870ade-5c88-4181-9a69-44108495d859',
    sentAt: new Date().toISOString(),
    source: 'chrome-extension',
    payload: {
      url: 'https://example.com/test',
      title: 'Test',
      viewport: { width: 390, height: 844 },
      devicePixelRatio: 3
    }
  }

  const child = spawn(process.execPath, [hostPath], {
    env: { ...process.env, RESPONSIVER_EXTENSION_INBOX: inboxPath },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })
  const stdout = []
  const stderr = []
  child.stdout.on('data', (chunk) => stdout.push(chunk))
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  child.stdin.end(encodeNativeMessage(request))

  const [exitCode] = await once(child, 'close')
  assert.equal(exitCode, 0, Buffer.concat(stderr).toString('utf8'))

  const decoder = new NativeMessageDecoder()
  const responses = decoder.push(Buffer.concat(stdout))
  decoder.finish()
  assert.equal(responses.length, 1)
  assert.deepEqual(
    {
      version: responses[0].version,
      requestId: responses[0].requestId,
      ok: responses[0].ok,
      delivery: responses[0].delivery
    },
    { version: 1, requestId: request.requestId, ok: true, delivery: 'queued' }
  )
  assert.match(responses[0].spoolId, /^[0-9a-f-]{36}$/)

  const stored = await readdir(inboxPath)
  assert.equal(stored.length, 1)
  assert.match(stored[0], /^open-url-/)
})
