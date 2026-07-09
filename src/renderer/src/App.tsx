import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

type View = 'projects' | 'tester' | 'findings' | 'changes' | 'themes' | 'export'
type DeviceFamily = 'smartphone' | 'tablet' | 'computer'
type RuntimeTheme = 'dark' | 'light' | 'unknown'

interface Device {
  id: string
  family: DeviceFamily
  name: string
  width: number
  height: number
  dpr: number
}

const deviceFamilies: Array<{ id: DeviceFamily; label: string; icon: string }> = [
  { id: 'smartphone', label: 'Smartphone', icon: 'phone' },
  { id: 'tablet', label: 'Tablette', icon: 'tablet' },
  { id: 'computer', label: 'Ordinateur', icon: 'laptop' }
]

const devices: Device[] = [
  { id: 'iphone-se', family: 'smartphone', name: 'Téléphone compact', width: 360, height: 800, dpr: 2 },
  { id: 'iphone-15', family: 'smartphone', name: 'iPhone 15', width: 393, height: 852, dpr: 3 },
  { id: 'pixel-8', family: 'smartphone', name: 'Pixel 8', width: 412, height: 915, dpr: 2.6 },
  { id: 'ipad-mini', family: 'tablet', name: 'iPad mini', width: 768, height: 1024, dpr: 2 },
  { id: 'tablet-wide', family: 'tablet', name: 'Tablette large', width: 820, height: 1180, dpr: 2 },
  { id: 'macbook', family: 'computer', name: 'Portable 14 pouces', width: 1440, height: 900, dpr: 2 },
  { id: 'desktop', family: 'computer', name: 'Écran bureau', width: 1920, height: 1080, dpr: 1 }
]

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: 'projects', label: 'Projets', icon: 'grid' },
  { id: 'tester', label: 'Tester', icon: 'inspect' },
  { id: 'findings', label: 'Constats', icon: 'pulse' },
  { id: 'changes', label: 'Modifications', icon: 'diff' },
  { id: 'themes', label: 'Thèmes', icon: 'sun' },
  { id: 'export', label: 'Exporter', icon: 'download' }
]

function Icon({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<string, ReactElement> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    inspect: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M8 20h11a2 2 0 0 0 2-2V8" /><path d="m10 10 4 4" /><path d="m14 10-4 4" /></>,
    pulse: <path d="M3 12h4l2.2-6 4 12 2.1-6H21" />,
    diff: <><path d="M7 3H4a1 1 0 0 0-1 1v3" /><path d="m3 3 7 7" /><path d="M17 21h3a1 1 0 0 0 1-1v-3" /><path d="m21 21-7-7" /><path d="M14 4h3a3 3 0 0 1 3 3" /><path d="M10 20H7a3 3 0 0 1-3-3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    forward: <><path d="m9 18 6-6-6-6" /><path d="M15 12H4" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-4L3 10" /><path d="M3 4v6h6" /><path d="M4 13a8 8 0 0 0 14.9 4L21 14" /><path d="M21 20v-6h-6" /></>,
    shield: <path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z" />,
    rotate: <><path d="M17 3v4h-4" /><path d="M7 21v-4h4" /><path d="M20 11a8 8 0 0 0-13.6-5.7L3 7" /><path d="M4 13a8 8 0 0 0 13.6 5.7L21 17" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
    phone: <rect x="7" y="3" width="10" height="18" rx="2" />,
    tablet: <rect x="5" y="3" width="14" height="18" rx="2" />,
    laptop: <><rect x="4" y="5" width="16" height="11" rx="1" /><path d="M2 19h20" /></>,
    external: <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>
  }
  return <svg {...common}>{paths[name] ?? paths.info}</svg>
}

function severityLabel(issue: ProjectIssue): string {
  return issue.severity === 'bloquant' ? 'Bloquant' : issue.severity === 'attention' ? 'À vérifier' : 'Information'
}

function luminance(rgb: string): number | null {
  const match = rgb.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!match) return null
  const [red, green, blue] = match.slice(1).map(Number).map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function patchFor(issue: ProjectIssue): string {
  const location = issue.source ? `${issue.source.file}:${issue.source.line}` : 'fichier à déterminer'
  return `# Responsiver — proposition déterministe\n# Règle : ${issue.rule}\n# Source : ${location}\n\n${issue.proposal}\n`
}

