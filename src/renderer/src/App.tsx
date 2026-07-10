import React, { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'

type Destination = 'projects' | 'lab' | 'review' | 'export'
type InspectorTab = 'findings' | 'fixes' | 'theme' | 'conversation'
type DeviceFamily = 'smartphone' | 'tablet' | 'computer'
type LabMode = 'device' | 'compare'
type PreviewMode = 'source' | 'proposal' | 'before-after' | 'staging'
type RuntimeTheme = 'dark' | 'light' | 'unknown'
type ThemeTarget = 'dark' | 'light'
type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

interface ProposalContext {
  kind: 'issue' | 'theme' | 'instruction'
  issueId?: string
  themeTarget?: ThemeTarget
  instruction?: string
}

interface Device {
  id: string
  family: DeviceFamily
  name: string
  width: number
  height: number
}

interface RouteInfo {
  path: string
  label: string
  title?: string
}

interface IssueExtra {
  routePath?: string
  fix?: { confidence?: 'safe' | 'review'; kind?: string }
}

interface ProjectExtra {
  routes: RouteInfo[]
  theme: ProjectSnapshot['theme'] & {
    evidence?: string[]
    variables?: Array<{ name: string; value: string; role: string }>
  }
  capabilities?: {
    interactive?: boolean
    staging?: boolean
    framework?: string | null
    buildRequired?: boolean
  }
  analysis?: { truncated?: boolean; scannedFiles?: number; scannedStyles?: number }
}

interface StagingChange {
  id: string
  title: string
  file: string
  kind: 'html' | 'css' | 'theme' | 'instruction'
  before: string
  after: string
  confidence: 'safe' | 'review'
}

interface StagingSnapshot {
  previewOrigin: string | null
  changes: StagingChange[]
  patch: string
  generatedCss: string
  themeTarget: ThemeTarget | null
  instructions: string[]
  changedFiles: string[]
  createdAt: string
}

interface RuntimeOverflow {
  selector: string
  tag: string
  label: string
  left: number
  right: number
  width: number
}

interface RuntimeAudit {
  path: string
  viewportWidth: number
  viewportHeight: number
  documentWidth: number
  overflowCount: number
  overflows: RuntimeOverflow[]
}

interface ResponsiverApiExtension {
  chooseProjectFile?: () => Promise<ProjectSnapshot | null>
  previewStaging?: (request: { issueIds: string[]; themeTarget: ThemeTarget | null; instructions: string[] }) => Promise<StagingSnapshot>
  clearPreviewStaging?: (expectedOrigin: string) => Promise<void>
  buildStaging?: (request: { issueIds: string[]; themeTarget: ThemeTarget | null; instructions: string[] }) => Promise<StagingSnapshot>
  clearStaging?: () => Promise<void>
  exportPatch?: () => Promise<string | { path: string; files?: string[] } | null>
  exportChangedFiles?: () => Promise<string | { path: string; files?: string[] } | null>
  exportProjectCopy?: () => Promise<string | { path: string; files?: string[] } | null>
  copyText?: (text: string) => Promise<void>
  getPathForFile?: (file: File) => string
}

interface ConversationMessage {
  id: string
  author: 'user' | 'system'
  text: string
}

const families: Array<{ id: DeviceFamily; label: string; icon: string }> = [
  { id: 'smartphone', label: 'Smartphone', icon: 'phone' },
  { id: 'tablet', label: 'Tablette', icon: 'tablet' },
  { id: 'computer', label: 'Ordinateur', icon: 'laptop' }
]

const devices: Device[] = [
  { id: 'iphone-se', family: 'smartphone', name: 'iPhone SE', width: 375, height: 667 },
  { id: 'iphone-15', family: 'smartphone', name: 'iPhone 15', width: 393, height: 852 },
  { id: 'pixel-8', family: 'smartphone', name: 'Pixel 8', width: 412, height: 915 },
  { id: 'galaxy-s24', family: 'smartphone', name: 'Galaxy S24', width: 360, height: 780 },
  { id: 'ipad-mini', family: 'tablet', name: 'iPad mini', width: 768, height: 1024 },
  { id: 'ipad-air', family: 'tablet', name: 'iPad Air', width: 820, height: 1180 },
  { id: 'surface-pro', family: 'tablet', name: 'Surface Pro', width: 912, height: 1368 },
  { id: 'laptop', family: 'computer', name: 'Portable 14\"', width: 1440, height: 900 },
  { id: 'desktop', family: 'computer', name: 'Bureau HD', width: 1920, height: 1080 },
  { id: 'desktop-wide', family: 'computer', name: 'Bureau large', width: 2560, height: 1440 }
]

const compareDevices = [devices[1], devices[5], devices[7]]

const destinations: Array<{ id: Destination; label: string; icon: string }> = [
  { id: 'projects', label: 'Projets', icon: 'projects' },
  { id: 'lab', label: 'Laboratoire', icon: 'ruler' },
  { id: 'review', label: 'Révision', icon: 'changes' },
  { id: 'export', label: 'Exporter', icon: 'export' }
]

const inspectorTabs: Array<{ id: InspectorTab; label: string; icon: string }> = [
  { id: 'findings', label: 'Constats', icon: 'finding' },
  { id: 'fixes', label: 'Correctifs', icon: 'changes' },
  { id: 'theme', label: 'Thème', icon: 'theme' },
  { id: 'conversation', label: 'Conversation', icon: 'chat' }
]

function Icon({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<string, ReactElement> = {
    projects: <><path d="M4 6.5h6l1.6 2H20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><path d="M2 11h20" /></>,
    ruler: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v4M11 5v2M15 5v4M19 5v2" /></>,
    changes: <><path d="M7 4v13M4 7l3-3 3 3" /><path d="M17 20V7m-3 10 3 3 3-3" /></>,
    export: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 18v2h16v-2" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    file: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5" /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M10 5h4" /></>,
    tablet: <rect x="5" y="2" width="14" height="20" rx="2" />,
    laptop: <><rect x="4" y="4" width="16" height="12" rx="1.5" /><path d="M2 20h20" /></>,
    finding: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5m0 3h.01" /></>,
    theme: <><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" /></>,
    chat: <path d="M4 4h16v12H9l-5 4Z" />,
    shield: <path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z" />,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    forward: <><path d="m9 18 6-6-6-6" /><path d="M15 12H4" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10" /><path d="M3 4v6h6" /><path d="M4 13a8 8 0 0 0 14.8 4L21 14" /><path d="M21 20v-6h-6" /></>,
    rotate: <><path d="M17 3v4h-4M7 21v-4h4" /><path d="M20 11a8 8 0 0 0-13.6-5.7L3 7M4 13a8 8 0 0 0 13.6 5.7L21 17" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    compare: <><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5H5V5h5" /></>,
    fullscreen: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></>,
    fullscreenExit: <><path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>
  }
  return <svg {...props}>{paths[name] ?? paths.info}</svg>
}

function Mark(): ReactElement {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
}

function api(): typeof window.responsiver & ResponsiverApiExtension {
  return window.responsiver as typeof window.responsiver & ResponsiverApiExtension
}

function clampDimension(value: string, min: number, max: number, fallback: number): number {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function severityLabel(issue: ProjectIssue): string {
  return issue.severity === 'bloquant' ? 'Bloquant' : issue.severity === 'attention' ? 'À vérifier' : 'Information'
}

function luminance(rgb: string): number | null {
  const match = rgb.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!match) return null
  const [red, green, blue] = match.slice(1).map(Number).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function resultPath(result: string | { path: string } | null): string | null {
  if (!result) return null
  return typeof result === 'string' ? result : result.path
}

function documentPath(value: string): string {
  const path = value.split('#', 1)[0].split('?', 1)[0] || '/'
  return path.endsWith('/') ? `${path}index.html` : path
}

function deviceForIssue(issue: ProjectIssue, current: Device): Pick<Device, 'family' | 'width' | 'height'> | null {
  const exact = issue.viewport.match(/(\d{3,4})\s*[×x]\s*(\d{3,4})/i)
  if (exact) {
    const width = clampDimension(exact[1], 240, 2560, current.width)
    const height = clampDimension(exact[2], 320, 2000, current.height)
    return { family: width < 600 ? 'smartphone' : width < 1100 ? 'tablet' : 'computer', width, height }
  }

  const breakpoint = issue.fix?.breakpoint
  const phoneContext = /téléphone|smartphone|mobile|320\s*[–-]\s*(?:480|640)\s*px/i.test(issue.viewport) || (breakpoint !== undefined && breakpoint <= 768)
  if (phoneContext) {
    const width = breakpoint ? Math.max(320, Math.min(390, breakpoint - 1)) : 390
    return { family: 'smartphone', width, height: 844 }
  }
  if (/tablette|tablet/i.test(issue.viewport)) return { family: 'tablet', width: 820, height: 1180 }
  return null
}

function PreviewFrame({ project, origin, device, path, compact = false, label, focusSelector, themeOverride, resizable = false, onResize, onPathChange, onThemeChange, onExternal, onAudit, onEscape }: {
  project: ProjectSnapshot & ProjectExtra
  origin: string | null
  device: Device
  path: string
  compact?: boolean
  label?: string
  focusSelector?: string | null
  themeOverride?: ThemeTarget | null
  resizable?: boolean
  onResize?: (width: number, height: number) => void
  onPathChange?: (path: string) => void
  onThemeChange?: (theme: RuntimeTheme) => void
  onExternal?: (url: string) => void
  onAudit?: (audit: RuntimeAudit) => void
  onEscape?: () => void
}): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const previousDeviceId = useRef(device.id)
  const [scale, setScale] = useState(compact ? 0.22 : 0.7)
  const [isResizing, setIsResizing] = useState(false)
  const [autoFit, setAutoFit] = useState(true)
  const safeRoutes = project.routes.length ? project.routes : [{ path: project.entryPath ?? '/', label: 'Page principale' }]
  const routeValue = safeRoutes.find((route) => route.path === path)?.path ?? safeRoutes.find((route) => documentPath(route.path) === documentPath(path))?.path ?? safeRoutes[0].path

  useEffect(() => {
    if (isResizing || !autoFit) return
    const stage = stageRef.current
    if (!stage) return
    const update = (): void => {
      const padding = compact ? 28 : 46
      const availableWidth = Math.max(160, stage.clientWidth - padding)
      const availableHeight = Math.max(180, stage.clientHeight - padding)
      setScale(Math.min(1, availableWidth / (device.width + 14), availableHeight / (device.height + 14)))
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [autoFit, compact, device.height, device.width, isResizing])

  useEffect(() => {
    if (device.id === previousDeviceId.current) return
    previousDeviceId.current = device.id
    if (!isResizing && device.id !== 'custom') setAutoFit(true)
  }, [device.id, isResizing])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (origin && event.origin !== origin) return
      const data = event.data as { channel?: string; type?: string; path?: string; background?: string; url?: string } & Partial<RuntimeAudit>
      if (data.channel !== 'responsiver-preview') return
      if (data.type === 'state') {
        if (data.path) onPathChange?.(data.path)
        const value = luminance(data.background ?? '')
        if (value !== null) onThemeChange?.(value < 0.42 ? 'dark' : 'light')
      }
      if (data.type === 'audit' && typeof data.overflowCount === 'number') onAudit?.(data as RuntimeAudit)
      if (data.type === 'external-link' && data.url) onExternal?.(data.url)
      if (data.type === 'escape') onEscape?.()
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [onAudit, onEscape, onExternal, onPathChange, onThemeChange, origin])

  const post = (type: string, payload: Record<string, string> = {}): void => frameRef.current?.contentWindow?.postMessage({ channel: 'responsiver-preview', type, ...payload }, origin ?? '*')
  const source = origin ? `${origin}${path}` : undefined
  const outerWidth = Math.round((device.width + 14) * scale)
  const outerHeight = Math.round((device.height + 14) * scale)

  useEffect(() => {
    const timer = window.setTimeout(() => post(focusSelector ? 'focus-selector' : 'clear-focus', focusSelector ? { selector: focusSelector } : {}), 220)
    return () => window.clearTimeout(timer)
  }, [focusSelector, source])

  useEffect(() => {
    const timer = window.setTimeout(() => post(themeOverride ? 'set-theme-preview' : 'clear-theme-preview', themeOverride ? { theme: themeOverride } : {}), 240)
    return () => window.clearTimeout(timer)
  }, [source, themeOverride])

  function beginResize(edge: ResizeEdge, event: React.PointerEvent<HTMLButtonElement>): void {
    if (!resizable || !onResize) return
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = device.width
    const startHeight = device.height
    const fixedScale = Math.max(scale, 0.01)
    setAutoFit(false)
    setIsResizing(true)

    const move = (pointer: PointerEvent): void => {
      const horizontal = edge.includes('e') ? pointer.clientX - startX : edge.includes('w') ? startX - pointer.clientX : 0
      const vertical = edge.includes('s') ? pointer.clientY - startY : edge.includes('n') ? startY - pointer.clientY : 0
      onResize(
        Math.min(2560, Math.max(240, Math.round(startWidth + horizontal / fixedScale))),
        Math.min(2000, Math.max(320, Math.round(startHeight + vertical / fixedScale)))
      )
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      resizeCleanupRef.current = null
      setIsResizing(false)
    }
    resizeCleanupRef.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  function resizeWithKeyboard(edge: ResizeEdge, event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!onResize || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    setAutoFit(false)
    const step = event.shiftKey ? 20 : 4
    const horizontal = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
    const vertical = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
    const nextWidth = edge === 'n' || edge === 's' ? device.width : Math.min(2560, Math.max(240, device.width + horizontal))
    const nextHeight = edge === 'e' || edge === 'w' ? device.height : Math.min(2000, Math.max(320, device.height + vertical))
    onResize(nextWidth, nextHeight)
  }

  const resizeLabels: Record<ResizeEdge, string> = {
    n: 'Redimensionner depuis le bord supérieur',
    ne: 'Redimensionner depuis le coin supérieur droit',
    e: 'Redimensionner depuis le bord droit',
    se: 'Redimensionner depuis le coin inférieur droit',
    s: 'Redimensionner depuis le bord inférieur',
    sw: 'Redimensionner depuis le coin inférieur gauche',
    w: 'Redimensionner depuis le bord gauche',
    nw: 'Redimensionner depuis le coin supérieur gauche'
  }

  return <section className={`${compact ? 'preview preview--compact' : 'preview'}${isResizing ? ' is-resizing' : ''}`} aria-label={label ?? `Aperçu ${device.name}`}>
    {!compact && <div className="browser-bar">
      <div className="browser-controls">
        <button className="icon-button" onClick={() => post('back')} aria-label="Page précédente"><Icon name="back" size={15} /></button>
        <button className="icon-button" onClick={() => post('forward')} aria-label="Page suivante"><Icon name="forward" size={15} /></button>
        <button className="icon-button" onClick={() => post('reload')} aria-label="Recharger"><Icon name="refresh" size={15} /></button>
      </div>
      <select aria-label="Page du site" value={routeValue} onChange={(event) => { onPathChange?.(event.target.value); post('navigate', { path: event.target.value }) }}>
        {safeRoutes.map((route) => <option value={route.path} key={route.path}>{route.label}</option>)}
      </select>
      <code title={path}>{path}</code>
      <span className="runner-status"><i /> Local</span>
    </div>}
    <div ref={stageRef} className="preview-stage">
      <div className="device-space" style={{ width: outerWidth, height: outerHeight }}>
        <div className="device-shell" style={{ width: device.width, height: device.height, transform: `scale(${scale})` }}>
          <iframe key={origin ?? 'inline-preview'} ref={frameRef} title={`${project.name} — ${device.name}`} width={device.width} height={device.height} sandbox={origin ? 'allow-scripts allow-forms allow-same-origin' : ''} src={source} srcDoc={source ? undefined : project.previewHtml ?? undefined} onLoad={() => window.setTimeout(() => {
            post(focusSelector ? 'focus-selector' : 'clear-focus', focusSelector ? { selector: focusSelector } : {})
            post(themeOverride ? 'set-theme-preview' : 'clear-theme-preview', themeOverride ? { theme: themeOverride } : {})
          }, 90)} />
          {resizable && (Object.keys(resizeLabels) as ResizeEdge[]).map((edge) => <button type="button" key={edge} className={`resize-handle resize-handle--${edge}`} aria-label={resizeLabels[edge]} title={`${resizeLabels[edge]} · flèches, Maj pour 20 px`} onPointerDown={(event) => beginResize(edge, event)} onKeyDown={(event) => resizeWithKeyboard(edge, event)} />)}
        </div>
      </div>
    </div>
    <footer className="preview-meta"><strong>{label ?? device.name}</strong><code>{device.width} × {device.height} CSS px</code>{resizable && <><span><i /> Glissez un bord</span>{!autoFit && <button type="button" onClick={() => setAutoFit(true)}>Ajuster à la zone</button>}</>}</footer>
  </section>
}

export default function App(): ReactElement {
  const [destination, setDestination] = useState<Destination>('projects')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('findings')
  const [project, setProject] = useState<(ProjectSnapshot & ProjectExtra) | null>(null)
  const [staging, setStaging] = useState<StagingSnapshot | null>(null)
  const [proposal, setProposal] = useState<StagingSnapshot | null>(null)
  const [proposalContext, setProposalContext] = useState<ProposalContext | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('source')
  const [labMode, setLabMode] = useState<LabMode>('device')
  const [stageFullscreen, setStageFullscreen] = useState(false)
  const [family, setFamily] = useState<DeviceFamily>('smartphone')
  const [deviceId, setDeviceId] = useState('iphone-15')
  const [width, setWidth] = useState('393')
  const [height, setHeight] = useState('852')
  const [activePath, setActivePath] = useState('/index.html')
  const [runtimeTheme, setRuntimeTheme] = useState<RuntimeTheme>('unknown')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([])
  const [showAllIssues, setShowAllIssues] = useState(false)
  const [themeTarget, setThemeTarget] = useState<ThemeTarget | null>(null)
  const [previewThemeTarget, setPreviewThemeTarget] = useState<ThemeTarget | null>(null)
  const [instructions, setInstructions] = useState<string[]>([])
  const [messages, setMessages] = useState<ConversationMessage[]>([{ id: 'welcome', author: 'system', text: 'Décrivez un ajustement précis. Responsiver applique uniquement les règles locales qu’il sait interpréter et vous montre le résultat avant export.' }])
  const [draft, setDraft] = useState('')
  const [runtimeAudit, setRuntimeAudit] = useState<RuntimeAudit | null>(null)
  const [projectPath, setProjectPath] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const noticeTimer = useRef<number | null>(null)
  const previewSequence = useRef(0)
  const draftRevision = useRef(0)
  const activeProjectId = useRef<string | null>(null)

  const currentDevice = useMemo<Device>(() => {
    if (deviceId === 'custom') return { id: 'custom', family, name: 'Format personnalisé', width: clampDimension(width, 240, 2560, 393), height: clampDimension(height, 320, 2000, 852) }
    return devices.find((device) => device.id === deviceId) ?? devices[1]
  }, [deviceId, family, height, width])
  const familyDevices = devices.filter((device) => device.family === family)
  const routeIssues = useMemo(() => {
    if (!project) return []
    const currentPath = documentPath(activePath)
    return project.issues.filter((issue) => {
      const routePath = (issue as ProjectIssue & IssueExtra).routePath
      return !routePath || documentPath(routePath) === currentPath
    })
  }, [activePath, project])
  const inspectorIssues = showAllIssues ? project?.issues ?? [] : routeIssues
  const scopedProject = useMemo(() => project ? { ...project, issues: inspectorIssues } : null, [inspectorIssues, project])
  const selectedIssue = inspectorIssues.find((issue) => issue.id === selectedIssueId) ?? inspectorIssues[0] ?? null
  const detectedTheme: RuntimeTheme = runtimeTheme !== 'unknown' ? runtimeTheme : project?.theme.detected === 'dark' ? 'dark' : project?.theme.detected === 'light' ? 'light' : 'unknown'
  const activeOrigin = previewMode === 'staging' && staging?.previewOrigin
    ? staging.previewOrigin
    : (previewMode === 'proposal' || previewMode === 'before-after') && proposal?.previewOrigin
      ? proposal.previewOrigin
      : project?.previewOrigin ?? null
  const focusedSelector = proposalContext?.kind === 'issue'
    ? ((project?.issues.find((issue) => issue.id === proposalContext.issueId) as (ProjectIssue & IssueExtra) | undefined)?.fix?.selector ?? null)
    : null
  const nativeThemeTarget = previewMode === 'source' && proposalContext?.kind === 'theme' && previewThemeTarget && project && (
    project.theme.detected === 'dual' || project.theme.detected === previewThemeTarget || detectedTheme === previewThemeTarget || (previewThemeTarget === 'dark' ? project.theme.hasDark : project.theme.hasLight)
  ) ? previewThemeTarget : null

  useEffect(() => {
    if (!inspectorIssues.some((issue) => issue.id === selectedIssueId)) setSelectedIssueId(inspectorIssues[0]?.id ?? null)
  }, [inspectorIssues, selectedIssueId])

  useEffect(() => {
    if (!stageFullscreen) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setStageFullscreen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [stageFullscreen])

  useEffect(() => {
    if (destination !== 'lab') setStageFullscreen(false)
  }, [destination])

  function flash(message: string): void {
    setNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4300)
  }

  function applyProject(snapshot: ProjectSnapshot): void {
    previewSequence.current += 1
    draftRevision.current += 1
    const next = snapshot as ProjectSnapshot & ProjectExtra
    activeProjectId.current = next.id
    setProject(next)
    setStaging(null)
    setProposal(null)
    setProposalContext(null)
    setPreviewMode('source')
    setActivePath(next.entryPath ?? next.routes[0]?.path ?? '/')
    setRuntimeTheme(next.theme.detected === 'dark' ? 'dark' : next.theme.detected === 'light' ? 'light' : 'unknown')
    setSelectedIssueId(next.issues[0]?.id ?? null)
    setSelectedIssueIds([])
    setShowAllIssues(false)
    setThemeTarget(null)
    setPreviewThemeTarget(null)
    setInstructions([])
    setMessages([{ id: 'welcome', author: 'system', text: 'Décrivez un ajustement précis. Responsiver applique uniquement les règles locales qu’il sait interpréter et vous montre le résultat avant export.' }])
    setDraft('')
    setRuntimeAudit(null)
    setInspectorTab('findings')
    setLabMode('device')
    setStageFullscreen(false)
    setPreviewBusy(false)
    setDestination('lab')
  }

  async function openWith(action: () => Promise<ProjectSnapshot | null>, success: string): Promise<void> {
    setBusy(true)
    try {
      const snapshot = await action()
      if (snapshot) {
        applyProject(snapshot)
        const next = snapshot as ProjectSnapshot & ProjectExtra
        flash(next.capabilities?.buildRequired ? 'Projet source détecté : pour un rendu fidèle, ouvrez son fichier HTML compilé dans dist ou out.' : success)
      }
    } catch { flash('Impossible d’ouvrir ce projet. Vérifiez le chemin et ses droits d’accès.') } finally { setBusy(false) }
  }

  async function openPath(path = projectPath): Promise<void> {
    const value = path.trim()
    if (!value) { flash('Indiquez un fichier ou un dossier local.'); return }
    await openWith(() => window.responsiver.openProjectPath(value), 'Projet analysé et servi localement.')
  }

  function invalidateStaging(): void {
    draftRevision.current += 1
    if (!staging) return
    setStaging(null)
    if (previewMode === 'staging') setPreviewMode('source')
    void api().clearStaging?.().catch(() => undefined)
  }

  async function requestProposal(request: { issueIds: string[]; themeTarget: ThemeTarget | null; instructions: string[] }, context: ProposalContext, mode: PreviewMode): Promise<StagingSnapshot | null> {
    if (!project) return null
    if (!api().previewStaging) { flash('La prévisualisation temporaire est disponible dans l’application desktop.'); return null }
    const sequence = ++previewSequence.current
    setProposalContext(context)
    setProposal(null)
    setPreviewBusy(true)
    try {
      const result = await api().previewStaging!(request)
      if (sequence !== previewSequence.current) {
        if (result.previewOrigin) await api().clearPreviewStaging?.(result.previewOrigin).catch(() => undefined)
        return null
      }
      setProposal(result)
      setProposalContext(context)
      if (context.kind === 'theme' && context.themeTarget) setPreviewThemeTarget(context.themeTarget)
      setPreviewMode(mode)
      return result
    } catch {
      if (sequence === previewSequence.current) flash('La proposition n’a pas pu être prévisualisée. Aucun choix n’a été validé.')
      return null
    } finally {
      if (sequence === previewSequence.current) setPreviewBusy(false)
    }
  }

  async function discardProposal(message = 'La proposition a été écartée. Aucun choix n’a été ajouté au staging.', returnMode: PreviewMode = 'source'): Promise<void> {
    const expectedOrigin = proposal?.previewOrigin ?? null
    previewSequence.current += 1
    setPreviewBusy(false)
    setProposal(null)
    setProposalContext(null)
    setPreviewThemeTarget(null)
    setPreviewMode(returnMode)
    try {
      if (expectedOrigin) await api().clearPreviewStaging?.(expectedOrigin)
    } catch { /* le prochain aperçu remplacera le serveur temporaire */ }
    flash(message)
  }

  async function previewIssue(issue: ProjectIssue): Promise<void> {
    const extra = issue as ProjectIssue & IssueExtra
    setSelectedIssueId(issue.id)
    if (extra.routePath) setActivePath(extra.routePath)
    setLabMode('device')
    setPreviewThemeTarget(null)
    const issueDevice = deviceForIssue(issue, currentDevice)
    if (issueDevice) {
      setFamily(issueDevice.family)
      setWidth(String(issueDevice.width))
      setHeight(String(issueDevice.height))
      setDeviceId('custom')
    }
    if (!extra.fix || extra.fix.kind === 'manual') {
      const expectedOrigin = proposal?.previewOrigin ?? null
      previewSequence.current += 1
      setPreviewBusy(false)
      setProposalContext({ kind: 'issue', issueId: issue.id })
      setProposal(null)
      setPreviewMode('source')
      if (expectedOrigin) void api().clearPreviewStaging?.(expectedOrigin).catch(() => undefined)
      flash('Ce constat demande une vérification manuelle : la source concernée est affichée sans faux correctif.')
      return
    }
    const result = await requestProposal({ issueIds: [issue.id], themeTarget: null, instructions: [] }, { kind: 'issue', issueId: issue.id }, 'before-after')
    if (result) flash('Avant et après sont synchronisés sur la zone concernée. Validez ou écartez ce correctif depuis le constat.')
  }

  async function previewTheme(target: ThemeTarget): Promise<void> {
    if (!project) return
    const alreadyPresent = project.theme.detected === 'dual' || project.theme.detected === target || detectedTheme === target || (target === 'dark' ? project.theme.hasDark : project.theme.hasLight)
    if (alreadyPresent) {
      const expectedOrigin = proposal?.previewOrigin ?? null
      previewSequence.current += 1
      setPreviewBusy(false)
      setPreviewThemeTarget(target)
      setProposal(null)
      setProposalContext({ kind: 'theme', themeTarget: target })
      setPreviewMode('source')
      if (expectedOrigin) void api().clearPreviewStaging?.(expectedOrigin).catch(() => undefined)
      flash(`Le thème ${target === 'dark' ? 'sombre' : 'clair'} natif est affiché depuis la source. Aucun correctif n’a été généré ni ajouté au plan.`)
      return
    }
    setPreviewThemeTarget(target)
    const result = await requestProposal({ issueIds: [], themeTarget: target, instructions: [] }, { kind: 'theme', themeTarget: target }, 'proposal')
    if (result) flash(`Variante ${target === 'dark' ? 'sombre' : 'claire'} affichée en aperçu, pas encore validée.`)
  }

  function acceptProposal(): void {
    if (!proposal || !proposalContext || !proposal.changes.length) return
    invalidateStaging()
    if (proposalContext.kind === 'issue' && proposalContext.issueId) {
      setSelectedIssueIds((current) => current.includes(proposalContext.issueId!) ? current : [...current, proposalContext.issueId!])
      flash('Correctif validé et ajouté au plan. Construisez le staging depuis Correctifs quand vous êtes prêt.')
    }
    if (proposalContext.kind === 'theme' && proposalContext.themeTarget) {
      setThemeTarget(proposalContext.themeTarget)
      flash('Variante validée et ajoutée au plan. Elle reste sans effet sur les exports avant construction du staging.')
    }
    if (proposalContext.kind === 'instruction' && proposalContext.instruction) {
      setInstructions((current) => current.includes(proposalContext.instruction!) ? current : [...current, proposalContext.instruction!])
      setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: 'Ajustement validé et ajouté au plan de correctifs. Le projet source reste intact.' }])
      flash('Ajustement validé. Construisez le staging depuis Correctifs pour le rendre exportable.')
    }
  }

  function rejectProposal(): void {
    const removesIssue = Boolean(proposalContext?.kind === 'issue' && proposalContext.issueId && selectedIssueIds.includes(proposalContext.issueId))
    const removesTheme = Boolean(proposalContext?.kind === 'theme' && proposalContext.themeTarget === themeTarget)
    const removesInstruction = Boolean(proposalContext?.kind === 'instruction' && proposalContext.instruction && instructions.includes(proposalContext.instruction))
    const changesDraft = removesIssue || removesTheme || removesInstruction
    const keepStaging = Boolean(staging && !changesDraft)
    if (removesIssue && proposalContext?.issueId) setSelectedIssueIds((current) => current.filter((id) => id !== proposalContext.issueId))
    if (removesTheme) setThemeTarget(null)
    if (removesInstruction && proposalContext?.instruction) setInstructions((current) => current.filter((value) => value !== proposalContext.instruction))
    if (changesDraft) invalidateStaging()
    void discardProposal(changesDraft ? 'La proposition et sa validation ont été retirées du plan.' : undefined, keepStaging ? 'staging' : 'source')
  }

  async function buildStaging(nextInstructions = instructions): Promise<void> {
    if (!project) return
    if (!api().buildStaging) { flash('Le moteur de staging sera disponible dans l’application desktop.'); return }
    const requestedRevision = draftRevision.current
    const requestedProjectId = project.id
    setBusy(true)
    try {
      const result = await api().buildStaging!({ issueIds: selectedIssueIds, themeTarget, instructions: nextInstructions })
      if (requestedRevision !== draftRevision.current || requestedProjectId !== activeProjectId.current) {
        await api().clearStaging?.().catch(() => undefined)
        flash('Le plan a changé pendant la construction. Le staging obsolète a été écarté ; relancez la construction.')
        return
      }
      setStaging(result)
      setProposal(null)
      setProposalContext(null)
      setPreviewThemeTarget(null)
      setPreviewMode('staging')
      flash(`${result.changes.length} modification${result.changes.length > 1 ? 's' : ''} préparée${result.changes.length > 1 ? 's' : ''} sans toucher aux sources.`)
    } catch { flash('Le staging n’a pas pu être construit. Aucun fichier source n’a été modifié.') } finally { setBusy(false) }
  }

  async function clearStaging(): Promise<void> {
    try { await api().clearStaging?.() } catch { /* le serveur sera remplacé à la prochaine construction */ }
    setStaging(null)
    setPreviewMode('source')
    flash('Le staging a été écarté. Les sources restent intactes.')
  }

  async function submitInstruction(event: FormEvent): Promise<void> {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return
    setMessages((current) => [...current, { id: `u-${Date.now()}`, author: 'user', text: value }])
    setDraft('')
    if (!api().previewStaging) {
      setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: 'La prévisualisation locale de cette instruction est disponible dans l’application desktop.' }])
      return
    }
    const result = await requestProposal({ issueIds: [], themeTarget: null, instructions: [value] }, { kind: 'instruction', instruction: value }, 'proposal')
    const recognized = result?.changes.some((change) => change.kind === 'instruction') ?? false
    setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: recognized ? 'Ajustement interprété et affiché en proposition. Validez-le explicitement ci-dessous avant de construire le staging.' : 'Je n’ai pas reconnu de règle locale sûre. Reformulez avec une couleur, un espacement, un rayon ou une taille de texte précise.' }])
  }

  async function copyPatch(): Promise<void> {
    const text = staging?.patch || selectedIssueIds.map((id) => project?.issues.find((issue) => issue.id === id)?.proposal).filter(Boolean).join('\n\n') || '# Aucun changement préparé.\n'
    try {
      if (api().copyText) await api().copyText!(text)
      else await navigator.clipboard.writeText(text)
      flash('Le patch a été copié.')
    } catch { flash('La copie est indisponible dans ce contexte.') }
  }

  async function exportAction(kind: 'patch' | 'changed' | 'copy' | 'report'): Promise<void> {
    if (!project) return
    setBusy(true)
    try {
      let result: string | { path: string } | null = null
      if (kind === 'patch' && api().exportPatch) result = await api().exportPatch!()
      else if (kind === 'changed' && api().exportChangedFiles) result = await api().exportChangedFiles!()
      else if (kind === 'copy' && api().exportProjectCopy) result = await api().exportProjectCopy!()
      else result = await window.responsiver.exportReport(project, selectedIssueIds)
      const path = resultPath(result)
      if (path) flash(`Export enregistré : ${path}`)
    } catch { flash('L’export n’a pas pu être finalisé.') } finally { setBusy(false) }
  }

  function go(next: Destination): void {
    if (next !== 'projects' && !project) { setDestination('projects'); flash('Ouvrez d’abord un projet.'); return }
    setDestination(next)
  }

  function selectFamily(next: DeviceFamily): void {
    const first = devices.find((device) => device.family === next)!
    setFamily(next)
    setDeviceId(first.id)
    setWidth(String(first.width))
    setHeight(String(first.height))
  }

  function selectDevice(id: string): void {
    setDeviceId(id)
    const device = devices.find((candidate) => candidate.id === id)
    if (device) { setWidth(String(device.width)); setHeight(String(device.height)) }
  }

  function toggleAcceptedIssue(id: string): void {
    invalidateStaging()
    setSelectedIssueIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function removeInstruction(value: string): void {
    invalidateStaging()
    setInstructions((current) => current.filter((instruction) => instruction !== value))
  }

  function removeTheme(): void {
    invalidateStaging()
    setThemeTarget(null)
  }

  function changePreviewPath(path: string): void {
    if (path !== activePath && previewMode === 'source') setRuntimeTheme('unknown')
    setActivePath(path)
  }

  const counts = project ? {
    blockers: project.issues.filter((issue) => issue.severity === 'bloquant').length,
    issues: project.issues.length,
    selected: selectedIssueIds.length + instructions.length + (themeTarget ? 1 : 0),
    changes: staging?.changes.length ?? 0
  } : { blockers: 0, issues: 0, selected: 0, changes: 0 }

  return <div className="app-shell">
    <aside className="nav-rail" aria-label="Navigation principale">
      <button className="brand" onClick={() => go('projects')} aria-label="Responsiver — Projets"><Mark /><span><strong>Responsiver</strong><small>Responsive workbench</small></span></button>
      <nav>{destinations.map((item) => <button key={item.id} className={destination === item.id ? 'nav-link is-active' : 'nav-link'} onClick={() => go(item.id)} aria-current={destination === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'review' && counts.changes > 0 && <b>{counts.changes}</b>}</button>)}</nav>
      <div className="rail-foot"><span><Icon name="shield" size={15} /> Traitement local</span><small>v0.4 · open source</small></div>
    </aside>

    <main className="app-main">
      <header className="titlebar">
        <div className="project-identity"><span>{project ? 'Projet actif' : 'Espace local'}</span><strong>{project?.name ?? 'Aucun projet ouvert'}</strong>{project && <code title={project.root}>{project.root}</code>}</div>
        <div className="title-actions">
          {project && <span className="origin-indicator"><i /> Runner local</span>}
          <button className="button button--quiet" onClick={() => openWith(() => window.responsiver.chooseProject(), 'Projet analysé et servi localement.')} disabled={busy}><Icon name="folder" /> Ouvrir</button>
        </div>
      </header>

      {destination === 'projects' && <ProjectsView project={project} projectPath={projectPath} busy={busy} onPath={setProjectPath} onOpenFolder={() => openWith(() => window.responsiver.chooseProject(), 'Projet analysé et servi localement.')} onOpenFile={() => openWith(() => api().chooseProjectFile ? api().chooseProjectFile!() : window.responsiver.chooseProject(), 'Fichier analysé et servi localement.')} onOpenPath={() => openPath()} onDemo={() => openWith(() => window.responsiver.openDemoProject(), 'Démonstration locale prête.')} onContinue={() => go('lab')} onDrop={(file) => { const path = api().getPathForFile?.(file); if (path) void openPath(path); else flash('Déposez le projet dans l’application desktop.') }} />}

      {destination === 'lab' && project && <div className="workbench">
        <div className="command-bar">
          <div className="mode-switch" role="group" aria-label="Disposition de l’aperçu"><button className={labMode === 'device' ? 'is-active' : ''} onClick={() => setLabMode('device')} aria-pressed={labMode === 'device'}><Icon name="ruler" /> Appareil</button><button className={labMode === 'compare' ? 'is-active' : ''} onClick={() => { setLabMode('compare'); if (previewMode === 'before-after') setPreviewMode('proposal') }} aria-pressed={labMode === 'compare'}><Icon name="compare" /> 3 écrans</button></div>
          <div className="command-divider" aria-hidden="true" />
          <div className="version-switch" role="group" aria-label="État du projet affiché">
            <button className={previewMode === 'source' ? 'is-active' : ''} onClick={() => setPreviewMode('source')} aria-pressed={previewMode === 'source'}>Source</button>
            <button className={previewMode === 'proposal' ? 'is-active' : ''} onClick={() => proposal && setPreviewMode('proposal')} disabled={!proposal} aria-pressed={previewMode === 'proposal'}>Proposition {proposal && <b>{proposal.changes.length}</b>}</button>
            <button className={previewMode === 'before-after' ? 'is-active' : ''} onClick={() => { if (proposal) { setLabMode('device'); setPreviewMode('before-after') } }} disabled={!proposal} aria-pressed={previewMode === 'before-after'}>Avant / Après</button>
            <button className={previewMode === 'staging' ? 'is-active' : ''} onClick={() => staging ? setPreviewMode('staging') : flash('Construisez le staging depuis les correctifs validés.')} disabled={!staging} aria-pressed={previewMode === 'staging'}>Staging {staging && <b>{staging.changes.length}</b>}</button>
          </div>
          <div className="command-spacer" />
          {labMode === 'device' && <DeviceControls family={family} devices={familyDevices} selectedId={deviceId} width={width} height={height} onFamily={selectFamily} onDevice={selectDevice} onWidth={(value) => { setWidth(value); setDeviceId('custom') }} onHeight={(value) => { setHeight(value); setDeviceId('custom') }} onRotate={() => { setWidth(height); setHeight(width); setDeviceId('custom') }} />}
        </div>

        <div className="lab-grid">
          <div className={stageFullscreen ? 'stage-column is-fullscreen' : 'stage-column'}>
            <div className="stage-toolbar">
              <span><i className={proposal && previewMode !== 'source' && previewMode !== 'staging' ? 'status-dot status-dot--proposal' : 'status-dot status-dot--ok'} />{previewMode === 'before-after' ? 'Comparaison du correctif' : previewMode === 'proposal' ? 'Proposition temporaire' : previewMode === 'staging' ? 'Staging exportable' : 'Source du projet'}</span>
              <small>{previewMode === 'before-after' ? 'Deux rendus synchronisés' : labMode === 'device' ? 'Bords redimensionnables' : 'Trois familles d’appareils'}</small>
              <button className="stage-fullscreen" onClick={() => setStageFullscreen((current) => !current)} aria-label={stageFullscreen ? 'Quitter le plein écran de la prévisualisation' : 'Afficher la prévisualisation en plein écran'} aria-pressed={stageFullscreen}><Icon name={stageFullscreen ? 'fullscreenExit' : 'fullscreen'} size={15} /><span>{stageFullscreen ? 'Réduire' : 'Plein écran'}</span></button>
            </div>
            <div className="stage-canvas">
              {previewBusy && <div className="preview-loading" role="status"><span className="loading-mark" /><strong>Préparation de la proposition…</strong></div>}
              {labMode === 'device' && previewMode === 'before-after' && proposal ? <div className="before-after-grid" aria-label="Comparaison avant et après le correctif">
                <div className="comparison-pane"><header><span>Avant</span><strong>Source</strong></header><PreviewFrame compact project={project} origin={project.previewOrigin} device={currentDevice} path={activePath} label="Avant — Source" focusSelector={focusedSelector} onPathChange={changePreviewPath} onThemeChange={setRuntimeTheme} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} /></div>
                <div className="comparison-pane comparison-pane--after"><header><span>Après</span><strong>Proposition non validée</strong></header><PreviewFrame compact project={project} origin={proposal.previewOrigin} device={currentDevice} path={activePath} label="Après — Proposition" focusSelector={focusedSelector} onPathChange={changePreviewPath} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} /></div>
              </div> : labMode === 'device' ? <PreviewFrame project={project} origin={activeOrigin} device={currentDevice} path={activePath} focusSelector={focusedSelector} themeOverride={nativeThemeTarget} resizable onResize={(nextWidth, nextHeight) => { setWidth(String(nextWidth)); setHeight(String(nextHeight)); setDeviceId('custom') }} onPathChange={changePreviewPath} onThemeChange={activeOrigin === project.previewOrigin ? setRuntimeTheme : undefined} onAudit={setRuntimeAudit} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} /> : <div className="comparison-grid">{compareDevices.map((device) => <PreviewFrame key={device.id} project={project} origin={activeOrigin} device={device} path={activePath} compact focusSelector={focusedSelector} themeOverride={nativeThemeTarget} label={device.family === 'smartphone' ? 'Smartphone' : device.family === 'tablet' ? 'Tablette' : 'Ordinateur'} onPathChange={changePreviewPath} onThemeChange={activeOrigin === project.previewOrigin ? setRuntimeTheme : undefined} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} />)}</div>}
            </div>
          </div>
          {scopedProject && <Inspector project={scopedProject} activeIssueCount={routeIssues.length} totalIssueCount={project.issues.length} showAllIssues={showAllIssues} onShowAllIssues={setShowAllIssues} tab={inspectorTab} onTab={setInspectorTab} selectedIssue={selectedIssue} selectedIds={selectedIssueIds} onPreviewIssue={(issue) => void previewIssue(issue)} onToggleIssue={toggleAcceptedIssue} detectedTheme={detectedTheme} themeTarget={themeTarget} previewThemeTarget={previewThemeTarget} onPreviewTheme={(target) => void previewTheme(target)} onRemoveTheme={removeTheme} proposal={proposal} proposalContext={proposalContext} previewBusy={previewBusy} staging={staging} runtimeAudit={runtimeAudit} instructions={instructions} onRemoveInstruction={removeInstruction} messages={messages} draft={draft} onDraft={setDraft} onSubmit={submitInstruction} busy={busy} onAcceptProposal={acceptProposal} onRejectProposal={rejectProposal} onBuild={() => void buildStaging()} onClear={() => void clearStaging()} />}
        </div>
        <footer className="activity-bar"><span><i className="status-dot status-dot--ok" /> {project.routes.length} page{project.routes.length > 1 ? 's' : ''}</span>{project.capabilities?.buildRequired ? <span className="activity-alert" title="Responsiver n’exécute jamais les scripts arbitraires d’un projet sans consentement. Ouvrez plutôt le fichier HTML généré dans dist ou out.">Sources à compiler · choisir dist/out</span> : <span className={counts.blockers ? 'activity-alert' : ''}>{counts.blockers} bloquant{counts.blockers > 1 ? 's' : ''}</span>}<span>{runtimeAudit ? `${runtimeAudit.overflowCount} débordement${runtimeAudit.overflowCount > 1 ? 's' : ''} à ${runtimeAudit.viewportWidth}px` : 'Audit visuel en attente'}</span><span className="activity-end" title="Seules les ressources locales et Google Fonts HTTPS sont autorisées dans la preview."><Icon name="shield" size={13} /> Réseau contrôlé</span></footer>
      </div>}

      {destination === 'review' && project && <ReviewView project={project} staging={staging} sourceOrigin={project.previewOrigin} path={activePath} device={currentDevice} acceptedCount={counts.selected} onBuild={() => void buildStaging()} onClear={() => void clearStaging()} onCopy={() => void copyPatch()} busy={busy} />}
      {destination === 'export' && project && <ExportView project={project} staging={staging} selectedCount={counts.selected} busy={busy} onCopy={() => void copyPatch()} onExport={exportAction} onReview={() => go('review')} />}
    </main>
    {notice && <div className="toast" role="status"><Icon name="info" size={16} /> <span>{notice}</span><button aria-label="Fermer" onClick={() => setNotice(null)}><Icon name="close" size={14} /></button></div>}
  </div>
}

