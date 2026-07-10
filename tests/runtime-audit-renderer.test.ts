import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeRuntimeAudit } from '../src/renderer/src/App.tsx'

const device = { id: 'test', family: 'smartphone' as const, name: 'Test mobile', width: 390, height: 844 }

test('refuse un faux message legacy ou incomplet sans lever d’erreur', () => {
  assert.equal(sanitizeRuntimeAudit({ overflowCount: 1 }, device), null)
  assert.equal(sanitizeRuntimeAudit({ version: 2, findings: 'invalide' }, device), null)
  assert.equal(sanitizeRuntimeAudit(null, device), null)
})

test('borne et assainit les constats runtime provenant du projet local', () => {
  const maliciousFinding = {
    id: `id-${'x'.repeat(500)}`,
    rule: 'layout.viewport-overflow',
    severity: 'error',
    title: `Titre\u0000 ${'t'.repeat(500)}`,
    description: 'Description',
    proposal: 'Proposition',
    confidence: 8,
    selector: `#cible\u0000${'s'.repeat(500)}`,
    tag: 'div',
    label: 'Cible',
    rect: { x: -1_000_000, y: 2, width: 1_000_000, height: 42 },
    route: 'https://site-malveillant.example/',
    viewport: { width: 99_999, height: 99_999, mobile: false }
  }
  const result = sanitizeRuntimeAudit({
    version: 2,
    route: '/page?test=1#zone',
    documentWidth: 1_000_000,
    inspectedNodes: 99_999,
    findings: Array.from({ length: 150 }, () => maliciousFinding)
  }, device)

  assert.ok(result)
  assert.equal(result.findings.length, 120)
  assert.deepEqual(result.viewport, { width: 390, height: 844, mobile: true })
  assert.equal(result.route, '/page?test=1#zone')
  assert.equal(result.truncated, true)
  assert.equal(result.inspectedNodes, 2_500)
  assert.equal(result.documentWidth, 100_000)
  assert.equal(result.findings[0]?.confidence, 1)
  assert.equal(result.findings[0]?.selector.length, 320)
  assert.doesNotMatch(result.findings[0]?.title ?? '', /\u0000/)
  assert.deepEqual(result.findings[0]?.rect, { x: -100_000, y: 2, width: 100_000, height: 42 })
})

test('ignore les règles inconnues et neutralise une route absolue', () => {
  const result = sanitizeRuntimeAudit({
    version: 2,
    route: 'https://example.com/vol',
    findings: [{
      rule: 'runtime.execute-shell',
      selector: 'body'
    }]
  }, device)

  assert.ok(result)
  assert.equal(result.route, '/')
  assert.deepEqual(result.findings, [])
})
