import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCompanionUrl } from '../../extensions/chrome/url-policy.mjs'
import { normalizeNativeHostUrl } from '../url-policy.mjs'

const accepted = [
  'https://example.com/page?mode=test#section',
  'https://localhost:8443',
  'http://localhost:5173',
  'http://app.localhost:3000',
  'http://127.0.0.1:8080',
  'http://127.12.34.56:8080',
  'http://[::1]:9000'
]

const refused = [
  'http://example.com',
  'http://localhost.example.com',
  'http://192.168.1.10',
  'http://10.0.0.1',
  'file:///etc/passwd',
  'https://user:secret@example.com'
]

test('extension et host partagent la même politique HTTPS public / HTTP loopback', () => {
  for (const url of accepted) {
    assert.equal(normalizeCompanionUrl(url), new URL(url).href)
    assert.equal(normalizeNativeHostUrl(url), new URL(url).href)
  }
  for (const url of refused) {
    assert.equal(normalizeCompanionUrl(url), null)
    assert.equal(normalizeNativeHostUrl(url), null)
  }
})