function ProjectsView({ project, projectPath, busy, onPath, onOpenFolder, onOpenFile, onOpenPath, onDemo, onContinue, onDrop }: {
  project: (ProjectSnapshot & ProjectExtra) | null
  projectPath: string
  busy: boolean
  onPath: (value: string) => void
  onOpenFolder: () => void
  onOpenFile: () => void
  onOpenPath: () => void
  onDemo: () => void
  onContinue: () => void
  onDrop: (file: File) => void
}): ReactElement {
  const [dragging, setDragging] = useState(false)
  return <div className="projects-page">
    <header className="page-head"><div><span className="overline">Bibliothèque locale</span><h1>Projets</h1><p>Ouvrez un dossier complet ou un fichier HTML. Responsiver analyse les sources et lance un aperçu navigable sur votre machine.</p></div><button className="button button--primary" onClick={onOpenFolder} disabled={busy}><Icon name="plus" /> Nouveau projet</button></header>
    <section className={dragging ? 'drop-zone is-dragging' : 'drop-zone'} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) onDrop(file) }}>
      <div className="drop-mark"><Mark /></div><div><h2>Déposez votre projet ici</h2><p>Dossier, fichier HTML ou projet web local. Aucun envoi distant.</p></div><div className="drop-actions"><button className="button button--primary" onClick={onOpenFolder} disabled={busy}><Icon name="folder" /> Choisir un dossier</button><button className="button button--secondary" onClick={onOpenFile} disabled={busy}><Icon name="file" /> Choisir un fichier</button></div>
    </section>
    <form className="path-bar" onSubmit={(event) => { event.preventDefault(); onOpenPath() }}><label htmlFor="project-path">Chemin local</label><input id="project-path" value={projectPath} onChange={(event) => onPath(event.target.value)} placeholder="/Users/vous/Sites/mon-projet" spellCheck={false} /><button className="button button--secondary" disabled={busy}>Ouvrir</button></form>
    <section className="project-list"><div className="section-heading"><div><span className="overline">Session</span><h2>{project ? 'Projet actif' : 'Commencer sans configuration'}</h2></div><button className="text-button" onClick={onDemo}>Ouvrir la démo locale <Icon name="arrow" size={15} /></button></div>
      {project ? <article className="project-row"><div className="project-symbol">{project.name.slice(0, 2).toUpperCase()}</div><div className="project-copy"><strong>{project.name}</strong><span>{project.kind} · {project.files} fichiers · {project.routes.length} pages</span>{project.capabilities?.buildRequired && <span className="project-warning">Sources à compiler : ouvrez l’entrée générée dans dist ou out pour tester le rendu final.</span>}<code>{project.root}</code></div><div className="project-metrics"><span><b>{project.issues.length}</b> constats</span><span><b>{project.theme.detected === 'dual' ? '2' : '1'}</b> thème{project.theme.detected === 'dual' ? 's' : ''}</span></div><button className="button button--primary" onClick={onContinue}>Laboratoire <Icon name="arrow" /></button></article> : <div className="empty-project"><Icon name="shield" /><p>La démo utilise le même runner local que vos projets : navigation, scripts et analyse sont réellement exercés.</p></div>}
    </section>
  </div>
}

