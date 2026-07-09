import { useMemo, useState, type ReactElement } from 'react'

type View = 'projects' | 'tester' | 'findings' | 'changes' | 'themes' | 'export'
type ThemeMode = 'light' | 'dark'

interface Device {
  id: string
  name: string
  width: number
  height: number
  category: string
}

const devices: Device[] = [
  { id: 'compact', name: 'Téléphone compact', width: 360, height: 800, category: 'Téléphone' },
  { id: 'phone', name: 'Téléphone courant', width: 390, height: 844, category: 'Téléphone' },
  { id: 'tablet', name: 'Tablette portrait', width: 768, height: 1024, category: 'Tablette' },
  { id: 'desktop', name: 'Portable', width: 1440, height: 900, category: 'Bureau' }
]

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: 'projects', label: 'Projets', icon: 'grid' },
  { id: 'tester', label: 'Tester', icon: 'devices' },
  { id: 'findings', label: 'Constats', icon: 'pulse' },
  { id: 'changes', label: 'Modifications', icon: 'diff' },
  { id: 'themes', label: 'Thèmes', icon: 'moon' },
  { id: 'export', label: 'Exporter', icon: 'download' }
]

function Icon({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<string, ReactElement> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    devices: <><rect x="3" y="5" width="12" height="14" rx="2" /><path d="M7 19h11a2 2 0 0 0 2-2V7" /><path d="M7 8h4" /></>,
    pulse: <><path d="M3 12h4l2.2-6 4 12 2.1-6H21" /></>,
    diff: <><path d="M7 3H4a1 1 0 0 0-1 1v3" /><path d="m3 3 7 7" /><path d="M17 21h3a1 1 0 0 0 1-1v-3" /><path d="m21 21-7-7" /><path d="M14 4h3a3 3 0 0 1 3 3" /><path d="M10 20H7a3 3 0 0 1-3-3" /></>,
    moon: <path d="M20.5 14.1A8.3 8.3 0 0 1 9.9 3.5 8.3 8.3 0 1 0 20.5 14.1Z" />,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    shield: <path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z" />,
    rotate: <><path d="M17 3v4h-4" /><path d="M7 21v-4h4" /><path d="M20 11a8 8 0 0 0-13.6-5.7L3 7" /><path d="M4 13a8 8 0 0 0 13.6 5.7L21 17" /></>,
    scan: <><path d="M4 7V5a1 1 0 0 1 1-1h2" /><path d="M17 4h2a1 1 0 0 1 1 1v2" /><path d="M20 17v2a1 1 0 0 1-1 1h-2" /><path d="M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M7 12h10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
    sliders: <><path d="M4 6h7" /><path d="M15 6h5" /><path d="M9 4v4" /><path d="M4 12h3" /><path d="M13 12h7" /><path d="M10 10v4" /><path d="M4 18h10" /><path d="M18 18h2" /><path d="M15 16v4" /></>
  }
  return <svg {...common}>{paths[name] ?? paths.info}</svg>
}

function severityLabel(issue: ProjectIssue): string {
  return issue.severity === 'bloquant' ? 'Bloquant' : issue.severity === 'attention' ? 'À vérifier' : 'Information'
}

function buildThemePreview(html: string | null, theme: ThemeMode): string {
  if (!html) return '<main style="font:16px system-ui;padding:24px">Aucun aperçu statique disponible pour ce projet.</main>'
  if (theme === 'light') return html
  const darkLayer = `<style>:root{color-scheme:dark!important}html,body{background:#101828!important;color:#e6edf8!important}body{filter:saturate(.84)}a{color:#9ab3ff!important}.hero,.metrics{background:#101828!important}.top,.metric{background:#172033!important;border-color:#344156!important;color:#e6edf8!important}.hero p,p{color:#b2bfd3!important}.visual{filter:brightness(.72) saturate(.78)}</style>`
  return html.replace('</head>', `${darkLayer}</head>`)
}

function patchFor(issue: ProjectIssue): string {
  const location = issue.source ? `${issue.source.file}:${issue.source.line}` : 'fichier à déterminer'
  return `# Responsiver — proposition déterministe\n# Règle : ${issue.rule}\n# Source : ${location}\n\n${issue.proposal}\n`
}

