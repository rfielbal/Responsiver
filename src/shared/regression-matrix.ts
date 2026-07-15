import type {
  MatrixJob,
  MatrixObservation,
  MatrixSnapshot,
  MatrixStateId,
  RegressionFinding,
  RegressionReport,
  RuntimeAuditFinding
} from './contracts'

export const MATRIX_STATE_LABELS: Readonly<Record<MatrixStateId, string>> = Object.freeze({
  initial: 'Initial',
  'navigation-open': 'Navigation ouverte',
  'keyboard-focus': 'Focus clavier'
})

export function matrixJobId(route: string, deviceId: string, state: MatrixStateId): string {
  return `${encodeURIComponent(route)}::${deviceId}::${state}`
}

export function createMatrixJobs(
  routes: readonly string[],
  devices: ReadonlyArray<{ id: string; name: string; width: number; height: number }>,
  states: readonly MatrixStateId[]
): MatrixJob[] {
  const uniqueRoutes = [...new Set(routes.map((route) => route.trim()).filter(Boolean))]
  const uniqueStates = [...new Set(states)]
  const jobs: MatrixJob[] = []
  for (const route of uniqueRoutes) {
    for (const device of devices) {
      for (const state of uniqueStates) {
        jobs.push({
          id: matrixJobId(route, device.id, state),
          route,
          deviceId: device.id,
          deviceName: device.name,
          width: device.width,
          height: device.height,
          state
        })
      }
    }
  }
  return jobs
}

export function matrixCellStatus(audit: MatrixObservation['audit']): MatrixObservation['status'] {
  if (!audit) return 'timeout'
  if (audit.findings.some((finding) => finding.severity === 'error')) return 'error'
  return audit.findings.length ? 'warning' : 'passed'
}

function normalizedSelector(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1')
}

function normalizedFindingImpact(finding: RuntimeAuditFinding): number | null {
  const viewportWidth = Math.max(1, finding.viewport.width)
  const viewportHeight = Math.max(1, finding.viewport.height)
  const rectangle = finding.rect
  if (finding.rule === 'layout.viewport-overflow' || finding.rule === 'layout.clipped-content' || finding.rule === 'layout.useful-area-overflow') {
    const horizontal = Math.max(0, -rectangle.x, rectangle.x + rectangle.width - viewportWidth) / viewportWidth
    const vertical = Math.max(0, -rectangle.y, rectangle.y + rectangle.height - viewportHeight) / viewportHeight
    return Math.round(Math.max(horizontal, vertical) * 10_000) / 10_000
  }
  if (finding.rule === 'interaction.small-target') {
    return Math.round(Math.max(0, 44 - Math.min(rectangle.width, rectangle.height)) / 44 * 10_000) / 10_000
  }
  if (finding.rule === 'layout.fixed-obstruction') {
    return Math.round(Math.max(0, rectangle.width * rectangle.height) / (viewportWidth * viewportHeight) * 10_000) / 10_000
  }
  return null
}

/** La clé ignore l'id volatile du collecteur mais conserve le contexte qui rend le défaut reproductible. */
export function regressionFindingKey(job: MatrixJob, finding: RuntimeAuditFinding): string {
  return [job.route, job.deviceId, job.state, finding.rule, normalizedSelector(finding.selector)].join('::')
}

function reportFinding(job: MatrixJob, finding: RuntimeAuditFinding): RegressionFinding {
  return {
    key: regressionFindingKey(job, finding),
    route: job.route,
    deviceName: job.deviceName,
    state: job.state,
    rule: finding.rule,
    selector: finding.selector,
    title: finding.title,
    severity: finding.severity,
    impact: normalizedFindingImpact(finding)
  }
}

function findingsByKey(snapshot: MatrixSnapshot, comparableIds: ReadonlySet<string>): Map<string, RegressionFinding> {
  const findings = new Map<string, RegressionFinding>()
  for (const observation of snapshot.observations) {
    if (!comparableIds.has(observation.job.id) || !observation.audit) continue
    for (const finding of observation.audit.findings) {
      const normalized = reportFinding(observation.job, finding)
      findings.set(normalized.key, normalized)
    }
  }
  return findings
}