function DeviceControls({ family, devices: choices, selectedId, width, height, onFamily, onDevice, onWidth, onHeight, onRotate }: {
  family: DeviceFamily
  devices: Device[]
  selectedId: string
  width: string
  height: string
  onFamily: (family: DeviceFamily) => void
  onDevice: (id: string) => void
  onWidth: (value: string) => void
  onHeight: (value: string) => void
  onRotate: () => void
}): ReactElement {
  return <div className="device-controls">
    <div className="family-switch" role="group" aria-label="Catégorie d’appareil">{families.map((item) => <button key={item.id} className={family === item.id ? 'is-active' : ''} onClick={() => onFamily(item.id)} title={item.label}><Icon name={item.icon} size={16} /><span>{item.label}</span></button>)}</div>
    <label className="model-select"><span>Modèle</span><select value={selectedId === 'custom' ? 'custom' : selectedId} onChange={(event) => onDevice(event.target.value)}>{choices.map((device) => <option key={device.id} value={device.id}>{device.name} — {device.width}×{device.height}</option>)}<option value="custom">Dimensions libres</option></select></label>
    <div className="dimension-fields"><label><span>Largeur</span><input inputMode="numeric" value={width} onChange={(event) => onWidth(event.target.value)} onBlur={(event) => onWidth(String(clampDimension(event.target.value, 240, 2560, 393)))} /><small>px</small></label><b aria-hidden="true">×</b><label><span>Hauteur</span><input inputMode="numeric" value={height} onChange={(event) => onHeight(event.target.value)} onBlur={(event) => onHeight(String(clampDimension(event.target.value, 320, 2000, 852)))} /><small>px</small></label><button className="icon-button rotate-button" onClick={onRotate} aria-label="Pivoter les dimensions"><Icon name="rotate" size={16} /></button></div>
  </div>
}