function PreviewFrame({ project, device, theme, compact = false }: { project: ProjectSnapshot; device: Device; theme: ThemeMode; compact?: boolean }): ReactElement {
  const scale = compact ? Math.min(0.34, 250 / device.width) : Math.min(0.65, 560 / device.width)
  const frameHeight = compact ? 280 : 520
  const displayedHeight = Math.min(frameHeight, device.height) * scale

  return (
    <div className={compact ? 'preview-frame preview-frame--compact' : 'preview-frame'}>
      <div className="preview-scale-wrap" style={{ height: `${displayedHeight + 36}px` }}>
        <div className="preview-scale" style={{ width: `${device.width}px`, height: `${Math.min(frameHeight, device.height)}px`, transform: `scale(${scale})` }}>
          <iframe
            title={`Aperçu ${project.name} en ${device.width} par ${device.height}`}
            sandbox=""
            srcDoc={buildThemePreview(project.previewHtml, theme)}
            style={{ width: `${device.width}px`, height: `${Math.min(frameHeight, device.height)}px` }}
          />
        </div>
      </div>
      <div className="preview-caption"><span>{device.name}</span><code>{device.width} × {device.height}</code></div>
    </div>
  )
}

export default function App(): ReactElement {
  const [activeView, setActiveView] = useState<View>('projects')
  const [project, setProject] = useState<ProjectSnapshot | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState('phone')
  const [customWidth, setCustomWidth] = useState('390')
  const [customHeight, setCustomHeight] = useState('844')
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [acceptedRuleIds, setAcceptedRuleIds] = useState<string[]>([])
  const [filter, setFilter] = useState<'all' | ProjectIssue['severity']>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)

  const selectedDevice = useMemo(() => {
    if (selectedDeviceId === 'custom') {
      return { id: 'custom', name: 'Format personnalisé', width: Number(customWidth) || 390, height: Number(customHeight) || 844, category: 'Personnalisé' }
    }
    return devices.find((device) => device.id === selectedDeviceId) ?? devices[1]
  }, [customHeight, customWidth, selectedDeviceId])

  const selectedIssue = project?.issues.find((issue) => issue.id === selectedIssueId) ?? project?.issues[0] ?? null
  const visibleIssues = project?.issues.filter((issue) => filter === 'all' || issue.severity === filter) ?? []
  const acceptedIssues = project?.issues.filter((issue) => acceptedRuleIds.includes(issue.id)) ?? []

  function flash(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 4200)
  }

  async function openProject(): Promise<void> {
    setIsOpening(true)
    try {
      const nextProject = await window.responsiver.chooseProject()
      if (!nextProject) return
      setProject(nextProject)
      setSelectedIssueId(nextProject.issues[0]?.id ?? null)
      setAcceptedRuleIds([])
      setActiveView('tester')
      flash(`${nextProject.name} a été analysé localement.`)
    } catch {
      flash('Le projet n’a pas pu être analysé. Vérifiez les droits d’accès au dossier.')
    } finally {
      setIsOpening(false)
    }
  }

  async function openDemo(): Promise<void> {
    const nextProject = await window.responsiver.openDemoProject()
    setProject(nextProject)
    setSelectedIssueId(nextProject.issues[0]?.id ?? null)
    setAcceptedRuleIds([])
    setActiveView('tester')
    flash('La démonstration locale est prête.')
  }

  function toggleAccepted(issueId: string): void {
    setAcceptedRuleIds((ids) => ids.includes(issueId) ? ids.filter((id) => id !== issueId) : [...ids, issueId])
  }

  async function copyPatch(): Promise<void> {
    const content = acceptedIssues.length ? acceptedIssues.map(patchFor).join('\n') : '# Aucun changement n’a encore été accepté.\n'
    try {
      await navigator.clipboard.writeText(content)
      flash('Les propositions de patch ont été copiées dans le presse-papiers.')
    } catch {
      flash('La copie est indisponible dans ce contexte.')
    }
  }

  async function exportReport(): Promise<void> {
    if (!project) return
    const filePath = await window.responsiver.exportReport(project, acceptedRuleIds)
    if (filePath) flash(`Rapport local enregistré : ${filePath}`)
  }

  function requireProject(view: View): void {
    if (!project) {
      setActiveView('projects')
      flash('Ouvrez d’abord un projet local ou la démonstration.')
      return
    }
    setActiveView(view)
  }

  const projectName = project?.name ?? 'Aucun projet ouvert'

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <div><strong>Responsiver</strong><small>atelier local</small></div>
        </div>

        <nav className="side-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeView === item.id ? 'nav-item nav-item--active' : 'nav-item'}
              onClick={() => item.id === 'projects' ? setActiveView(item.id) : requireProject(item.id)}
              aria-label={item.label}
              aria-current={activeView === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'findings' && project && <b className="nav-badge">{project.issues.length}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="privacy-card"><Icon name="shield" size={16} /><span>Code traité localement</span></div>
          <button className="plain-action" onClick={() => flash('Aucune télémétrie ni compte ne sont activés dans ce MVP.')}><Icon name="info" size={16} /> Confidentialité</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="project-context"><span className="eyebrow">{activeView === 'projects' ? 'ESPACE DE TRAVAIL' : 'PROJET LOCAL'}</span><strong>{projectName}</strong></div>
          <div className="topbar-actions">
            {project && <span className="local-pill"><Icon name="shield" size={14} /> Local uniquement</span>}
            <button className="button button--secondary" onClick={openProject} disabled={isOpening}><Icon name="folder" /> {isOpening ? 'Ouverture…' : 'Ouvrir un projet'}</button>
          </div>
        </header>

        <section className="workspace" aria-live="polite">
          {activeView === 'projects' && (
            <ProjectsView project={project} onOpenProject={openProject} onOpenDemo={openDemo} onContinue={() => requireProject('tester')} isOpening={isOpening} />
          )}
          {activeView === 'tester' && project && (
            <TesterView
              project={project}
              selectedDevice={selectedDevice}
              selectedDeviceId={selectedDeviceId}
              customWidth={customWidth}
              customHeight={customHeight}
              theme={theme}
              selectedIssue={selectedIssue}
              onSelectDevice={setSelectedDeviceId}
              onSetCustomWidth={setCustomWidth}
              onSetCustomHeight={setCustomHeight}
              onRotate={() => { const width = customWidth; setCustomWidth(customHeight); setCustomHeight(width); setSelectedDeviceId('custom') }}
              onSetTheme={setTheme}
              onSelectIssue={(issue) => { setSelectedIssueId(issue.id); setActiveView('findings') }}
              onSweep={() => flash('Balayage prêt : le MVP met en évidence les largeurs 320, 360, 390, 768, 1024 et 1440 px.')}
            />
          )}
          {activeView === 'findings' && project && (
            <FindingsView issues={visibleIssues} selectedIssueId={selectedIssue?.id ?? null} filter={filter} onFilter={setFilter} onSelect={setSelectedIssueId} onPrepare={(issue) => { setSelectedIssueId(issue.id); setActiveView('changes') }} />
          )}
          {activeView === 'changes' && project && selectedIssue && (
            <ChangesView issue={selectedIssue} accepted={acceptedRuleIds.includes(selectedIssue.id)} project={project} device={selectedDevice} theme={theme} onToggle={() => toggleAccepted(selectedIssue.id)} onNext={() => setActiveView('themes')} />
          )}
          {activeView === 'themes' && project && (
            <ThemesView project={project} device={selectedDevice} onOpenChanges={() => setActiveView('changes')} />
          )}
          {activeView === 'export' && project && (
            <ExportView project={project} acceptedIssues={acceptedIssues} onCopyPatch={copyPatch} onExportReport={exportReport} />
          )}
        </section>
      </main>

      {notice && <div className="toast" role="status"><Icon name="info" size={17} /> {notice}</div>}
    </div>
  )
}