function PreviewFrame({ project, device, path, compact = false, onPathChange, onThemeChange, onExternal }: { project: ProjectSnapshot; device: Device; path: string; compact?: boolean; onPathChange?: (path: string) => void; onThemeChange?: (theme: RuntimeTheme) => void; onExternal?: (url: string) => void }): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(compact ? 0.25 : 0.6)
  const maxHeight = compact ? 230 : 650

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = (): void => {
      const availableWidth = Math.max(120, stage.clientWidth - 34)
      const availableHeight = Math.max(120, Math.min(maxHeight, stage.clientHeight || maxHeight) - 26)
      setScale(Math.min(1, availableWidth / device.width, availableHeight / device.height))
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [compact, device.height, device.width, maxHeight])

  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (project.previewOrigin && event.origin !== project.previewOrigin) return
      const data = event.data as { channel?: string; type?: string; path?: string; background?: string; url?: string }
      if (data?.channel !== 'responsiver-preview') return
      if (data.type === 'state' && data.path) {
        onPathChange?.(data.path)
        const value = luminance(data.background ?? '')
        if (value !== null) onThemeChange?.(value < 0.42 ? 'dark' : 'light')
      }
      if (data.type === 'external-link' && data.url) onExternal?.(data.url)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [onExternal, onPathChange, onThemeChange])

  const post = (type: string, payload: Record<string, string> = {}): void => frameRef.current?.contentWindow?.postMessage({ channel: 'responsiver-preview', type, ...payload }, '*')
  const actualHeight = Math.round(device.height * scale)
  const actualWidth = Math.round(device.width * scale)
  const source = project.previewOrigin ? `${project.previewOrigin}${path}` : undefined

  return <div className={compact ? 'preview-frame preview-frame--compact' : 'preview-frame'}>
    {!compact && <div className="preview-browserbar"><div className="browser-actions"><button className="icon-button icon-button--small" aria-label="Page précédente" onClick={() => post('back')}><Icon name="back" size={15} /></button><button className="icon-button icon-button--small" aria-label="Page suivante" onClick={() => post('forward')}><Icon name="forward" size={15} /></button><button className="icon-button icon-button--small" aria-label="Recharger la page" onClick={() => post('reload')}><Icon name="refresh" size={14} /></button></div><select aria-label="Pages détectées" value={path} onChange={(event) => { onPathChange?.(event.target.value); post('navigate', { path: event.target.value }) }}>{project.routes.map((route) => <option key={route.path} value={route.path}>{route.label}</option>)}</select><code>{path}</code><span className="preview-status"><i></i> local</span></div>}
    <div ref={stageRef} className="preview-stage" style={{ minHeight: `${compact ? 250 : 670}px` }}>
      <div className="preview-sized" style={{ width: `${actualWidth}px`, height: `${actualHeight}px` }}>
        <div className="preview-viewport" style={{ width: `${device.width}px`, height: `${device.height}px`, transform: `scale(${scale})` }}>
          <iframe ref={frameRef} title={`${project.name} — ${device.name}`} sandbox={project.previewOrigin ? 'allow-scripts allow-forms allow-same-origin' : ''} src={source} srcDoc={source ? undefined : project.previewHtml ?? undefined} />
        </div>
      </div>
    </div>
    <div className="preview-caption"><span>{device.name}</span><code>{device.width} × {device.height}</code><span>×{device.dpr}</span></div>
  </div>
}