function Inspector({ project, activeIssueCount, totalIssueCount, showAllIssues, onShowAllIssues, tab, onTab, selectedIssue, selectedIds, onPreviewIssue, onToggleIssue, detectedTheme, themeTarget, previewThemeTarget, onPreviewTheme, onRemoveTheme, proposal, proposalContext, previewBusy, staging, runtimeAudit, instructions, onRemoveInstruction, messages, draft, onDraft, onSubmit, busy, onAcceptProposal, onRejectProposal, onBuild, onClear }: {
  project: ProjectSnapshot & ProjectExtra
  activeIssueCount: number
  totalIssueCount: number
  showAllIssues: boolean
  onShowAllIssues: (show: boolean) => void
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  selectedIssue: ProjectIssue | null
  selectedIds: string[]
  onPreviewIssue: (issue: ProjectIssue) => void
  onToggleIssue: (id: string) => void
  detectedTheme: RuntimeTheme
  themeTarget: ThemeTarget | null
  previewThemeTarget: ThemeTarget | null
  onPreviewTheme: (target: ThemeTarget) => void
  onRemoveTheme: () => void
  proposal: StagingSnapshot | null
  proposalContext: ProposalContext | null
  previewBusy: boolean
  staging: StagingSnapshot | null
  runtimeAudit: RuntimeAudit | null
  instructions: string[]
  onRemoveInstruction: (instruction: string) => void
  messages: ConversationMessage[]
  draft: string
  onDraft: (value: string) => void
  onSubmit: (event: FormEvent) => void
  busy: boolean
  onAcceptProposal: () => void
  onRejectProposal: () => void
  onBuild: () => void
  onClear: () => void
}): ReactElement {
  const issueExtra = selectedIssue as (ProjectIssue & IssueExtra) | null
  const acceptedCount = selectedIds.length + instructions.length + (themeTarget ? 1 : 0)
  const selectedProposal = proposalContext?.kind === 'issue' && proposalContext.issueId === selectedIssue?.id ? proposal : null
  const selectedAccepted = selectedIssue ? selectedIds.includes(selectedIssue.id) : false
  const selectedActionable = Boolean(issueExtra?.fix && issueExtra.fix.kind !== 'manual')
  const instructionProposal = proposalContext?.kind === 'instruction' ? proposal : null
  return <aside className="inspector" aria-label="Inspecteur">
    <div className="inspector-tabs" role="tablist" aria-label="Outils d’analyse">{inspectorTabs.map((item) => <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} key={item.id} onClick={() => onTab(item.id)} title={item.label}><Icon name={item.icon} size={16} /><span>{item.label}</span>{item.id === 'findings' && <b>{project.issues.length}</b>}</button>)}</div>
    <div className="inspector-content">
      {tab === 'findings' && <><div className="inspector-heading"><div><span className="overline">Analyse déterministe</span><h2>Constats</h2></div>{runtimeAudit && <span className="live-chip"><i /> Direct</span>}</div>
        <div className="issue-scope" role="group" aria-label="Portée des constats"><button className={!showAllIssues ? 'is-active' : ''} onClick={() => onShowAllIssues(false)}>Page active <b>{activeIssueCount}</b></button><button className={showAllIssues ? 'is-active' : ''} onClick={() => onShowAllIssues(true)}>Toutes les pages <b>{totalIssueCount}</b></button></div>
        {runtimeAudit && runtimeAudit.overflowCount > 0 && <div className="runtime-alert"><Icon name="ruler" size={16} /><div><strong>{runtimeAudit.overflowCount} débordement{runtimeAudit.overflowCount > 1 ? 's' : ''} visible{runtimeAudit.overflowCount > 1 ? 's' : ''}</strong><span>Mesuré à {runtimeAudit.viewportWidth}px sur la page active.</span></div></div>}
        <div className="issue-list">{project.issues.length ? project.issues.map((issue) => {
          const accepted = selectedIds.includes(issue.id)
          return <button key={issue.id} className={`${selectedIssue?.id === issue.id ? 'issue-item is-active' : 'issue-item'}${accepted ? ' is-accepted' : ''}`} onClick={() => onPreviewIssue(issue)} disabled={busy} aria-label={`${issue.title} — ouvrir la page et ${((issue as ProjectIssue & IssueExtra).fix?.kind === 'manual' || !(issue as ProjectIssue & IssueExtra).fix) ? 'localiser le constat' : 'prévisualiser l’avant et l’après'}`}><i className={`severity-dot severity-dot--${issue.severity}`} /><span><strong>{issue.title}</strong><small>{(issue as ProjectIssue & IssueExtra).routePath ?? issue.viewport}</small></span><em>{accepted ? 'Retenu' : severityLabel(issue)}</em></button>
        }) : <div className="empty-panel"><Icon name="check" /><strong>Aucun motif connu détecté</strong><span>Continuez la vérification visuelle sur les trois familles d’appareils.</span></div>}</div>
        {selectedIssue && <article className="issue-detail"><header><span className={`severity severity--${selectedIssue.severity}`}>{severityLabel(selectedIssue)}</span><code>{selectedIssue.rule}</code></header><h3>{selectedIssue.title}</h3><p>{selectedIssue.description}</p><dl><div><dt>Source</dt><dd>{selectedIssue.source ? <code>{selectedIssue.source.file}:{selectedIssue.source.line}</code> : 'Mesure à l’exécution'}</dd></div><div><dt>Proposition</dt><dd>{selectedIssue.proposal}</dd></div></dl>
          {!selectedActionable ? <div className="manual-review"><Icon name="info" size={15} /><span>Ce point ne possède pas de transformation automatique sûre. Responsiver vous amène à la page concernée sans simuler un résultat.</span></div> : previewBusy && proposalContext?.issueId === selectedIssue.id ? <div className="proposal-pending" role="status"><span className="loading-mark" /> Préparation de l’avant / après…</div> : selectedProposal ? <ProposalDecision title="Correctif isolé" accepted={selectedAccepted} changeCount={selectedProposal.changes.length} disabled={busy} onAccept={onAcceptProposal} onReject={onRejectProposal} /> : <button className="button button--primary button--full" onClick={() => onPreviewIssue(selectedIssue)} disabled={busy}><Icon name="compare" /> Voir l’avant / après</button>}
        </article>}
      </>}
      {tab === 'fixes' && <><div className="inspector-heading"><div><span className="overline">Choix explicitement validés</span><h2>Correctifs</h2></div><strong className="count-badge">{acceptedCount}</strong></div><div className="fix-list">{acceptedCount ? <>
        {project.issues.filter((issue) => selectedIds.includes(issue.id)).map((issue) => <article key={issue.id}><span className={(issue as ProjectIssue & IssueExtra).fix?.confidence === 'safe' ? 'confidence confidence--safe' : 'confidence'}>{(issue as ProjectIssue & IssueExtra).fix?.confidence === 'safe' ? 'Automatique' : 'À réviser'}</span><strong>{issue.title}</strong><code>{issue.source?.file ?? issue.rule}</code><button onClick={() => onToggleIssue(issue.id)} disabled={busy} aria-label={`Retirer ${issue.title}`}><Icon name="close" size={14} /></button></article>)}
        {themeTarget && <article><span className="confidence confidence--safe">Thème</span><strong>Variante {themeTarget === 'dark' ? 'sombre' : 'claire'}</strong><code>Palette complémentaire validée</code><button onClick={onRemoveTheme} disabled={busy} aria-label={`Retirer la variante ${themeTarget === 'dark' ? 'sombre' : 'claire'}`}><Icon name="close" size={14} /></button></article>}
        {instructions.map((instruction) => <article key={instruction}><span className="confidence">Instruction</span><strong>{instruction}</strong><code>Règle locale déterministe</code><button onClick={() => onRemoveInstruction(instruction)} disabled={busy} aria-label={`Retirer l’instruction ${instruction}`}><Icon name="close" size={14} /></button></article>)}
      </> : <div className="empty-panel"><Icon name="changes" /><strong>Aucun choix validé</strong><span>Prévisualisez un constat, un thème ou une instruction, puis validez sa proposition.</span></div>}</div>
        {staging && <div className="staging-summary"><span><i /> Staging prêt</span><strong>{staging.changes.length} changements · {staging.changedFiles.length} fichiers</strong><button className="text-button" onClick={onClear} disabled={busy}>Écarter</button></div>}
        <button className="button button--primary button--full inspector-action" onClick={onBuild} disabled={busy || previewBusy || !acceptedCount}>{busy ? 'Construction…' : staging ? 'Reconstruire le staging' : 'Construire le staging'} <Icon name="arrow" /></button>
      </>}
      {tab === 'theme' && <ThemePanel project={project} detectedTheme={detectedTheme} acceptedTarget={themeTarget} previewTarget={previewThemeTarget} proposal={proposalContext?.kind === 'theme' ? proposal : null} busy={previewBusy} disabled={busy} onPreview={onPreviewTheme} onAccept={onAcceptProposal} onReject={onRejectProposal} onRemoveAccepted={onRemoveTheme} />}
      {tab === 'conversation' && <><div className="inspector-heading"><div><span className="overline">Ajustements locaux</span><h2>Conversation</h2></div><span className="rule-chip">Sans IA</span></div><div className="conversation">{messages.map((message) => <div className={`message message--${message.author}`} key={message.id}><span>{message.author === 'user' ? 'Vous' : 'Responsiver'}</span><p>{message.text}</p></div>)}</div>{previewBusy && proposalContext?.kind === 'instruction' && <div className="proposal-pending" role="status"><span className="loading-mark" /> Interprétation locale…</div>}{instructionProposal && proposalContext?.instruction && <ProposalDecision title="Ajustement prévisualisé" accepted={instructions.includes(proposalContext.instruction)} changeCount={instructionProposal.changes.filter((change) => change.kind === 'instruction').length} disabled={busy} onAccept={onAcceptProposal} onReject={onRejectProposal} />}<form className="prompt-form" onSubmit={onSubmit}><label htmlFor="instruction">Nouvel ajustement</label><textarea id="instruction" value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Ex. Réduis les arrondis et utilise #b94d32 comme couleur d’accent." rows={4} /><div><small>Couleur · espacement · rayon · texte · navigation</small><button className="button button--primary" disabled={busy || previewBusy || !draft.trim()}>Prévisualiser</button></div></form></>}
    </div>
  </aside>
}