function ProjectsView({ project, onOpenProject, onOpenDemo, onContinue, isOpening }: { project: ProjectSnapshot | null; onOpenProject: () => void; onOpenDemo: () => void; onContinue: () => void; isOpening: boolean }): ReactElement {
  return <div className="projects-view">
    <div className="intro-copy"><span className="section-kicker">VALIDATION RESPONSIVE, SANS CLOUD</span><h1>Vérifiez les cassures.<br /><em>Gardez le contrôle.</em></h1><p>Responsiver analyse vos fichiers localement, teste des dimensions réelles et prépare des corrections justifiées avant toute écriture.</p></div>
    <div className="import-panel">
      <div className="import-icon"><Icon name="folder" size={28} /></div>
      <div><h2>Ouvrir un projet local</h2><p>Choisissez un dossier HTML, CSS ou un projet de build. Rien n’est envoyé.</p></div>
      <div className="import-actions"><button className="button button--primary" onClick={onOpenProject} disabled={isOpening}><Icon name="folder" /> Choisir un dossier</button><button className="button button--secondary" onClick={onOpenDemo}>Explorer la démo <Icon name="arrow" /></button></div>
      <small><Icon name="shield" size={13} /> La preview du MVP désactive scripts, réseau et formulaires.</small>
    </div>
    <div className="project-section-head"><div><span className="section-kicker">ESPACE DE TRAVAIL</span><h2>{project ? 'Projet actuellement chargé' : 'Commencez avec un cas concret'}</h2></div>{project && <button className="text-button" onClick={onContinue}>Ouvrir le test <Icon name="arrow" size={15} /></button>}</div>
    {project ? <article className="current-project-card"><div className="project-monogram">{project.name.slice(0, 2).toUpperCase()}</div><div><strong>{project.name}</strong><p>{project.files} fichiers analysés · {project.kind}</p></div><div className="project-status"><span></span> Prêt à tester</div></article> : <div className="empty-flow"><span>01</span><p>Importez un projet, puis obtenez une première liste de constats sourcés et réversibles.</p></div>}
  </div>
}

