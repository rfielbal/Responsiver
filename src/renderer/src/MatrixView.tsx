import { useMemo, useState, type ReactElement } from 'react'
import type { MatrixJob, MatrixObservation, MatrixRunProgress, MatrixRunResult, MatrixStateId, ProjectSnapshot, RegressionFinding, RegressionReport, RuntimeAuditFinding, RuntimeAuditRule } from '../../shared/contracts'
import { MATRIX_STATE_LABELS } from '../../shared/regression-matrix'
import './matrix-view.css'

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
  passed: 'Conforme',
  warning: 'À vérifier',
  error: 'À corriger',
  unsupported: 'Non testé',
  timeout: 'Audit incomplet',
  'render-failed': 'Rendu absent'
}

const rulePresentation: Readonly<Record<RuntimeAuditRule, { label: string; category: string; recommendation: string }>> = {
  'responsive.missing-viewport': { label: 'Viewport mobile absent', category: 'Configuration', recommendation: 'Ajouter une balise viewport adaptée avant de juger les breakpoints mobiles.' },
  'layout.viewport-overflow': { label: 'Débordement horizontal', category: 'Mise en page', recommendation: 'Rendre la largeur fluide, supprimer la contrainte rigide responsable et borner le bloc au viewport.' },
  'layout.clipped-content': { label: 'Contenu rogné', category: 'Mise en page', recommendation: 'Réviser la taille du conteneur et sa règle overflow afin de préserver le contenu utile.' },
  'layout.truncated-text': { label: 'Texte tronqué', category: 'Lisibilité', recommendation: 'Autoriser le retour à la ligne ou adapter le conteneur à ce breakpoint.' },
  'layout.navigation-wrap': { label: 'Navigation déséquilibrée', category: 'Navigation', recommendation: 'Prévoir une navigation repliable ou réorganiser ses rangées et espacements à cette largeur.' },
  'layout.element-overlap': { label: 'Éléments superposés', category: 'Mise en page', recommendation: 'Replacer les éléments dans le flux et définir un espacement responsive explicite.' },
  'layout.density-hierarchy': { label: 'Zone trop dense', category: 'Hiérarchie visuelle', recommendation: 'Réduire ou empiler les actions secondaires afin de rendre le parcours principal immédiatement lisible.' },
  'layout.useful-area-overflow': { label: 'Contenu hors zone utile', category: 'Mise en page', recommendation: 'Contraindre le bloc à la largeur utile et autoriser son contenu à se réorganiser.' },
  'typography.disproportionate': { label: 'Échelle typographique', category: 'Lisibilité', recommendation: 'Borner le corps avec clamp() et ajuster la hauteur de ligne pour ce format.' },
  'typography.mobile-readability': { label: 'Texte difficile à lire', category: 'Lisibilité', recommendation: 'Augmenter le corps ou l’interlignage du texte sur les petits écrans.' },
  'interaction.small-target': { label: 'Cibles tactiles petites', category: 'Interaction', recommendation: 'Porter la zone interactive à environ 44 × 44 px ou augmenter son espacement tactile.' },
  'layout.fixed-obstruction': { label: 'Élément fixe gênant', category: 'Mise en page', recommendation: 'Réduire, déplacer ou désactiver la position fixe au breakpoint concerné.' },
  'media.image-error': { label: 'Image indisponible', category: 'Média', recommendation: 'Vérifier la ressource et prévoir un contenu alternatif lorsque son chargement échoue.' },
  'media.image-distortion': { label: 'Image déformée', category: 'Média', recommendation: 'Préserver le ratio naturel avec une dimension automatique ou un object-fit adapté.' },
  'accessibility.low-contrast': { label: 'Contraste insuffisant', category: 'Lisibilité', recommendation: 'Ajuster la couleur du texte ou de son fond jusqu’au contraste attendu.' },
  'runtime.page-error': { label: 'Erreur de page', category: 'Exécution', recommendation: 'Reproduire l’erreur dans le Laboratoire puis corriger sa source avant l’audit visuel.' }
}

interface MatrixFindingGroup {
  rule: RuntimeAuditRule
  findings: RuntimeAuditFinding[]
  severity: RuntimeAuditFinding['severity']
  confidence: number
  representative: RuntimeAuditFinding
}