function ProposalDecision({ title, accepted, changeCount, disabled = false, onAccept, onReject }: { title: string; accepted: boolean; changeCount: number; disabled?: boolean; onAccept: () => void; onReject: () => void }): ReactElement {
  return <div className={accepted ? 'proposal-decision is-accepted' : 'proposal-decision'}><header><span><i />{accepted ? 'Validé dans le plan' : 'Aperçu non validé'}</span><b>{changeCount} changement{changeCount > 1 ? 's' : ''}</b></header><strong>{title}</strong><p>{accepted ? 'Ce choix sera inclus lors de la prochaine construction du staging.' : 'La proposition reste temporaire et ne peut pas être exportée tant que vous ne la validez pas.'}</p><div><button className="button button--quiet" onClick={onReject} disabled={disabled}>Écarter</button><button className="button button--primary" onClick={onAccept} disabled={disabled || accepted || !changeCount}><Icon name={accepted ? 'check' : 'plus'} size={15} />{accepted ? 'Validé' : 'Valider'}</button></div></div>
}

function ThemePanel({ project, detectedTheme, acceptedTarget, previewTarget, proposal, busy, disabled, onPreview, onAccept, onReject, onRemoveAccepted }: { project: ProjectSnapshot & ProjectExtra; detectedTheme: RuntimeTheme; acceptedTarget: ThemeTarget | null; previewTarget: ThemeTarget | null; proposal: StagingSnapshot | null; busy: boolean; disabled: boolean; onPreview: (target: ThemeTarget) => void; onAccept: () => void; onReject: () => void; onRemoveAccepted: () => void }): ReactElement {
  const hasDark = project.theme.hasDark || project.theme.detected === 'dual' || detectedTheme === 'dark'
  const hasLight = project.theme.hasLight || project.theme.detected === 'dual' || detectedTheme === 'light'
  const recommendation = hasDark && !hasLight ? 'light' : hasLight && !hasDark ? 'dark' : detectedTheme === 'dark' ? 'light' : 'dark'
  const dual = hasDark && hasLight
  return <><div className="inspector-heading"><div><span className="overline">Palette complémentaire</span><h2>Thème</h2></div><span className={`theme-chip theme-chip--${dual ? 'dual' : detectedTheme}`}>{dual ? 'Clair + sombre' : detectedTheme === 'dark' ? 'Sombre' : detectedTheme === 'light' ? 'Clair' : 'À confirmer'}</span></div>
    <div className="theme-diagnosis"><div className={`theme-swatch theme-swatch--${detectedTheme}`}><span>Aa</span></div><div><strong>{dual ? 'Deux thèmes déjà présents' : `Thème ${detectedTheme === 'dark' ? 'sombre' : detectedTheme === 'light' ? 'clair' : 'non classé'} détecté`}</strong><p>{dual ? 'Responsiver n’ajoute aucune variante identique.' : `Cliquez sur la variante ${recommendation === 'light' ? 'claire' : 'sombre'} pour la voir immédiatement, avant toute validation.`}</p></div></div>
    <fieldset className="theme-options"><legend>Prévisualiser une variante</legend><label className={`${previewTarget === 'light' ? 'is-selected' : ''}${hasLight ? ' is-existing' : ''}`}><input type="radio" name="theme-preview" checked={previewTarget === 'light'} onChange={() => onPreview('light')} disabled={busy || disabled} /><span className="palette-preview palette-preview--light"><i /><i /><i /></span><span><strong>Clair {hasLight && <em>Déjà présent</em>}</strong><small>{hasLight ? 'Afficher la variante native, sans la dupliquer' : 'Fond minéral, texte graphite'}</small></span></label><label className={`${previewTarget === 'dark' ? 'is-selected' : ''}${hasDark ? ' is-existing' : ''}`}><input type="radio" name="theme-preview" checked={previewTarget === 'dark'} onChange={() => onPreview('dark')} disabled={busy || disabled} /><span className="palette-preview palette-preview--dark"><i /><i /><i /></span><span><strong>Sombre {hasDark && <em>Déjà présent</em>}</strong><small>{hasDark ? 'Afficher la variante native, sans la dupliquer' : 'Graphite profond, surfaces étagées'}</small></span></label></fieldset>
    {busy && <div className="proposal-pending" role="status"><span className="loading-mark" /> Génération locale de la palette…</div>}
    {proposal && previewTarget && <ProposalDecision title={`Variante ${previewTarget === 'dark' ? 'sombre' : 'claire'}`} accepted={acceptedTarget === previewTarget} changeCount={proposal.changes.length} disabled={disabled} onAccept={onAccept} onReject={onReject} />}
    {!proposal && previewTarget && (previewTarget === 'dark' ? hasDark : hasLight) && <div className="native-theme-preview"><Icon name="check" size={15} /><span><strong>Aperçu natif {previewTarget === 'dark' ? 'sombre' : 'clair'}</strong><small>Cette variante existe déjà : elle est simulée dans la source et ne demande aucune validation.</small></span></div>}
    {acceptedTarget && (!proposal || previewTarget !== acceptedTarget) && <div className="accepted-theme"><Icon name="check" size={15} /><span><strong>Variante {acceptedTarget === 'dark' ? 'sombre' : 'claire'} validée</strong><small>Elle sera incluse au prochain staging.</small></span><button className="text-button" onClick={onRemoveAccepted} disabled={disabled}>Retirer</button></div>}
    <div className="theme-note"><Icon name="info" size={15} /><p>Les rôles sémantiques et contrastes sont recalculés localement. Aucune inversion globale des couleurs.</p></div>
  </>
}