function TesterView({ project, selectedDevice, selectedDeviceId, customWidth, customHeight, theme, selectedIssue, onSelectDevice, onSetCustomWidth, onSetCustomHeight, onRotate, onSetTheme, onSelectIssue, onSweep }: { project: ProjectSnapshot; selectedDevice: Device; selectedDeviceId: string; customWidth: string; customHeight: string; theme: ThemeMode; selectedIssue: ProjectIssue | null; onSelectDevice: (id: string) => void; onSetCustomWidth: (value: string) => void; onSetCustomHeight: (value: string) => void; onRotate: () => void; onSetTheme: (value: ThemeMode) => void; onSelectIssue: (issue: ProjectIssue) => void; onSweep: () => void }): ReactElement {
  return <div className="tester-view">
    <div className="page-title"><div><span className="section-kicker">DEVICE LAB</span><h1>Tester le comportement réel</h1><p>Mode statique sécurisé : le HTML/CSS local est isolé, les scripts et le réseau ne s’exécutent pas.</p></div><button className="button button--secondary" onClick={onSweep}><Icon name="scan" /> Balayer les largeurs</button></div>
    <div className="test-toolbar" aria-label="Réglages de la prévisualisation">
      <div className="device-tabs" role="tablist" aria-label="Profils d’appareil">{devices.map((device) => <button key={device.id} role="tab" aria-selected={selectedDeviceId === device.id} className={selectedDeviceId === device.id ? 'device-tab device-tab--active' : 'device-tab'} onClick={() => onSelectDevice(device.id)}>{device.width}px</button>)}<button role="tab" aria-selected={selectedDeviceId === 'custom'} className={selectedDeviceId === 'custom' ? 'device-tab device-tab--active' : 'device-tab'} onClick={() => onSelectDevice('custom')}>Personnalisé</button></div>
      <div className="dimension-fields"><label>Largeur<input aria-label="Largeur personnalisée" value={customWidth} inputMode="numeric" onChange={(event) => { onSetCustomWidth(event.target.value); onSelectDevice('custom') }} /></label><span>×</span><label>Hauteur<input aria-label="Hauteur personnalisée" value={customHeight} inputMode="numeric" onChange={(event) => { onSetCustomHeight(event.target.value); onSelectDevice('custom') }} /></label><button className="icon-button" aria-label="Inverser largeur et hauteur" onClick={onRotate}><Icon name="rotate" /></button></div>
      <div className="theme-switch" role="group" aria-label="Thème de la page"><button className={theme === 'light' ? 'active' : ''} onClick={() => onSetTheme('light')}>Clair</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => onSetTheme('dark')}>Sombre</button></div>
    </div>
    <div className="tester-grid"><section className="preview-zone"><div className="preview-ruler"><span>{selectedDevice.category}</span><code>{selectedDevice.width} × {selectedDevice.height} CSS px</code><span>échelle auto</span></div><PreviewFrame project={project} device={selectedDevice} theme={theme} /><div className="preview-note"><Icon name="shield" size={15} /> Aperçu de contenu local statique ; les interactions dynamiques seront ajoutées via un runner isolé.</div></section><aside className="finding-inspector"><div className="inspector-head"><span className="section-kicker">CONSTAT SÉLECTIONNÉ</span><span className="coverage-chip">{selectedIssue?.coverage ?? 'manuel'}</span></div>{selectedIssue ? <IssueDetail issue={selectedIssue} onAction={() => onSelectIssue(selectedIssue)} actionLabel="Voir le constat" /> : <p>Aucun constat sélectionné.</p>}</aside></div>
  </div>
}