function severityOrder(finding: RegressionFinding): number {
  return finding.severity === 'error' ? 0 : 1
}

function sorted(values: Iterable<RegressionFinding>): RegressionFinding[] {
  return [...values].sort((left, right) => severityOrder(left) - severityOrder(right) || left.route.localeCompare(right.route) || left.deviceName.localeCompare(right.deviceName) || left.title.localeCompare(right.title))
}

export function compareMatrixSnapshots(baseline: MatrixSnapshot, candidate: MatrixSnapshot): RegressionReport {
  const baselineByJob = new Map(baseline.observations.map((observation) => [observation.job.id, observation]))
  const candidateByJob = new Map(candidate.observations.map((observation) => [observation.job.id, observation]))
  const comparableIds = new Set<string>()
  let unsupportedCells = 0
  let failedCells = 0

  for (const [id, source] of baselineByJob) {
    const next = candidateByJob.get(id)
    if (!next) {
      failedCells += 1
      continue
    }
    if (source.status === 'unsupported' && next.status === 'unsupported') {
      unsupportedCells += 1
      continue
    }
    if (source.status === 'unsupported' || next.status === 'unsupported' || !source.audit || !next.audit || source.audit.truncated || next.audit.truncated || source.status === 'timeout' || next.status === 'timeout' || source.status === 'render-failed' || next.status === 'render-failed') {
      failedCells += 1
      continue
    }
    comparableIds.add(id)
  }

  const before = findingsByKey(baseline, comparableIds)
  const after = findingsByKey(candidate, comparableIds)
  const impactWorsened = (source: RegressionFinding | undefined, next: RegressionFinding): boolean => {
    if (source?.impact === null || source?.impact === undefined || next.impact === null) return false
    return next.impact - source.impact >= .08 && next.impact > Math.max(.1, source.impact * 1.35)
  }
  const fixed = sorted([...before.entries()]
    .filter(([key, finding]) => !after.has(key) || finding.severity === 'error' && after.get(key)?.severity === 'warning')
    .map(([, finding]) => finding))
  const regressions = sorted([...after.entries()]
    .filter(([key, finding]) => !before.has(key) || finding.severity === 'error' && before.get(key)?.severity === 'warning' || impactWorsened(before.get(key), finding))
    .map(([, finding]) => finding))
  const remaining = sorted([...after.entries()]
    .filter(([key, finding]) => before.get(key)?.severity === finding.severity && !impactWorsened(before.get(key), finding))
    .map(([, finding]) => finding))
  const reasons: string[] = []

  if (!comparableIds.size) reasons.push('Aucune cellule source/candidat n’a produit deux rendus comparables.')
  if (failedCells) reasons.push(`${failedCells} cellule${failedCells > 1 ? 's n’ont' : ' n’a'} pas terminé la vérification.`)
  if (regressions.length) reasons.push(`${regressions.length} nouveau${regressions.length > 1 ? 'x défauts visuels ont' : ' défaut visuel a'} été détecté${regressions.length > 1 ? 's' : ''}.`)
  const newErrors = regressions.filter((finding) => finding.severity === 'error').length
  if (newErrors) reasons.push(`${newErrors} régression${newErrors > 1 ? 's bloquantes' : ' bloquante'} empêche${newErrors > 1 ? 'nt' : ''} l’application express.`)

  const status: RegressionReport['status'] = !comparableIds.size || failedCells
    ? 'inconclusive'
    : regressions.length
      ? 'blocked'
      : 'passed'

  return {
    status,
    generatedAt: new Date().toISOString(),
    comparableCells: comparableIds.size,
    unsupportedCells,
    baselineFindings: before.size,
    candidateFindings: after.size,
    fixed,
    regressions,
    remaining,
    reasons
  }
}