export default function App(): ReactElement {
  const [activeView, setActiveView] = useState<View>('projects')
  const [project, setProject] = useState<ProjectSnapshot | null>(null)
  const [family, setFamily] = useState<DeviceFamily>('smartphone')
  const [selectedDeviceId, setSelectedDeviceId] = useState('iphone-15')
  const [customWidth, setCustomWidth] = useState('393')
  const [customHeight, setCustomHeight] = useState('852')
  const [activePath, setActivePath] = useState('/index.html')
  const [runtimeTheme, setRuntimeTheme] = useState<RuntimeTheme>('unknown')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [acceptedRuleIds, setAcceptedRuleIds] = useState<string[]>([])
  const [filter, setFilter] = useState<'all' | ProjectIssue['severity']>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [isOpening, setIsOpening] = useState(false)
  const [projectPath, setProjectPath] = useState('')

  const availableDevices = devices.filter((device) => device.family === family)
  const selectedDevice = useMemo(() => selectedDeviceId === 'custom' ? { id: 'custom', family, name: 'Format personnalisé', width: Number(customWidth) || 393, height: Number(customHeight) || 852, dpr: 1 } : devices.find((device) => device.id === selectedDeviceId) ?? devices[1], [customHeight, customWidth, family, selectedDeviceId])
  const selectedIssue = project?.issues.find((issue) => issue.id === selectedIssueId) ?? project?.issues[0] ?? null
  const visibleIssues = project?.issues.filter((issue) => filter === 'all' || issue.severity === filter) ?? []
  const acceptedIssues = project?.issues.filter((issue) => acceptedRuleIds.includes(issue.id)) ?? []
  const detectedTheme: RuntimeTheme = runtimeTheme === 'unknown' ? project?.theme.detected === 'dark' ? 'dark' : project?.theme.detected === 'light' ? 'light' : 'unknown' : runtimeTheme

  function flash(message: string): void { setNotice(message); window.setTimeout(() => setNotice(null), 4400) }

  function selectDevice(device: Device): void {
    setFamily(device.family)
    setSelectedDeviceId(device.id)
    setCustomWidth(String(device.width))
    setCustomHeight(String(device.height))
  }

  function selectFamily(nextFamily: DeviceFamily): void {
    const first = devices.find((device) => device.family === nextFamily)!
    selectDevice(first)
  }

  function applyProject(nextProject: ProjectSnapshot): void {
    setProject(nextProject)
    setActivePath(nextProject.entryPath ?? '/index.html')
    setRuntimeTheme(nextProject.theme.detected === 'dark' ? 'dark' : nextProject.theme.detected === 'light' ? 'light' : 'unknown')
    setSelectedIssueId(nextProject.issues[0]?.id ?? null)
    setAcceptedRuleIds([])
    setActiveView('tester')
  }

  async function openProject(): Promise<void> {
    setIsOpening(true)
    try {
      const nextProject = await window.responsiver.chooseProject()
      if (!nextProject) return
      applyProject(nextProject)
      flash(`${nextProject.name} est servi sur un environnement local navigable.`)
    } catch { flash('Le projet n’a pas pu être lancé localement. Vérifiez les droits d’accès au dossier.') } finally { setIsOpening(false) }
  }

  async function openProjectPath(): Promise<void> {
    const path = projectPath.trim()
    if (!path) { flash('Collez un chemin de dossier local pour continuer.'); return }
    setIsOpening(true)
    try {
      const nextProject = await window.responsiver.openProjectPath(path)
      applyProject(nextProject)
      flash(`${nextProject.name} est servi sur un environnement local navigable.`)
    } catch { flash('Ce chemin ne pointe pas vers un dossier local accessible.') } finally { setIsOpening(false) }
  }

  async function openDemo(): Promise<void> { applyProject(await window.responsiver.openDemoProject()); flash('La démo locale est prête à être testée.') }
  function toggleAccepted(issueId: string): void { setAcceptedRuleIds((ids) => ids.includes(issueId) ? ids.filter((id) => id !== issueId) : [...ids, issueId]) }
  async function copyPatch(): Promise<void> { try { await navigator.clipboard.writeText(acceptedIssues.length ? acceptedIssues.map(patchFor).join('\n') : '# Aucun changement accepté.\n'); flash('Le patch de travail a été copié localement.') } catch { flash('La copie est indisponible dans ce contexte.') } }
  async function exportReport(): Promise<void> { if (!project) return; const path = await window.responsiver.exportReport(project, acceptedRuleIds); if (path) flash(`Rapport enregistré : ${path}`) }
  function requireProject(view: View): void { if (!project) { setActiveView('projects'); flash('Ouvrez d’abord un projet ou la démo.') } else setActiveView(view) }

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigation principale"><div className="brand-lockup"><div className="brand-mark" aria-hidden="true">R</div><div><strong>Responsiver</strong><small>local design tools</small></div></div><nav className="side-nav">{navItems.map((item) => <button key={item.id} className={activeView === item.id ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => item.id === 'projects' ? setActiveView(item.id) : requireProject(item.id)} aria-label={item.label} aria-current={activeView === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'findings' && project && <b className="nav-badge">{project.issues.length}</b>}</button>)}</nav><div className="sidebar-foot"><div className="privacy-card"><Icon name="shield" size={15} /><span>Local · Google Fonts seulement</span></div><span className="version-label">v0.2.0 — local</span></div></aside>
    <main className="main-area"><header className="topbar"><div className="project-context"><span className="eyebrow">{activeView === 'projects' ? 'ESPACE DE TRAVAIL' : 'PROJET ACTIF'}</span><strong>{project?.name ?? 'Aucun projet ouvert'}</strong></div><div className="topbar-actions">{project && <span className="local-pill"><i></i> {project.previewOrigin ? 'Runner local' : 'Démo intégrée'}</span>}<button className="button button--secondary" onClick={openProject} disabled={isOpening}><Icon name="folder" /> {isOpening ? 'Ouverture…' : 'Ouvrir'}</button></div></header>
      <section className="workspace" aria-live="polite">
        {activeView === 'projects' && <ProjectsView project={project} projectPath={projectPath} onProjectPathChange={setProjectPath} onOpenProject={openProject} onOpenPath={openProjectPath} onOpenDemo={openDemo} onContinue={() => requireProject('tester')} isOpening={isOpening} />}
        {activeView === 'tester' && project && <TesterView project={project} device={selectedDevice} family={family} devices={availableDevices} activePath={activePath} theme={detectedTheme} customWidth={customWidth} customHeight={customHeight} onFamily={selectFamily} onDevice={selectDevice} onPath={setActivePath} onTheme={setRuntimeTheme} onCustomWidth={(value) => { setCustomWidth(value); setSelectedDeviceId('custom') }} onCustomHeight={(value) => { setCustomHeight(value); setSelectedDeviceId('custom') }} onRotate={() => { const width = customWidth; setCustomWidth(customHeight); setCustomHeight(width); setSelectedDeviceId('custom') }} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} selectedIssue={selectedIssue} onSelectIssue={(issue) => { setSelectedIssueId(issue.id); setActiveView('findings') }} />}
        {activeView === 'findings' && project && <FindingsView issues={visibleIssues} selectedIssueId={selectedIssue?.id ?? null} filter={filter} onFilter={setFilter} onSelect={setSelectedIssueId} onPrepare={(issue) => { setSelectedIssueId(issue.id); setActiveView('changes') }} />}
        {activeView === 'changes' && project && selectedIssue && <ChangesView issue={selectedIssue} accepted={acceptedRuleIds.includes(selectedIssue.id)} project={project} device={selectedDevice} path={activePath} onToggle={() => toggleAccepted(selectedIssue.id)} />}
        {activeView === 'themes' && project && <ThemesView project={project} activePath={activePath} detectedTheme={detectedTheme} />}
        {activeView === 'export' && project && <ExportView project={project} acceptedIssues={acceptedIssues} onCopyPatch={copyPatch} onExportReport={exportReport} />}
      </section></main>
    {notice && <div className="toast" role="status"><Icon name="info" size={17} /> {notice}</div>}
  </div>
}