function IssueDetail({ issue, onAction, actionLabel }: { issue: ProjectIssue; onAction?: () => void; actionLabel?: string }): ReactElement {
  return <div className="issue-detail"><div className="issue-topline"><span className={`severity severity--${issue.severity}`}>{severityLabel(issue)}</span><code>{issue.viewport}</code></div><h3>{issue.title}</h3><p>{issue.description}</p><dl><div><dt>Règle</dt><dd><code>{issue.rule}</code></dd></div>{issue.source && <div><dt>Source</dt><dd><code>{issue.source.file}:{issue.source.line}</code></dd></div>}</dl><div className="proposal"><span>Proposition</span><p>{issue.proposal}</p></div>{onAction && <button className="button button--secondary button--full" onClick={onAction}>{actionLabel}<Icon name="arrow" /></button>}</div>
}

function FindingsView({ issues, selectedIssueId, filter, onFilter, onSelect, onPrepare }: { issues: ProjectIssue[]; selectedIssueId: string | null; filter: 'all' | ProjectIssue['severity']; onFilter: (filter: 'all' | ProjectIssue['severity']) => void; onSelect: (issueId: string) => void; onPrepare: (issue: ProjectIssue) => void }): ReactElement {
  return <div className="findings-view"><div className="page-title"><div><span className="section-kicker">AUDIT</span><h1>Des constats, pas des promesses</h1><p>Chaque signal indique son niveau de couverture : standard, heuristique ou contrôle manuel.</p></div></div><div className="filter-bar" role="group" aria-label="Filtrer les constats">{([['all', 'Tous'], ['bloquant', 'Bloquants'], ['attention', 'À vérifier'], ['information', 'Informations']] as const).map(([id, label]) => <button key={id} className={filter === id ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => onFilter(id)}>{label}</button>)}</div><div className="findings-layout"><div className="finding-list">{issues.map((issue) => <article key={issue.id} className={selectedIssueId === issue.id ? 'finding-row finding-row--selected' : 'finding-row'}><button onClick={() => onSelect(issue.id)}><span className={`severity-dot severity-dot--${issue.severity}`}></span><div><div className="finding-titleline"><strong>{issue.title}</strong><span>{severityLabel(issue)}</span></div><p>{issue.description}</p><small>{issue.viewport} · {issue.coverage}</small></div></button><button className="row-action" onClick={() => onPrepare(issue)} aria-label={`Préparer la modification pour ${issue.title}`}>Préparer <Icon name="arrow" size={15} /></button></article>)}{issues.length === 0 && <div className="no-findings">Aucun constat ne correspond à ce filtre.</div>}</div><aside className="audit-guide"><Icon name="info" size={20} /><h3>Comment lire ce résultat ?</h3><p><strong>Standard</strong> : règle web connue. <strong>Heuristique</strong> : signal à confirmer visuellement. <strong>Manuel</strong> : contrôle nécessaire.</p><p>Ne validez jamais une correction sans relancer les dimensions concernées.</p></aside></div></div>
}

function ChangesView({ issue, accepted, project, device, theme, onToggle, onNext }: { issue: ProjectIssue; accepted: boolean; project: ProjectSnapshot; device: Device; theme: ThemeMode; onToggle: () => void; onNext: () => void }): ReactElement {
  return <div className="changes-view"><div className="page-title"><div><span className="section-kicker">STAGING DE MODIFICATION</span><h1>{issue.title}</h1><p>La proposition est préparée localement. Elle ne modifie aucun fichier tant qu’elle n’est pas exportée ou appliquée plus tard.</p></div><span className={accepted ? 'accepted-state' : 'pending-state'}>{accepted ? 'Acceptée pour export' : 'En attente de décision'}</span></div><div className="change-grid"><section className="visual-review"><div className="review-labels"><span>Référence</span><span>Validation visuelle</span></div><div className="review-previews"><PreviewFrame project={project} device={device} theme={theme} compact /><PreviewFrame project={project} device={device} theme={theme} compact /></div><p className="visual-caption">Les deux rendus sont synchronisés. Le runner de transformation est volontairement séparé du projet original.</p></section><section className="code-review"><div className="code-head"><span>Proposition déterministe</span><code>{issue.rule}</code></div><pre aria-label="Patch de code proposé"><span className="code-comment"># {issue.source ? `${issue.source.file}:${issue.source.line}` : 'Source à confirmer'}</span>{'\n'}<span className="code-remove">- {issue.description}</span>{'\n'}<span className="code-add">+ {issue.proposal}</span></pre><div className="change-actions"><button className={accepted ? 'button button--secondary' : 'button button--primary'} onClick={onToggle}><Icon name={accepted ? 'check' : 'diff'} />{accepted ? 'Retirer du staging' : 'Accepter la proposition'}</button><button className="button button--secondary" onClick={onNext}>Vérifier les thèmes <Icon name="arrow" /></button></div></section></div></div>
}

