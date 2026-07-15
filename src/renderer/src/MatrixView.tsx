import { useMemo, type ReactElement } from 'react'
import type { MatrixJob, MatrixObservation, MatrixRunProgress, MatrixRunResult, MatrixStateId, ProjectSnapshot, RegressionFinding, RegressionReport } from '../../shared/contracts'
import { MATRIX_STATE_LABELS } from '../../shared/regression-matrix'

interface MatrixViewProps {
  project: ProjectSnapshot
  result: MatrixRunResult | null
  progress: MatrixRunProgress | null
  busy: boolean
  compareAvailable: boolean
  onRun: (compare: boolean) => void
  onOpenCell: (observation: MatrixObservation) => void
  onReview: () => void
}

const statusLabels: Readonly<Record<MatrixObservation['status'], string>> = {
  passed: 'OK',
  warning: 'À revoir',
  error: 'Échec',
  unsupported: 'N/A',
  timeout: 'Expiré',
  'render-failed': 'Rendu absent'
}

function observationKey(job: MatrixJob): string {
  return `${job.route}::${job.state}::${job.deviceId}`
}

function cellTitle(observation: MatrixObservation): string {
  if (observation.detail) return observation.detail
  if (!observation.audit) return statusLabels[observation.status]
  const count = observation.audit.findings.length
  return count ? `${count} signal${count > 1 ? 's' : ''} · ${Math.round(observation.durationMs / 100) / 10} s` : `Aucun défaut · ${Math.round(observation.durationMs / 100) / 10} s`
}

function findingBelongsToCell(finding: RegressionFinding, observation: MatrixObservation): boolean {
  return finding.route === observation.job.route && finding.deviceName === observation.job.deviceName && finding.state === observation.job.state
}

function comparisonCellPresentation(source: MatrixObservation | undefined, candidate: MatrixObservation, report: RegressionReport): { label: string; tone: string; title: string } {
  if (source?.status === 'unsupported' && candidate.status === 'unsupported') {
    return { label: 'Non applicable', tone: 'unsupported', title: candidate.scenario?.detail ?? 'Cet état n’existe pas sur cette page.' }
  }
  if (!source?.audit || !candidate.audit || source.audit.truncated || candidate.audit.truncated || ['timeout', 'render-failed', 'unsupported'].includes(source.status) || ['timeout', 'render-failed', 'unsupported'].includes(candidate.status)) {
    return { label: statusLabels[candidate.status], tone: candidate.status, title: cellTitle(candidate) }
  }
  const fixed = report.fixed.filter((finding) => findingBelongsToCell(finding, candidate)).length
  const regressions = report.regressions.filter((finding) => findingBelongsToCell(finding, candidate)).length
  if (regressions) return { label: 'Régression', tone: 'error', title: `${regressions} nouveau${regressions > 1 ? 'x défauts' : ' défaut'} dans cette vue.` }
  if (fixed) return { label: 'Amélioré', tone: 'passed', title: `${fixed} signal${fixed > 1 ? 's supprimés' : ' supprimé'} sans nouveau défaut.` }
  return { label: 'Stable', tone: 'stable', title: 'Aucun nouveau défaut dans cette vue.' }
}