function findingGroups(observation: MatrixObservation | undefined): MatrixFindingGroup[] {
  if (!observation?.audit) return []
  const byRule = new Map<RuntimeAuditRule, RuntimeAuditFinding[]>()
  for (const finding of observation.audit.findings) {
    const entries = byRule.get(finding.rule) ?? []
    entries.push(finding)
    byRule.set(finding.rule, entries)
  }
  return [...byRule.entries()].map(([rule, findings]) => {
    const sorted = [...findings].sort((left, right) => Number(right.severity === 'error') - Number(left.severity === 'error') || right.confidence - left.confidence)
    const severity: RuntimeAuditFinding['severity'] = sorted.some((finding) => finding.severity === 'error') ? 'error' : 'warning'
    return {
      rule,
      findings,
      severity,
      confidence: Math.max(...findings.map((finding) => finding.confidence)),
      representative: sorted[0]
    }
  }).sort((left, right) => Number(right.severity === 'error') - Number(left.severity === 'error') || right.confidence - left.confidence || right.findings.length - left.findings.length)
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}

function cellCounts(observation: MatrixObservation | undefined): { findings: number; groups: number } {
  return {
    findings: observation?.audit?.findings.length ?? 0,
    groups: findingGroups(observation).length
  }
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
  return { label: 'Inchangé', tone: 'stable', title: 'Aucun nouveau défaut dans cette vue.' }
}