function ThemesView({ project, device, onOpenChanges }: { project: ProjectSnapshot; device: Device; onOpenChanges: () => void }): ReactElement {
  return <div className="themes-view"><div className="page-title"><div><span className="section-kicker">THÈMES</span><h1>Construire un sombre, pas l’inverser</h1><p>Responsiver sépare le thème de son interface de celui du site inspecté et maintient une revue par tokens.</p></div><button className="button button--secondary" onClick={onOpenChanges}>Revenir aux modifications <Icon name="arrow" /></button></div><div className="theme-review-grid"><section className="theme-preview-card"><header><div><span>Référence</span><strong>Clair</strong></div><code>color-scheme: light</code></header><PreviewFrame project={project} device={device} theme="light" compact /></section><section className="theme-preview-card theme-preview-card--dark"><header><div><span>Proposition</span><strong>Sombre</strong></div><code>prefers-color-scheme</code></header><PreviewFrame project={project} device={device} theme="dark" compact /></section></div><section className="tokens-card"><div><div><span className="section-kicker">COUCHE DE TOKENS</span><h2>Éléments à contrôler avant application</h2></div><span className="coverage-chip">Revue manuelle</span></div><div className="token-grid"><div><code>--surface</code><span>Fond principal</span><b>À confirmer</b></div><div><code>--text-primary</code><span>Texte courant</span><b>Contraste requis</b></div><div><code>--accent</code><span>Actions et liens</span><b>Marque à préserver</b></div><div><code>media assets</code><span>Images et logos</span><b>À vérifier</b></div></div></section></div>
}

function ExportView({ project, acceptedIssues, onCopyPatch, onExportReport }: { project: ProjectSnapshot; acceptedIssues: ProjectIssue[]; onCopyPatch: () => void; onExportReport: () => void }): ReactElement {
  const totals = { blocked: project.issues.filter((issue) => issue.severity === 'bloquant').length, warnings: project.issues.filter((issue) => issue.severity === 'attention').length, manual: project.issues.filter((issue) => issue.coverage === 'manuel').length }
  return <div className="export-view"><div className="page-title"><div><span className="section-kicker">EXPORT TRAÇABLE</span><h1>Livrer des preuves, pas un score vague</h1><p>Le dossier d’origine reste inchangé. Les décisions acceptées sont exportées avec les règles qui les justifient.</p></div></div><section className="result-summary"><div><span>{acceptedIssues.length}</span><p>proposition{acceptedIssues.length > 1 ? 's' : ''} acceptée{acceptedIssues.length > 1 ? 's' : ''}</p></div><div><span>{totals.blocked}</span><p>bloquant{totals.blocked > 1 ? 's' : ''} à traiter</p></div><div><span>{totals.warnings}</span><p>signal{totals.warnings > 1 ? 's' : ''} à vérifier</p></div><div><span>{totals.manual}</span><p>contrôle{totals.manual > 1 ? 's' : ''} manuel</p></div></section><div className="export-actions"><article><Icon name="copy" size={24} /><h2>Copier le patch de travail</h2><p>Copie les propositions acceptées et leurs sources. Aucun fichier n’est modifié par cette action.</p><button className="button button--primary" onClick={onCopyPatch}>Copier le patch <Icon name="copy" /></button></article><article><Icon name="download" size={24} /><h2>Enregistrer le rapport</h2><p>Produit un JSON local incluant la matrice, les constats et les décisions de staging.</p><button className="button button--secondary" onClick={onExportReport}>Enregistrer le rapport <Icon name="download" /></button></article></div><section className="export-proof"><div><span className="section-kicker">CONTENU DU RAPPORT</span><h2>{project.name}</h2><p>{project.files} fichiers analysés · {project.issues.length} constats · génération locale</p></div><ul>{project.issues.map((issue) => <li key={issue.id}><span className={acceptedIssues.some((accepted) => accepted.id === issue.id) ? 'list-check list-check--accepted' : 'list-check'}><Icon name="check" size={14} /></span><span>{issue.title}</span><code>{issue.rule}</code></li>)}</ul></section></div>
}