function ReviewView({ project, staging, sourceOrigin, path, device, acceptedCount, onBuild, onClear, onCopy, busy }: {
  project: ProjectSnapshot & ProjectExtra
  staging: StagingSnapshot | null
  sourceOrigin: string | null
  path: string
  device: Device
  acceptedCount: number
  onBuild: () => void
  onClear: () => void
  onCopy: () => void
  busy: boolean
}): ReactElement {
  return <div className="standard-page"><header className="page-head"><div><span className="overline">Validation avant export</span><h1>Révision</h1><p>Comparez la source et le staging. Le dossier original reste intact jusqu’à votre export explicite.</p></div>{staging && <div className="review-actions"><button className="button button--quiet" onClick={onClear}>Écarter</button><button className="button button--primary" onClick={onCopy}><Icon name="copy" /> Copier le patch</button></div>}</header>
    {!staging ? <section className="review-empty"><Icon name="changes" size={28} /><h2>Aucun staging à réviser</h2><p>Validez des propositions dans le laboratoire, puis construisez leur version exportable.</p><button className="button button--primary" onClick={onBuild} disabled={busy || !acceptedCount}>Construire avec {acceptedCount} choix validé{acceptedCount > 1 ? 's' : ''}</button></section> : <>
      <section className="review-summary"><div><span>Modifications</span><strong>{staging.changes.length}</strong></div><div><span>Fichiers touchés</span><strong>{staging.changedFiles.length}</strong></div><div><span>Thème généré</span><strong>{staging.themeTarget ? staging.themeTarget === 'dark' ? 'Sombre' : 'Clair' : 'Non'}</strong></div><div><span>Sources modifiées</span><strong>0</strong></div></section>
      <section className="visual-comparison"><div><span>Source</span><PreviewFrame compact project={project} origin={sourceOrigin} device={device} path={path} /></div><div><span>Staging</span><PreviewFrame compact project={project} origin={staging.previewOrigin} device={device} path={path} /></div></section>
      <section className="diff-panel"><header><div><span className="overline">Patch unifié</span><strong>{staging.changedFiles.join(' · ') || 'responsiver-theme.css'}</strong></div><button className="icon-button" onClick={onCopy} aria-label="Copier le patch"><Icon name="copy" size={15} /></button></header><pre>{staging.patch || staging.generatedCss || 'Aucun contenu textuel.'}</pre></section>
    </>}
  </div>
}