export default function MatrixView({ project, result, progress, busy, compareAvailable, onRun, onOpenCell, onReview }: MatrixViewProps): ReactElement {
  const observations = result?.candidate?.observations ?? result?.source.observations ?? []
  const sourceByKey = useMemo(() => new Map((result?.source.observations ?? []).map((observation) => [observationKey(observation.job), observation])), [result])
  const candidateByKey = useMemo(() => new Map((result?.candidate?.observations ?? []).map((observation) => [observationKey(observation.job), observation])), [result])
  const devices = [...new Map(observations.map((observation) => [observation.job.deviceId, observation.job])).values()]
  const rows = [...new Map(observations.map((observation) => [`${observation.job.route}::${observation.job.state}`, { route: observation.job.route, state: observation.job.state }])).values()]
  const report = result?.report
  const progressPercent = progress ? Math.round(progress.total ? progress.completed / progress.total * 100 : 0) : 0
  const stateOrder: MatrixStateId[] = ['initial', 'navigation-open', 'keyboard-focus']
  rows.sort((left, right) => left.route.localeCompare(right.route) || stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state))

  return <div className="matrix-page">
    <header className="matrix-hero">
      <div><span className="overline">Couverture reproductible</span><h1>Matrice responsive</h1><p>Chaque cellule recharge une route dans un Chromium isolé, à une taille et dans un état précis. Les sources ne sont jamais modifiées pendant ce contrôle.</p></div>
      <div className="matrix-actions"><button className="button button--secondary" type="button" onClick={() => onRun(false)} disabled={busy}>Auditer la source</button><button className="button button--primary" type="button" onClick={() => onRun(true)} disabled={busy || !compareAvailable}>{compareAvailable ? 'Comparer la version préparée' : 'Préparer une version pour comparer'}</button></div>
    </header>

    {busy && progress && <section className="matrix-progress" aria-live="polite"><div><span className="loading-mark" /><div><strong>{progress.phase === 'source' ? 'Mesure de la source' : progress.phase === 'candidate' ? 'Mesure de la version corrigée' : 'Comparaison anti-régression'}</strong><p>{progress.current ? `${progress.current.route} · ${progress.current.deviceName} · ${MATRIX_STATE_LABELS[progress.current.state]}` : 'Consolidation des résultats'}</p></div><b>{progress.completed}/{progress.total}</b></div><span><i style={{ width: `${progressPercent}%` }} /></span></section>}

    {report && <section className={`matrix-verdict is-${report.status}`}>
      <div className="matrix-verdict-mark">{report.status === 'passed' ? '✓' : report.status === 'blocked' ? '!' : '?'}</div>
      <div><span className="overline">Verdict anti-régression</span><h2>{report.status === 'passed' ? 'Comparaison validée' : report.status === 'blocked' ? 'Régression détectée' : 'Révision nécessaire'}</h2><p>{report.status === 'passed' ? `${report.comparableCells} vues comparées, ${report.fixed.length} signal${report.fixed.length > 1 ? 's supprimés' : ' supprimé'} et aucun nouveau défaut.` : report.reasons[0] ?? 'Certaines vues n’ont pas fourni une preuve suffisante.'}</p></div>
      <dl><div><dt>Corrigés</dt><dd>{report.fixed.length}</dd></div><div><dt>Nouveaux</dt><dd>{report.regressions.length}</dd></div><div><dt>Restants</dt><dd>{report.remaining.length}</dd></div></dl>
      {report.status !== 'passed' && <button className="button button--secondary" type="button" onClick={onReview}>Ouvrir la révision</button>}
    </section>}

    {!result && !busy ? <section className="matrix-empty"><span>M—01</span><div><strong>Une couverture lisible, pas une batterie de réglages</strong><p>Responsiver utilise automatiquement les formats Mobile, Tablette et Bureau, puis vérifie l’état initial et la navigation ouverte lorsqu’elle existe.</p></div><ol><li><b>Routes</b><span>{Math.min(project.routes.length, 12)} page{project.routes.length > 1 ? 's' : ''} prête{project.routes.length > 1 ? 's' : ''}</span></li><li><b>Tailles</b><span>393 · 768 · 1440 px</span></li><li><b>États</b><span>Initial · Navigation</span></li></ol></section> : result && <section className="matrix-board" aria-label="Résultats de la matrice responsive">
      <header><div><span className="overline">Dernier passage</span><strong>{result.candidate ? 'Source ↔ version corrigée' : 'Source actuelle'}</strong></div><small>{new Date(result.source.createdAt).toLocaleString('fr-FR')} · cliquez une cellule pour l’ouvrir dans le Laboratoire</small></header>
      <div className="matrix-grid" style={{ gridTemplateColumns: `minmax(250px, 1.4fr) repeat(${devices.length}, minmax(150px, 1fr))` }}>
        <div className="matrix-grid-corner">Route · état</div>
        {devices.map((device) => <div className="matrix-grid-device" key={device.deviceId}><strong>{device.deviceName}</strong><span>{device.width} × {device.height}</span></div>)}
        {rows.flatMap((row) => {
          const rowKey = `${row.route}::${row.state}`
          return [<div className="matrix-grid-route" key={`${rowKey}:label`}><code>{row.route}</code><span>{MATRIX_STATE_LABELS[row.state]}</span></div>, ...devices.map((device) => {
            const key = `${row.route}::${row.state}::${device.deviceId}`
            const source = sourceByKey.get(key)
            const candidate = candidateByKey.get(key)
            const observation = candidate ?? source
            if (!observation) return <div className="matrix-cell is-missing" key={key}>—</div>
            const before = source?.audit?.findings.length ?? 0
            const after = candidate?.audit?.findings.length ?? before
            const presentation = candidate && report ? comparisonCellPresentation(source, candidate, report) : { label: statusLabels[observation.status], tone: observation.status, title: cellTitle(observation) }
            return <button className={`matrix-cell is-${presentation.tone}`} type="button" key={key} onClick={() => onOpenCell(observation)} title={presentation.title}><span>{presentation.label}</span>{candidate ? <strong>{before} → {after}</strong> : <strong>{after} signal{after > 1 ? 's' : ''}</strong>}<small>{Math.round(observation.durationMs / 100) / 10} s</small></button>
          })]
        })}
      </div>
    </section>}
  </div>
}