function ProjectsView({ project, projectPath, onProjectPathChange, onOpenProject, onOpenPath, onOpenDemo, onContinue, isOpening }: { project: ProjectSnapshot | null; projectPath: string; onProjectPathChange: (value: string) => void; onOpenProject: () => void; onOpenPath: () => void; onOpenDemo: () => void; onContinue: () => void; isOpening: boolean }): ReactElement {
  return <div className="projects-view"><div className="intro-copy"><span className="section-kicker">RESPONSIVE WORKBENCH</span><h1>Voyez le site.<br /><em>Pas une approximation.</em></h1><p>Un serveur loopback temporaire rend le projet complet : liens, démos, assets et scripts locaux fonctionnent dans un environnement cadré.</p></div><div className="import-panel"><div className="import-index">01</div><h2>Ouvrir un dossier</h2><p>Le projet reste sur votre machine. Les connexions externes sont bloquées, à l’exception des polices Google si le projet en utilise.</p><div className="import-actions"><button className="button button--primary" onClick={onOpenProject} disabled={isOpening}>Choisir un projet <Icon name="arrow" /></button><button className="button button--ghost" onClick={onOpenDemo}>Essayer la démo</button></div><form className="path-import" onSubmit={(event) => { event.preventDefault(); onOpenPath() }}><label htmlFor="project-path">Ou coller un chemin local</label><div><input id="project-path" value={projectPath} onChange={(event) => onProjectPathChange(event.target.value)} placeholder="/Users/vous/mon-projet" spellCheck="false" /><button className="button button--secondary" type="submit" disabled={isOpening}>Ouvrir</button></div></form></div><div className="project-section-head"><div><span className="section-kicker">SESSION</span><h2>{project ? 'Projet chargé' : 'Prêt pour un projet réel'}</h2></div>{project && <button className="text-button" onClick={onContinue}>Ouvrir l’inspecteur <Icon name="arrow" size={15} /></button>}</div>{project ? <article className="current-project-card"><div className="project-monogram">{project.name.slice(0, 2).toUpperCase()}</div><div><strong>{project.name}</strong><p>{project.files} fichiers · {project.routes.length} page{project.routes.length > 1 ? 's' : ''} détectée{project.routes.length > 1 ? 's' : ''}</p></div><div className="project-status"><i></i> {project.previewOrigin ? 'Runner prêt' : 'Démo prête'}</div></article> : <div className="empty-flow"><span>↳</span><p>Commencez par le portfolio fourni : les démos internes sont maintenant disponibles dans le sélecteur de pages.</p></div>}</div>
}

