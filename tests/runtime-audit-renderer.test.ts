import assert from 'node:assert/strict'
import test from 'node:test'

import type { RuntimeAudit, RuntimeAuditFinding } from '../src/shared/contracts.ts'
import { consolidatedRuntimeIssues, sanitizePreviewSyncEvent, sanitizeRuntimeAudit } from '../src/renderer/src/App.tsx'

const device = { id: 'test', family: 'smartphone' as const, name: 'Test mobile', width: 390, height: 844 }

test('borne les messages de synchronisation avant de les relayer aux autres écrans', () => {
  assert.deepEqual(sanitizePreviewSyncEvent({
    channel: 'responsiver-preview',
    protocol: 1,
    type: 'sync-scroll',
    eventId: 'doc-a-1',
    documentId: 'doc-a',
    route: '/index.html',
    anchor: { selector: '#collection', occurrence: 0, offset: 42.25 },
    progress: { x: 0, y: .625 }
  }), {
    protocol: 1,
    type: 'sync-scroll',
    eventId: 'doc-a-1',
    documentId: 'doc-a',
    route: '/index.html',
    anchor: { selector: '#collection', occurrence: 0, offset: 42.25 },
    progress: { x: 0, y: .625 }
  })

  assert.equal(sanitizePreviewSyncEvent({ protocol: 2, type: 'sync-scroll' }), null)
  assert.equal(sanitizePreviewSyncEvent({ protocol: 1, type: 'sync-scroll', eventId: 'x', documentId: 'y', route: '/', progress: { x: 0, y: 2 } }), null)
  assert.equal(sanitizePreviewSyncEvent({ protocol: 1, type: 'sync-interaction', eventId: 'x', documentId: 'y', route: '/', target: { selector: '#secret\u0000', occurrence: 0 }, action: 'value', value: 'x' }), null)
  assert.equal(sanitizePreviewSyncEvent({ protocol: 1, type: 'sync-interaction', eventId: 'x', documentId: 'y', route: '/', target: { selector: '#search', occurrence: 0 }, action: 'value', value: 'x'.repeat(513) }), null)
  assert.deepEqual(sanitizePreviewSyncEvent({ protocol: 1, type: 'sync-interaction', eventId: 'x', documentId: 'y', route: '/', target: { selector: '#search', occurrence: 0 }, action: 'value', value: '' }), {
    protocol: 1,
    type: 'sync-interaction',
    eventId: 'x',
    documentId: 'y',
    route: '/',
    target: { selector: '#search', occurrence: 0 },
    action: 'value',
    value: ''
  })
})

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

test('consolide les vues et absorbe les petites cibles d’une navigation déjà signalée', () => {
  const finding = (width: number, rule: RuntimeAuditFinding['rule'], selector: string): RuntimeAuditFinding => ({
    id: `${rule}-${width}`,
    rule,
    severity: 'warning',
    title: rule === 'layout.navigation-wrap' ? 'Navigation déséquilibrée' : 'Cibles trop serrées',
    description: 'Défaut mesuré.',
    proposal: 'Corriger le groupe.',
    confidence: .88,
    selector,
    tag: rule === 'layout.navigation-wrap' ? 'nav' : 'a',
    label: 'Navigation',
    rect: { x: 0, y: 0, width, height: 80 },
    route: '/index.html',
    viewport: { width, height: width === 393 ? 852 : 1024, mobile: true }
  })
  const audit = (width: number): RuntimeAudit => ({
    version: 2,
    path: '/index.html',
    route: '/index.html',
    viewportWidth: width,
    viewportHeight: width === 393 ? 852 : 1024,
    viewport: { width, height: width === 393 ? 852 : 1024, mobile: true },
    documentWidth: width,
    overflowCount: 0,
    overflows: [],
    findingCount: 2,
    findings: [
      finding(width, 'layout.navigation-wrap', 'nav.menu'),
      finding(width, 'interaction.small-target', 'nav.menu > a')
    ],
    inspectedNodes: 120,
    truncated: false,
    limits: { maxNodes: 2_500, maxFindings: 120, maxFindingsPerRule: 24, maxLegacyOverflows: 12, maxContrastChecks: 600 }
  })

  const issues = consolidatedRuntimeIssues([audit(393), audit(768)])
  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.rule, 'layout.navigation-wrap')
  assert.equal(issues[0]?.viewport, '393 × 852 · 768 × 1024')
  assert.match(issues[0]?.description ?? '', /2 formats/)
  assert.equal(issues[0]?.evidence?.measurements?.affectedViewports, '393 × 852 · 768 × 1024')
})