function ExportView({ project, staging, selectedCount, busy, onCopy, onExport, onReview }: {
  project: ProjectSnapshot & ProjectExtra
  staging: StagingSnapshot | null
  selectedCount: number
  busy: boolean
  onCopy: () => void
  onExport: (kind: 'patch' | 'changed' | 'copy' | 'report') => void
  onReview: () => void
}): ReactElement {
  return <div className="standard-page"><header className="page-head"><div><span className="overline">Sortie maîtrisée</span><h1>Exporter</h1><p>Choisissez le niveau de livraison. Responsiver n’écrit jamais silencieusement dans le projet d’origine.</p></div><span className={staging ? 'export-readiness is-ready' : 'export-readiness'}><i />{staging ? 'Staging prêt' : 'Staging requis'}</span></header>
    <section className="export-ledger"><header><div><span className="overline">Contenu de livraison</span><h2>{project.name}</h2></div><button className="text-button" onClick={onReview}>Réviser le staging <Icon name="arrow" size={15} /></button></header><div><span><b>{staging?.changes.length ?? 0}</b> modifications</span><span><b>{staging?.changedFiles.length ?? 0}</b> fichiers</span><span><b>{selectedCount}</b> règles retenues</span><span><b>{staging?.themeTarget ? '1' : '0'}</b> variante de thème</span></div></section>
    <section className="export-grid"><article><div className="export-icon"><Icon name="copy" /></div><span className="overline">Presse-papiers</span><h2>Copier le patch</h2><p>Pour relire ou appliquer le diff avec votre outil habituel.</p><button className="button button--secondary button--full" onClick={onCopy} disabled={!staging || busy}>Copier</button></article><article><div className="export-icon"><Icon name="file" /></div><span className="overline">Livraison minimale</span><h2>Fichiers modifiés</h2><p>Un dossier ne contenant que les fichiers réellement transformés.</p><button className="button button--secondary button--full" onClick={() => onExport('changed')} disabled={!staging || busy}>Choisir la destination</button></article><article><div className="export-icon"><Icon name="projects" /></div><span className="overline">Version complète</span><h2>Copie du projet</h2><p>Le projet entier avec le staging appliqué, sans altérer l’original.</p><button className="button button--primary button--full" onClick={() => onExport('copy')} disabled={!staging || busy}>Exporter une copie</button></article></section>
    <footer className="export-foot"><div><Icon name="shield" /><span><strong>Traçabilité locale</strong><small>Le patch, la liste des règles et le rapport restent lisibles.</small></span></div><div><button className="text-button" onClick={() => onExport('report')} disabled={busy}>Exporter le rapport d’analyse</button><button className="text-button" onClick={() => onExport('patch')} disabled={!staging || busy}>Enregistrer le fichier .patch</button></div></footer>
  </div>
}