function TesterView({ project, device, family, devices: familyDevices, activePath, theme, customWidth, customHeight, onFamily, onDevice, onPath, onTheme, onCustomWidth, onCustomHeight, onRotate, onExternal, selectedIssue, onSelectIssue }: { project: ProjectSnapshot; device: Device; family: DeviceFamily; devices: Device[]; activePath: string; theme: RuntimeTheme; customWidth: string; customHeight: string; onFamily: (family: DeviceFamily) => void; onDevice: (device: Device) => void; onPath: (path: string) => void; onTheme: (theme: RuntimeTheme) => void; onCustomWidth: (value: string) => void; onCustomHeight: (value: string) => void; onRotate: () => void; onExternal: (url: string) => void; selectedIssue: ProjectIssue | null; onSelectIssue: (issue: ProjectIssue) => void }): ReactElement {
  return <div className="tester-view"><div className="page-title"><div><span className="section-kicker">TESTER</span><h1>Rendu navigable</h1><p>{project.previewOrigin ? <>Les pages et démos du projet sont servies via <code>127.0.0.1</code>, avec scripts locaux autorisés et sorties externes bloquées.</> : <>La démo intégrée est autonome et ne contacte aucun service distant.</>}</p></div><div className={`theme-state theme-state--${theme}`}><span>{theme === 'dark' ? 'Sombre détecté' : theme === 'light' ? 'Clair détecté' : 'Thème à confirmer'}</span><code>{activePath}</code></div></div>
    <div className="device-controls"><div className="control-group"><span>Appareil</span><div className="segmented">{deviceFamilies.map((item) => <button key={item.id} className={family === item.id ? 'selected' : ''} onClick={() => onFamily(item.id)}><Icon name={item.icon} size={15} />{item.label}</button>)}</div></div><div className="control-group"><span>Format</span><select aria-label="Format prédéfini" value={device.id === 'custom' ? '' : device.id} onChange={(event) => { const selected = familyDevices.find((candidate) => candidate.id === event.target.value); if (selected) onDevice(selected) }}><option value="">Personnalisé</option>{familyDevices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} — {candidate.width} × {candidate.height}</option>)}</select></div><div className="dimensions"><span>Dimensions</span><label><input value={customWidth} inputMode="numeric" aria-label="Largeur personnalisée" onChange={(event) => onCustomWidth(event.target.value)} /> <small>px</small></label><b>×</b><label><input value={customHeight} inputMode="numeric" aria-label="Hauteur personnalisée" onChange={(event) => onCustomHeight(event.target.value)} /> <small>px</small></label><button className="icon-button icon-button--small" aria-label="Pivoter le viewport" onClick={onRotate}><Icon name="rotate" size={15} /></button></div></div>
    <div className="tester-grid"><section className="preview-zone"><PreviewFrame project={project} device={device} path={activePath} onPathChange={onPath} onThemeChange={onTheme} onExternal={onExternal} /><div className="preview-note"><Icon name="shield" size={15} /> Les popups internes deviennent des pages de preview ; les liens externes restent bloqués.</div></section><aside className="finding-inspector"><div className="inspector-head"><span className="section-kicker">CONSTAT ACTIF</span><span className="coverage-chip">{selectedIssue?.coverage ?? 'manuel'}</span></div>{selectedIssue ? <IssueDetail issue={selectedIssue} onAction={() => onSelectIssue(selectedIssue)} actionLabel="Ouvrir les constats" /> : <p>Aucun constat sélectionné.</p>}</aside></div></div>
}