export default function MatrixView({ project, result, progress, busy, compareAvailable, onRun, onOpenCell, onReview }: MatrixViewProps): ReactElement {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const observations = result?.candidate?.observations ?? result?.source.observations ?? []
  const sourceByKey = useMemo(() => new Map((result?.source.observations ?? []).map((observation) => [observationKey(observation.job), observation])), [result])
  const candidateByKey = useMemo(() => new Map((result?.candidate?.observations ?? []).map((observation) => [observationKey(observation.job), observation])), [result])
  const devices = [...new Map(observations.map((observation) => [observation.job.deviceId, observation.job])).values()]
  const rows = [...new Map(observations.map((observation) => [`${observation.job.route}::${observation.job.state}`, { route: observation.job.route, state: observation.job.state }])).values()]
  const report = result?.report
  const progressPercent = progress ? Math.round(progress.total ? progress.completed / progress.total * 100 : 0) : 0
  const primaryAction = compareAvailable
    ? { label: 'Comparer la version préparée', compare: true }
    : { label: 'Auditer la source', compare: false }
  const secondaryAction = compareAvailable
    ? { label: 'Auditer de nouveau la source', compare: false, disabled: false }
    : { label: 'Préparer une version pour comparer', compare: true, disabled: true }
  const stateOrder: MatrixStateId[] = ['initial', 'navigation-open', 'keyboard-focus']
  rows.sort((left, right) => left.route.localeCompare(right.route) || stateOrder.indexOf(left.state) - stateOrder.indexOf(right.state))
  const selectedSource = selectedKey ? sourceByKey.get(selectedKey) : undefined
  const selectedCandidate = selectedKey ? candidateByKey.get(selectedKey) : undefined
  const selectedObservation = selectedCandidate ?? selectedSource
  const selectedGroups = useMemo(() => findingGroups(selectedObservation), [selectedObservation])
  const selectedCounts = cellCounts(selectedObservation)
  const selectedPresentation = selectedObservation
    ? selectedCandidate && report
      ? comparisonCellPresentation(selectedSource, selectedCandidate, report)
      : { label: statusLabels[selectedObservation.status], tone: selectedObservation.status, title: cellTitle(selectedObservation) }
    : null

  return <div className="matrix-page matrix-page--compact">
    <header className="matrix-hero">
      <div className="matrix-hero__identity"><span className="overline">Couverture reproductible</span><div><h1>Matrice responsive</h1><p>Routes × tailles × états, rejoués dans un Chromium isolé sans modifier les sources.</p></div></div>
      <div className="matrix-actions">
        <button className="button button--primary" type="button" onClick={() => { setSelectedKey(null); onRun(primaryAction.compare) }} disabled={busy}>{primaryAction.label}</button>
        <details className="matrix-more-actions">
          <summary aria-label="Afficher les autres actions de la matrice" title="Autres actions"><span aria-hidden="true">•••</span></summary>
          <div><button className="button button--secondary" type="button" onClick={() => { setSelectedKey(null); onRun(secondaryAction.compare) }} disabled={busy || secondaryAction.disabled}>{secondaryAction.label}</button></div>
        </details>
      </div>
    </header>

    {busy && progress && <section className="matrix-progress" aria-live="polite"><div><span className="loading-mark" /><div><strong>{progress.phase === 'source' ? 'Mesure de la source' : progress.phase === 'candidate' ? 'Mesure de la version corrigée' : 'Comparaison anti-régression'}</strong><p>{progress.current ? `${progress.current.route} · ${progress.current.deviceName} · ${MATRIX_STATE_LABELS[progress.current.state]}` : 'Consolidation des résultats'}</p></div><b>{progress.completed}/{progress.total}</b></div><span><i style={{ width: `${progressPercent}%` }} /></span></section>}

    {report && <details className={`matrix-verdict is-${report.status}`} open={report.status !== 'passed'}>
      <summary>
        <span className="matrix-verdict-mark" aria-hidden="true">{report.status === 'passed' ? '✓' : report.status === 'blocked' ? '!' : '?'}</span>
        <span className="matrix-verdict-title"><small>Verdict anti-régression</small><strong>{report.status === 'passed' ? 'Comparaison validée' : report.status === 'blocked' ? 'Régression détectée' : 'Révision nécessaire'}</strong></span>
        <span className="matrix-verdict-metrics" aria-label={`${report.fixed.length} corrigés, ${report.regressions.length} nouveaux, ${report.remaining.length} restants`}><span><b>{report.fixed.length}</b> corrigés</span><span><b>{report.regressions.length}</b> nouveaux</span><span><b>{report.remaining.length}</b> restants</span></span>
        <span className="matrix-verdict-toggle"><span className="matrix-verdict-toggle__closed">Détails</span><span className="matrix-verdict-toggle__open">Réduire</span><i aria-hidden="true" /></span>
      </summary>
      <div className="matrix-verdict-details">
        <p>{report.status === 'passed' ? `${report.comparableCells} vues comparées, ${report.fixed.length} signal${report.fixed.length > 1 ? 's supprimés' : ' supprimé'} et aucun nouveau défaut.` : report.reasons[0] ?? 'Certaines vues n’ont pas fourni une preuve suffisante.'}</p>
        {report.reasons.length > 1 && <ul>{report.reasons.slice(1).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        {report.status !== 'passed' && <button className="button button--secondary" type="button" onClick={onReview}>Ouvrir la révision</button>}
      </div>
    </details>}

    {!result && !busy ? <section className="matrix-empty"><span>M—01</span><div><strong>Une couverture lisible, pas une batterie de réglages</strong><p>Responsiver utilise automatiquement les formats Mobile, Tablette et Bureau, puis vérifie l’état initial et la navigation ouverte lorsqu’elle existe.</p></div><ol><li><b>Routes</b><span>{Math.min(project.routes.length, 12)} page{project.routes.length > 1 ? 's' : ''} prête{project.routes.length > 1 ? 's' : ''}</span></li><li><b>Tailles</b><span>393 · 768 · 1440 px</span></li><li><b>États</b><span>Initial · Navigation</span></li></ol></section> : result && <section className="matrix-board" aria-label="Résultats de la matrice responsive">
      <header><div><span className="overline">Dernier passage</span><strong>{result.candidate ? 'Source ↔ version corrigée' : 'Source actuelle'}</strong></div><small>{new Date(result.source.createdAt).toLocaleString('fr-FR')} · sélectionnez une cellule pour comprendre le résultat</small></header>
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
            const sourceCounts = cellCounts(source)
            const candidateCounts = cellCounts(candidate)
            const currentCounts = candidate ? candidateCounts : sourceCounts
            const presentation = candidate && report ? comparisonCellPresentation(source, candidate, report) : { label: statusLabels[observation.status], tone: observation.status, title: cellTitle(observation) }
            const summary = currentCounts.groups
              ? `${currentCounts.groups} ${plural(currentCounts.groups, 'priorité')}, ${currentCounts.findings} ${plural(currentCounts.findings, 'observation')}`
              : presentation.title
            return <button
              className={`matrix-cell is-${presentation.tone}${selectedKey === key ? ' is-selected' : ''}`}
              type="button"
              key={key}
              onClick={() => setSelectedKey((current) => current === key ? null : key)}
              title={`${presentation.title} · Afficher le détail`}
              aria-label={`${observation.job.route}, ${observation.job.deviceName}, ${MATRIX_STATE_LABELS[observation.job.state]} : ${presentation.label}. ${summary}`}
              aria-pressed={selectedKey === key}
              aria-controls="matrix-cell-detail"
            >
              <span>{presentation.label}</span>
              {candidate && (sourceCounts.groups > 0 || candidateCounts.groups > 0)
                ? <><strong>{sourceCounts.groups} → {candidateCounts.groups} {plural(candidateCounts.groups, 'priorité')}</strong><em>{before} → {after} observations</em></>
                : currentCounts.groups
                  ? <><strong>{currentCounts.groups} {plural(currentCounts.groups, 'priorité')}</strong><em>{currentCounts.findings} {plural(currentCounts.findings, 'observation')}</em></>
                  : <><strong>{presentation.title}</strong><em>Ouvrir le détail</em></>}
              <small>{Math.round(observation.durationMs / 100) / 10} s</small>
            </button>
          })]
        })}
      </div>
    </section>}

    {selectedObservation && selectedPresentation && <aside className={`matrix-cell-detail is-${selectedPresentation.tone}`} id="matrix-cell-detail" aria-labelledby="matrix-cell-detail-title" aria-live="polite">
      <header className="matrix-cell-detail__header">
        <div><span className="overline">Lecture de la cellule</span><h2 id="matrix-cell-detail-title">{selectedObservation.job.deviceName} · {MATRIX_STATE_LABELS[selectedObservation.job.state]}</h2><code>{selectedObservation.job.route}</code></div>
        <button type="button" onClick={() => setSelectedKey(null)} aria-label="Fermer le détail de la cellule" title="Fermer">×</button>
      </header>

      <div className="matrix-cell-detail__summary">
        <span>{selectedPresentation.label}</span>
        <div>
          <strong>{selectedCounts.groups
            ? `${selectedCounts.groups} ${plural(selectedCounts.groups, 'priorité')} à examiner`
            : selectedPresentation.title}</strong>
          <p>{selectedCounts.findings
            ? selectedCounts.findings === 1
              ? 'Une observation a été regroupée dans sa priorité : elle reste à confirmer visuellement.'
              : `${selectedCounts.findings} observations similaires ont été regroupées par cause probable : ce ne sont pas ${selectedCounts.findings} problèmes différents.`
            : selectedObservation.status === 'passed'
              ? 'Aucune anomalie responsive n’a été reproduite dans cette vue.'
              : selectedObservation.detail ?? selectedObservation.scenario?.detail ?? 'Cette vue n’a pas produit assez de données pour établir un diagnostic.'}</p>
        </div>
      </div>

      {selectedCandidate && selectedSource && <div className="matrix-cell-detail__comparison" aria-label="Évolution de cette vue"><span>Source <b>{selectedSource.audit?.findings.length ?? 0}</b></span><i aria-hidden="true">→</i><span>Version préparée <b>{selectedCandidate.audit?.findings.length ?? 0}</b></span></div>}

      {selectedGroups.length > 0 && <section className="matrix-cell-detail__priorities" aria-labelledby="matrix-cell-priorities-title">
        <header><h3 id="matrix-cell-priorities-title">Priorités regroupées</h3><span>par impact puis confiance</span></header>
        <ol>{selectedGroups.map((group, index) => {
          const presentation = rulePresentation[group.rule]
          const distinctSelectors = new Set(group.findings.map((finding) => finding.selector)).size
          return <li key={group.rule}>
            <details open={index === 0}>
              <summary>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span><small>{presentation.category} · {group.findings.length} {plural(group.findings.length, 'occurrence')}</small><strong>{presentation.label}</strong></span>
                <em className={group.severity === 'error' ? 'is-error' : ''}>{group.severity === 'error' ? 'Prioritaire' : 'À vérifier'}</em>
                <i aria-hidden="true" />
              </summary>
              <div>
                <p>{group.representative.description}</p>
                <p><b>Piste proposée</b>{presentation.recommendation}</p>
                <code title={group.representative.selector}>{group.representative.selector}</code>
                {distinctSelectors > 1 && <small>{distinctSelectors} éléments distincts concernés dans cette vue.</small>}
              </div>
            </details>
          </li>
        })}</ol>
      </section>}

      <footer className="matrix-cell-detail__footer">
        <div><strong>Ouvrir avec le bon contexte</strong><span>{selectedObservation.job.route} · {selectedObservation.job.width} × {selectedObservation.job.height} · {MATRIX_STATE_LABELS[selectedObservation.job.state]}</span></div>
        <button className="button button--primary" type="button" onClick={() => onOpenCell(selectedObservation)}>Ouvrir cette vue dans le Laboratoire</button>
        <small>La route, le format et l’état testé seront restaurés pour retrouver exactement cette vue.</small>
      </footer>
    </aside>}
  </div>
}
