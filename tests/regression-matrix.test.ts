import assert from 'node:assert/strict'
import test from 'node:test'
import type { MatrixJob, MatrixObservation, MatrixSnapshot, RuntimeAudit, RuntimeAuditFinding } from '../src/shared/contracts'
import { compareMatrixSnapshots, createMatrixJobs } from '../src/shared/regression-matrix'

const job: MatrixJob = { id: '%2F::mobile::initial', route: '/', deviceId: 'mobile', deviceName: 'Mobile', width: 393, height: 852, state: 'initial' }

function finding(rule: RuntimeAuditFinding['rule'], selector: string, severity: RuntimeAuditFinding['severity'] = 'warning'): RuntimeAuditFinding {
  return { id: `${rule}:${selector}`, rule, severity, title: rule, description: 'Mesure', proposal: 'Corriger', confidence: .95, selector, tag: 'div', label: 'Zone', rect: { x: 0, y: 0, width: 400, height: 40 }, route: '/', viewport: { width: 393, height: 852, mobile: true } }
}

function audit(findings: RuntimeAuditFinding[], truncated = false): RuntimeAudit {
  return { version: 2, path: '/', route: '/', viewportWidth: 393, viewportHeight: 852, viewport: { width: 393, height: 852, mobile: true }, documentWidth: 393, overflowCount: 0, overflows: [], findingCount: findings.length, findings, inspectedNodes: 12, truncated, limits: { maxNodes: 2500, maxFindings: 120, maxFindingsPerRule: 120, maxLegacyOverflows: 8, maxContrastChecks: 2500 } }
}

function observation(findings: RuntimeAuditFinding[], overrides: Partial<MatrixObservation> = {}): MatrixObservation {
  return { job, status: findings.length ? 'warning' : 'passed', audit: audit(findings), scenario: { requestId: job.id, state: 'initial', supported: true, label: 'Initial', target: null, detail: null }, durationMs: 80, detail: null, ...overrides }
}

function snapshot(role: MatrixSnapshot['role'], observations: MatrixObservation[]): MatrixSnapshot {
  return { id: role, projectId: 'project', role, createdAt: '2026-07-14T00:00:00.000Z', observations }
}

test('construit le produit routes × tailles × états avec des identifiants stables', () => {
  const jobs = createMatrixJobs(['/a', '/b', '/a'], [
    { id: 'mobile', name: 'Mobile', width: 393, height: 852 },
    { id: 'desktop', name: 'Bureau', width: 1440, height: 900 }
  ], ['initial', 'navigation-open'])
  assert.equal(jobs.length, 8)
  assert.equal(new Set(jobs.map((entry) => entry.id)).size, 8)
})

test('valide un candidat qui supprime un signal sans en créer', () => {
  const before = finding('layout.viewport-overflow', '.hero', 'error')
  const report = compareMatrixSnapshots(snapshot('source', [observation([before])]), snapshot('candidate', [observation([])]))
  assert.equal(report.status, 'passed')
  assert.equal(report.fixed.length, 1)
  assert.equal(report.regressions.length, 0)
})

test('bloque un nouveau défaut même si un ancien a disparu', () => {
  const before = finding('layout.viewport-overflow', '.hero', 'error')
  const after = finding('layout.element-overlap', '.navigation', 'error')
  const report = compareMatrixSnapshots(snapshot('source', [observation([before])]), snapshot('candidate', [observation([after])]))
  assert.equal(report.status, 'blocked')
  assert.deepEqual(report.regressions.map((entry) => entry.selector), ['.navigation'])
})

test('bloque aussi l’aggravation d’un signal existant de warning vers error', () => {
  const source = snapshot('source', [observation([finding('layout.navigation-wrap', '.site-nav', 'warning')], { status: 'warning' })])
  const candidate = snapshot('candidate', [observation([finding('layout.navigation-wrap', '.site-nav', 'error')], { status: 'error' })])
  const report = compareMatrixSnapshots(source, candidate)
  assert.equal(report.status, 'blocked')
  assert.equal(report.regressions.length, 1)
  assert.equal(report.remaining.length, 0)
})

test('bloque un débordement existant qui devient nettement plus important', () => {
  const before = finding('layout.viewport-overflow', '.hero')
  before.rect = { x: 0, y: 0, width: 420, height: 40 }
  const after = finding('layout.viewport-overflow', '.hero')
  after.rect = { x: 0, y: 0, width: 620, height: 40 }
  const report = compareMatrixSnapshots(snapshot('source', [observation([before])]), snapshot('candidate', [observation([after])]))
  assert.equal(report.status, 'blocked')
  assert.equal(report.regressions.length, 1)
})

test('ne produit jamais un succès si une cellule expire ou si un audit est tronqué', () => {
  const timeout = observation([], { status: 'timeout', audit: null, detail: 'Délai' })
  const timedOut = compareMatrixSnapshots(snapshot('source', [observation([])]), snapshot('candidate', [timeout]))
  assert.equal(timedOut.status, 'inconclusive')

  const truncated = observation([], { status: 'error', audit: audit([], true), detail: 'Limite' })
  const limited = compareMatrixSnapshots(snapshot('source', [observation([])]), snapshot('candidate', [truncated]))
  assert.equal(limited.status, 'inconclusive')
})

test('ignore un état non applicable seulement lorsqu’il est absent des deux versions', () => {
  const stateJob = { ...job, id: '%2F::mobile::navigation-open', state: 'navigation-open' as const }
  const unsupported: MatrixObservation = { job: stateJob, status: 'unsupported', audit: null, scenario: { requestId: stateJob.id, state: stateJob.state, supported: false, label: 'Navigation ouverte', target: null, detail: 'Aucun menu' }, durationMs: 10, detail: 'Aucun menu' }
  const report = compareMatrixSnapshots(
    snapshot('source', [observation([]), unsupported]),
    snapshot('candidate', [observation([]), unsupported])
  )
  assert.equal(report.status, 'passed')
  assert.equal(report.unsupportedCells, 1)
})
