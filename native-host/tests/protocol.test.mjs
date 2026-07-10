import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_MESSAGE_BYTES,
  NativeMessageDecoder,
  ProtocolError,
  encodeNativeMessage,
  validateOpenUrlRequest
} from '../protocol.mjs'

function validRequest(overrides = {}) {
  return {
    version: 1,
    type: 'open-url',
    requestId: 'c2dc2f54-d63d-4f44-9cc5-dd724b4c6361',
    sentAt: '2026-07-10T09:00:00.000Z',
    source: 'chrome-extension',
    payload: {
      url: 'https://example.com/portfolio?mode=preview#work',
      title: 'Portfolio',
      viewport: { width: 1440, height: 900 },
      devicePixelRatio: 2
    },
    ...overrides
  }
}

test('décode un message Native Messaging reçu en fragments', () => {
  const request = validRequest()
  const framed = encodeNativeMessage(request)
  const decoder = new NativeMessageDecoder()

  assert.deepEqual(decoder.push(framed.subarray(0, 2)), [])
  assert.deepEqual(decoder.push(framed.subarray(2, 11)), [])
  assert.deepEqual(decoder.push(framed.subarray(11)), [request])
  assert.doesNotThrow(() => decoder.finish())
})

test('décode plusieurs messages successifs', () => {
  const first = validRequest()
  const second = validRequest({ requestId: '0d5b168b-afbf-4748-b883-aa48007a52d7' })
  const decoder = new NativeMessageDecoder()

  assert.deepEqual(decoder.push(Buffer.concat([encodeNativeMessage(first), encodeNativeMessage(second)])), [
    first,
    second
  ])
})

test('refuse un frame surdimensionné avant allocation du corps', () => {
  const header = Buffer.alloc(4)
  header.writeUInt32LE(MAX_MESSAGE_BYTES + 1)
  const decoder = new NativeMessageDecoder()

  assert.throws(() => decoder.push(header), (error) => {
    assert.ok(error instanceof ProtocolError)
    assert.equal(error.code, 'MESSAGE_TOO_LARGE')
    return true
  })
})

test('refuse un message tronqué', () => {
  const framed = encodeNativeMessage(validRequest())
  const decoder = new NativeMessageDecoder()
  decoder.push(framed.subarray(0, framed.length - 1))

  assert.throws(() => decoder.finish(), { code: 'TRUNCATED_MESSAGE' })
})

test('valide et normalise une demande open-url', () => {
  const result = validateOpenUrlRequest(validRequest())
  assert.equal(result.payload.url, 'https://example.com/portfolio?mode=preview#work')
  assert.deepEqual(result.payload.viewport, { width: 1440, height: 900 })
  assert.equal(result.payload.devicePixelRatio, 2)
})

test('refuse les propriétés inconnues', () => {
  assert.throws(
    () => validateOpenUrlRequest(validRequest({ unexpected: true })),
    { code: 'INVALID_SCHEMA' }
  )
})

test('refuse les protocoles non web, HTTP public et les identifiants intégrés', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com']) {
    const request = validRequest({
      payload: { ...validRequest().payload, url }
    })
    assert.throws(() => validateOpenUrlRequest(request), (error) => {
      assert.ok(error.code === 'INVALID_URL' || error.code === 'FORBIDDEN_URL')
      return true
    })
  }
})

test('conserve HTTP uniquement pour les hôtes de boucle locale', () => {
  for (const url of ['http://localhost:5173', 'http://app.localhost:3000', 'http://127.0.0.42:8080', 'http://[::1]:9000']) {
    const result = validateOpenUrlRequest(validRequest({ payload: { ...validRequest().payload, url } }))
    assert.equal(new URL(result.payload.url).protocol, 'http:')
  }
})

test('refuse des dimensions et une densité hors limites', () => {
  const badViewport = validRequest({
    payload: { ...validRequest().payload, viewport: { width: 0, height: 900 } }
  })
  const badDpr = validRequest({
    payload: { ...validRequest().payload, devicePixelRatio: 20 }
  })

  assert.throws(() => validateOpenUrlRequest(badViewport), { code: 'INVALID_VIEWPORT' })
  assert.throws(() => validateOpenUrlRequest(badDpr), { code: 'INVALID_DPR' })
})