function IssueDetail({ issue, onAction, actionLabel }: { issue: ProjectIssue; onAction?: () => void; actionLabel?: string }): ReactElement {
  return <div className="issue-detail"><div className="issue-topline"><span className={`severity severity--${issue.severity}`}>{severityLabel(issue)}</span><code>{issue.viewport}</code></div><h3>{issue.title}</h3><p>{issue.description}</p><dl><div><dt>Règle</dt><dd><code>{issue.rule}</code></dd></div>{issue.source && <div><dt>Source</dt><dd><code>{issue.source.file}:{issue.source.line}</code></dd></div>}</dl><div className="proposal"><span>Proposition</span><p>{issue.proposal}</p></div>{onAction && <button className="button button--secondary button--full" onClick={onAction}>{actionLabel}<Icon name="arrow" /></button>}</div>
}

function FindingsView({ issues, selectedIssueId, filter, onFilter, onSelect, onPrepare }: { issues: ProjectIssue[]; selectedIssueId: string | null; filter: 'all' | ProjectIssue['severity']; onFilter: (filter: 'all' | ProjectIssue['severity']) => void; onSelect: (issueId: string) => void; onPrepare: (issue: ProjectIssue) => void }): ReactElement {
  return <div className="findings-view"><div className="page-title"><div><span className="section-kicker">CONTRÔLES</span><h1>Constats contextualisés</h1><p>La liste conserve la différence entre standard vérifiable, heuristique et vérification manuelle.</p></div></div><div className="filter-bar" role="group" aria-label="Filtrer les constats">{([['all', 'Tous'], ['bloquant', 'Bloquants'], ['attention', 'À vérifier'], ['information', 'Informations']] as const).map(([id, label]) => <button key={id} className={filter === id ? 'filter-button filter-button--active' : 'filter-button'} onClick={() => onFilter(id)}>{label}</button>)}</div><div className="findings-layout"><div className="finding-list">{issues.map((issue) => <article key={issue.id} className={selectedIssueId === issue.id ? 'finding-row finding-row--selected' : 'finding-row'}><button onClick={() => onSelect(issue.id)}><span className={`severity-dot severity-dot--${issue.severity}`}></span><div><div className="finding-titleline"><strong>{issue.title}</strong><span>{severityLabel(issue)}</span></div><p>{issue.description}</p><small>{issue.viewport} · {issue.coverage}</small></div></button><button className="row-action" onClick={() => onPrepare(issue)} aria-label={`Préparer la modification pour ${issue.title}`}>Préparer <Icon name="arrow" size={15} /></button></article>)}{issues.length === 0 && <div className="no-findings">Aucun constat pour ce filtre.</div>}</div><aside className="audit-guide"><Icon name="info" size={20} /><h3>Lecture rapide</h3><p><strong>Standard</strong> est automatique ; <strong>heuristique</strong> doit être confirmé dans la preview ; <strong>manuel</strong> dépend du contexte produit.</p></aside></div></div>
}

function ChangesView({ issue, accepted, project, device, path, onToggle }: { issue: ProjectIssue; accepted: boolean; project: ProjectSnapshot; device: Device; path: string; onToggle: () => void }): ReactElement {
  return <div className="changes-view"><div className="page-title"><div><span className="section-kicker">STAGING</span><h1>{issue.title}</h1><p>La correction est explicitement préparée. Elle ne modifie pas le dossier source et aucun faux avant/après n’est affiché.</p></div><span className={accepted ? 'accepted-state' : 'pending-state'}>{accepted ? 'Dans le staging' : 'À décider'}</span></div><div className="change-grid"><section className="visual-review"><div className="review-labels"><span>Rendu source</span><span>Viewport actif</span></div><PreviewFrame project={project} device={device} path={path} compact /><div className="staging-honesty"><Icon name="info" size={17} /><p>L’aperçu de staging apparaîtra ici dès qu’un patch CSS/HTML concret aura été généré. La version précédente simulait deux rendus identiques.</p></div></section><section className="code-review"><div className="code-head"><span>Proposition déterministe</span><code>{issue.rule}</code></div><pre aria-label="Patch de code proposé"><span className="code-comment"># {issue.source ? `${issue.source.file}:${issue.source.line}` : 'Source à confirmer'}</span>{'\n'}<span className="code-remove">- {issue.description}</span>{'\n'}<span className="code-add">+ {issue.proposal}</span></pre><div className="change-actions"><button className={accepted ? 'button button--secondary' : 'button button--primary'} onClick={onToggle}><Icon name={accepted ? 'check' : 'diff'} />{accepted ? 'Retirer du staging' : 'Accepter la proposition'}</button></div></section></div></div>
}

function ThemesView({ project, activePath, detectedTheme }: { project: ProjectSnapshot; activePath: string; detectedTheme: RuntimeTheme }): ReactElement {
  const status = detectedTheme === 'dark' ? { label: 'Thème sombre détecté', candidate: 'Créer une version claire', detail: 'Le site courant utilise déjà une surface sombre. Responsiver ne propose pas de second thème sombre.' } : detectedTheme === 'light' ? { label: 'Thème clair détecté', candidate: 'Créer une version sombre', detail: 'Le site courant est clair. Une génération sombre devra être basée sur ses tokens, jamais sur une inversion visuelle.' } : project.theme.detected === 'dual' ? { label: 'Thèmes clair et sombre détectés', candidate: 'Aucune génération nécessaire', detail: 'Les deux modes sont déjà présents dans le projet. Le rôle de Responsiver est de les vérifier, pas de les dupliquer.' } : { label: 'Thème à analyser', candidate: 'Analyser les couleurs de la page', detail: 'Aucun schéma exploitable n’a été détecté sur la page active.' }
  return <div className="themes-view"><div className="page-title"><div><span className="section-kicker">THÈMES</span><h1>Partir de l’existant</h1><p>Analyse de la page active <code>{activePath}</code>, pas d’un scan global qui confond les démos indépendantes.</p></div></div><section className="theme-decision"><div className="theme-decision-mark">{detectedTheme === 'dark' ? '◐' : detectedTheme === 'light' ? '◑' : '◌'}</div><div><span className="section-kicker">ÉTAT RÉEL</span><h2>{status.label}</h2><p>{status.detail}</p></div><div className="theme-decision-action"><span>Prochaine action</span><strong>{status.candidate}</strong></div></section><section className="tokens-card"><div><div><span className="section-kicker">GARDE-FOUS</span><h2>Avant toute génération</h2></div><span className="coverage-chip">Revue obligatoire</span></div><div className="token-grid"><div><code>color-scheme</code><span>Préférence déclarée</span><b>{project.theme.detected}</b></div><div><code>variables</code><span>Couleurs sémantiques</span><b>À extraire</b></div><div><code>contraste</code><span>Texte et contrôles</span><b>À vérifier</b></div><div><code>assets</code><span>Logos et images</span><b>À préserver</b></div></div></section></div>
}

function ExportView({ project, acceptedIssues, onCopyPatch, onExportReport }: { project: ProjectSnapshot; acceptedIssues: ProjectIssue[]; onCopyPatch: () => void; onExportReport: () => void }): ReactElement {
  return <div className="export-view"><div className="page-title"><div><span className="section-kicker">EXPORT</span><h1>Traçabilité avant tout</h1><p>Le projet source reste intact. Exportez les décisions, les règles et les éléments à vérifier.</p></div></div><section className="result-summary"><div><span>{acceptedIssues.length}</span><p>dans le staging</p></div><div><span>{project.issues.filter((issue) => issue.severity === 'bloquant').length}</span><p>bloquant(s)</p></div><div><span>{project.routes.length}</span><p>pages détectées</p></div><div><span>0</span><p>donnée envoyée</p></div></section><div className="export-actions"><article><Icon name="copy" size={23} /><h2>Copier le patch</h2><p>Les propositions acceptées, avec leur règle et leur source.</p><button className="button button--primary" onClick={onCopyPatch}>Copier <Icon name="copy" /></button></article><article><Icon name="download" size={23} /><h2>Enregistrer le rapport</h2><p>Un JSON local des constats, pages et décisions de staging.</p><button className="button button--secondary" onClick={onExportReport}>Enregistrer <Icon name="download" /></button></article></div></div>
}
