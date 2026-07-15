import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'

import type { CascadeTrace, MatrixObservation, MatrixRunProgress, MatrixRunResult, MatrixStateId, ProjectPreparationProgress, RecentProjectSummary, RemoteAuditResult, RemoteInspectorSelection, RemotePageState, RemoteViewport, RuntimeAudit, StagingVerificationResult, VisualElementSnapshot, VisualGestureCommit } from '../../shared/contracts'
import { classifyProjectIssue, consolidateProjectIssues, deterministicVisualTarget, isExpressEligibleIssue, type FindingGroup, type FindingPolicy } from '../../shared/finding-policy'
import { frameworkSupportFor } from '../../shared/framework-support'
import { authorizeVisualEditor, compileVisualEditCss, createVisualEditOperation, visualEditOperationKey, type VisualEditOperation, type VisualEditProperty, type VisualEditScope } from '../../shared/visual-editor'
import {
  mergeVisualGestureOperations,
  rebaseVisualGestureChangesAfterRejection,
  rollbackVisualGestureOperations,
  sanitizeVisualGestureCommit,
  visualGestureOperationChanges,
  visualGestureOperations,
  type VisualGestureOperationChange
} from '../../shared/visual-manipulation'
import LocalAssistant from './LocalAssistant'
import OnboardingTour from './OnboardingTour'
import PreviewZoomControls from './PreviewZoomControls'
import RemotePreview from './RemotePreview'
import { isOnboardingHidden, persistOnboardingHidden } from './onboarding'
import { clampPreviewScale, stepPreviewScale, wheelPreviewScale } from './preview-zoom'

const CodeWorkspace = React.lazy(() => import('./CodeWorkspace'))
const MatrixView = React.lazy(() => import('./MatrixView'))

type Destination = 'projects' | 'lab' | 'matrix' | 'visual' | 'code' | 'review' | 'export'
type InspectorTab = 'findings' | 'fixes' | 'theme' | 'conversation'
type DeviceFamily = 'smartphone' | 'tablet' | 'computer'
type LabMode = 'device' | 'compare'
type PreviewMode = 'source' | 'proposal' | 'before-after' | 'staging'
type RuntimeTheme = 'dark' | 'light' | 'unknown'
type ThemeTarget = 'dark' | 'light'
type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type VisualEditorMode = 'compose' | 'select' | 'interact' | 'compare'
type InspectorLocation = 'lab' | 'code' | null
type InspectorPhase = 'idle' | 'starting' | 'active'

interface ProposalContext {
  kind: 'issue' | 'batch' | 'theme' | 'instruction'
  issueId?: string
  issueIds?: string[]
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
  sourcePath?: string
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
  kind: 'html' | 'css' | 'theme' | 'instruction' | 'visual'
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
  recognizedInstructions?: string[]
  ignoredInstructions?: string[]
  visualEdits?: VisualEditOperation[]
  changedFiles: string[]
  outcomes?: Array<{
    proposalId: string
    findingIds: string[]
    kind: 'issue' | 'theme' | 'instruction' | 'visual'
    status: 'applied' | 'skipped' | 'conflict'
    changeIds: string[]
    reason: string
  }>
  createdAt: string
}

interface ProposalItemSummary {
  id: string
  title: string
  status: 'applied' | 'skipped' | 'conflict'
  reason: string
  changes: StagingChange[]
}

interface RuntimeRenderState {
  status: 'ready' | 'empty'
  settled: boolean
  failureCount: number
  firstFailure: string | null
}

interface ResponsiverApiExtension {
  chooseProjectFile?: () => Promise<ProjectSnapshot | null>
  previewStaging?: (request: { issueIds: string[]; themeTarget: ThemeTarget | null; instructions: string[]; visualEdits?: VisualEditOperation[] }) => Promise<StagingSnapshot>
  clearPreviewStaging?: (expectedOrigin: string) => Promise<void>
  buildStaging?: (request: { issueIds: string[]; themeTarget: ThemeTarget | null; instructions: string[]; visualEdits?: VisualEditOperation[] }) => Promise<StagingSnapshot>
  clearStaging?: () => Promise<void>
  exportPatch?: () => Promise<string | { path: string; files?: string[] } | null>
  exportChangedFiles?: () => Promise<string | { path: string; files?: string[] } | null>
  exportProjectCopy?: () => Promise<string | { path: string; files?: string[] } | null>
  copyText?: (text: string) => Promise<void>
  getPathForFile?: (file: File) => string
  listRecentProjects?: () => Promise<RecentProjectSummary[]>
  openRecentProject?: (id: string) => Promise<ProjectSnapshot>
  forgetRecentProject?: (id: string) => Promise<RecentProjectSummary[]>
  onProjectPreparation?: (listener: (progress: ProjectPreparationProgress) => void) => () => void
  applyStagingToSource?: () => Promise<unknown>
  undoLastStagingApply?: () => Promise<unknown>
}

interface ChangePlanRequest {
  issueIds: string[]
  themeTarget: ThemeTarget | null
  instructions: string[]
  visualEdits?: VisualEditOperation[]
}

interface VisualEditHistory {
  past: VisualEditOperation[][]
  present: VisualEditOperation[]
  future: VisualEditOperation[][]
}

interface VisualGestureCheckpoint {
  changes: VisualGestureOperationChange[]
  revision: number
}

interface ExpressVerificationState {
  issueIds: string[]
  token: string | null
  result: StagingVerificationResult
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

const compareDevices = [devices[1], devices[4], devices[7]]
const auditDevices: Device[] = [
  devices[1],
  devices[4],
  { id: 'tablet-landscape-audit', family: 'tablet', name: 'Tablette paysage', width: 1024, height: 768 },
  devices[7]
]

const destinations: Array<{ id: Destination; label: string; icon: string }> = [
  { id: 'projects', label: 'Projets', icon: 'projects' },
  { id: 'lab', label: 'Laboratoire', icon: 'ruler' },
  { id: 'matrix', label: 'Matrice', icon: 'matrix' },
  { id: 'visual', label: 'Atelier visuel', icon: 'cursor' },
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'review', label: 'Révision', icon: 'changes' },
  { id: 'export', label: 'Exporter', icon: 'export' }
]

const inspectorTabs: Array<{ id: InspectorTab; label: string; icon: string }> = [
  { id: 'findings', label: 'Constats', icon: 'finding' },
  { id: 'fixes', label: 'Correctifs', icon: 'changes' },
  { id: 'theme', label: 'Thème', icon: 'theme' },
  { id: 'conversation', label: 'Assistant', icon: 'chat' }
]

function Icon({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<string, ReactElement> = {
    projects: <><path d="M4 6.5h6l1.6 2H20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><path d="M2 11h20" /></>,
    ruler: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 5v4M11 5v2M15 5v4M19 5v2" /></>,
    matrix: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
    changes: <><path d="M7 4v13M4 7l3-3 3 3" /><path d="M17 20V7m-3 10 3 3 3-3" /></>,
    export: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 18v2h16v-2" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    file: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5" /></>,
    code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3" /><path d="m14 5-4 14" /></>,
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
    swap: <><path d="M4 8h14" /><path d="m15 5 3 3-3 3" /><path d="M20 16H6" /><path d="m9 13-3 3 3 3" /></>,
    panelCollapse: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M16 9l-3 3 3 3" /></>,
    panelExpand: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M13 9l3 3-3 3" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    compare: <><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5H5V5h5" /></>,
    fullscreen: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></>,
    fullscreenExit: <><path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.35 2.35 0 1 1 3.4 2.1c-.8.42-1.2.92-1.2 1.9M12 16.5h.01" /></>,
    cursor: <><path d="m5 3 14 8-6 2-3 6Z" /><path d="m13 13 5 5" /></>,
    compose: <><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M12 2v5m0-5-2 2m2-2 2 2M12 22v-5m0 5-2-2m2 2 2-2M2 12h5m-5 0 2-2m-2 2 2 2M22 12h-5m5 0-2-2m2 2-2 2" /></>,
    undo: <><path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6" /></>,
    redo: <><path d="m15 7 5 5-5 5" /><path d="M20 12h-9a6 6 0 0 0-6 6" /></>,
    play: <path d="m8 5 11 7-11 7Z" />
  }
  return <svg {...props}>{paths[name] ?? paths.info}</svg>
}

function Mark(): ReactElement {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
}

function PageGuide({ page, onOpenChange }: { page: 'code' | 'visual'; onOpenChange: (open: boolean) => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleId = `page-guide-${page}`

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      onOpenChange(false)
      window.requestAnimationFrame(() => trigger.current?.focus())
    }
    const closeOutside = (event: PointerEvent): void => {
      if (root.current?.contains(event.target as Node)) return
      setOpen(false)
      onOpenChange(false)
    }
    window.addEventListener('keydown', closeOnEscape, true)
    window.addEventListener('pointerdown', closeOutside, true)
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true)
      window.removeEventListener('pointerdown', closeOutside, true)
    }
  }, [onOpenChange, open])

  useEffect(() => () => onOpenChange(false), [onOpenChange])

  const visual = page === 'visual'
  return <div className="page-guide" ref={root}>
    <button ref={trigger} className="page-guide-trigger" type="button" onClick={() => { const next = !open; onOpenChange(next); setOpen(next) }} aria-label={`Guide de la page ${visual ? 'Atelier visuel' : 'Code'}`} aria-expanded={open} aria-controls={`${titleId}-panel`} title="Guide rapide"><Icon name="help" size={17} /></button>
    {open && <section id={`${titleId}-panel`} className="page-guide-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header><div><span className="overline">Guide rapide</span><h2 id={titleId}>{visual ? 'Atelier visuel' : 'Espace Code'}</h2></div><button className="icon-button" type="button" onClick={() => { onOpenChange(false); setOpen(false); window.requestAnimationFrame(() => trigger.current?.focus()) }} aria-label="Fermer le guide"><Icon name="close" size={14} /></button></header>
      {visual ? <ol>
        <li><b>Composez</b><span>La page est figée : glissez un bloc, redimensionnez-le avec ses poignées ou ajustez ses propriétés.</span></li>
        <li><b>Définissez la portée</b><span>Choisissez l’écran et la page auxquels le réglage doit s’appliquer.</span></li>
        <li><b>Testez puis comparez</b><span>Réactivez le vrai site dans Tester, ouvrez l’avant/après, puis appliquez explicitement.</span></li>
      </ol> : <ol>
        <li><b>Choisissez un fichier</b><span>L’éditeur conserve d’abord chaque modification dans un overlay en mémoire.</span></li>
        <li><b>Contrôlez le rendu</b><span>La preview se met à jour pour le CSS ; utilisez Inspecter pour relier rendu et DOM.</span></li>
        <li><b>Validez explicitement</b><span>Consultez le diff, puis appliquez uniquement le fichier souhaité au projet.</span></li>
      </ol>}
      <footer><Icon name="cursor" size={14} /><span><b>Zoom précis</b> : Ctrl + molette, pincement du pavé tactile ou commandes sous la preview. Le viewport CSS reste inchangé.</span></footer>
    </section>}
  </div>
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

function findingPolicyBadge(policy: FindingPolicy): { label: 'Sûr' | 'Avant-après' | 'À relire' | 'Manuel'; tone: string } {
  if (policy.action === 'advisory') return { label: 'Manuel', tone: 'manual' }
  if (policy.verification === 'visual-before-after' || policy.verification === 'both') return { label: 'Avant-après', tone: 'visual' }
  if (policy.action === 'auto-safe') return { label: 'Sûr', tone: 'safe' }
  return { label: 'À relire', tone: 'review' }
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

function runtimeIssueViewportKeys(issue: ProjectIssue): string[] {
  if (issue.evidence?.measurements?.runtime !== true) return []
  const encoded = issue.evidence.measurements.affectedViewports
  const parsed = typeof encoded === 'string'
    ? [...encoded.matchAll(/(\d+)\s*[×x]\s*(\d+)/g)].map((match) => `${Number(match[1])}x${Number(match[2])}`)
    : []
  const fallback = `${issue.evidence.viewport.width}x${issue.evidence.viewport.height}`
  return [...new Set(parsed.length ? parsed : [fallback])]
}

function previewRoute(value: string): string {
  try {
    const route = new URL(value, 'http://responsiver.local')
    return `${route.pathname}${route.search}${route.hash}`
  } catch {
    return value
  }
}

const runtimeAuditRules = new Set<RuntimeAudit['findings'][number]['rule']>([
  'responsive.missing-viewport',
  'layout.viewport-overflow',
  'layout.clipped-content',
  'layout.truncated-text',
  'layout.navigation-wrap',
  'layout.element-overlap',
  'layout.density-hierarchy',
  'layout.useful-area-overflow',
  'typography.disproportionate',
  'typography.mobile-readability',
  'interaction.small-target',
  'layout.fixed-obstruction',
  'media.image-error',
  'media.image-distortion',
  'accessibility.low-contrast',
  'runtime.page-error'
])

function cleanRuntimeText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) : ''
}

function actionError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const detail = error.message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420)
  return detail || fallback
}

function cleanRuntimeNumber(value: unknown, minimum: number, maximum: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

export function sanitizeRuntimeAudit(value: unknown, device: Device): RuntimeAudit | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (source.version !== 2 || !Array.isArray(source.findings)) return null
  const routeValue = cleanRuntimeText(source.route ?? source.path, 4_096)
  const route = routeValue.startsWith('/') && !routeValue.startsWith('//') ? routeValue : '/'
  const viewport = { width: device.width, height: device.height, mobile: device.family !== 'computer' }
  const findings: RuntimeAudit['findings'] = []
  for (const entryValue of source.findings.slice(0, 120)) {
    if (!entryValue || typeof entryValue !== 'object') continue
    const entry = entryValue as Record<string, unknown>
    if (typeof entry.rule !== 'string' || !runtimeAuditRules.has(entry.rule as RuntimeAudit['findings'][number]['rule'])) continue
    const selector = cleanRuntimeText(entry.selector, 320)
    if (!selector) continue
    const rectValue = entry.rect && typeof entry.rect === 'object' ? entry.rect as Record<string, unknown> : {}
    const rule = entry.rule as RuntimeAudit['findings'][number]['rule']
    findings.push({
      id: `sanitized-${findings.length}-${cleanRuntimeText(entry.id, 100) || rule}`,
      rule,
      severity: entry.severity === 'error' ? 'error' : 'warning',
      title: cleanRuntimeText(entry.title, 180) || rule,
      description: cleanRuntimeText(entry.description, 420),
      proposal: cleanRuntimeText(entry.proposal, 420),
      confidence: cleanRuntimeNumber(entry.confidence, 0, 1),
      selector,
      tag: cleanRuntimeText(entry.tag, 40),
      label: cleanRuntimeText(entry.label, 100),
      rect: {
        x: cleanRuntimeNumber(rectValue.x, -100_000, 100_000),
        y: cleanRuntimeNumber(rectValue.y, -100_000, 100_000),
        width: cleanRuntimeNumber(rectValue.width, 0, 100_000),
        height: cleanRuntimeNumber(rectValue.height, 0, 100_000)
      },
      route,
      viewport
    })
  }
  const overflowFindings = findings.filter((finding) => finding.rule === 'layout.viewport-overflow')
  return {
    version: 2,
    path: route,
    route,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewport,
    documentWidth: cleanRuntimeNumber(source.documentWidth, 0, 100_000, viewport.width),
    overflowCount: overflowFindings.length,
    overflows: [],
    findingCount: findings.length,
    findings,
    inspectedNodes: Math.round(cleanRuntimeNumber(source.inspectedNodes, 0, 2_500)),
    truncated: source.truncated === true || (source.findings as unknown[]).length > 120,
    limits: { maxNodes: 2_500, maxFindings: 120, maxFindingsPerRule: 24, maxLegacyOverflows: 12, maxContrastChecks: 600 }
  }
}

function deviceForIssue(issue: ProjectIssue, current: Device): Pick<Device, 'family' | 'width' | 'height'> | null {
  const measured = issue.evidence?.viewport
  if (measured && Number.isFinite(measured.width) && Number.isFinite(measured.height)) {
    const width = clampDimension(String(measured.width), 240, 2560, current.width)
    const height = clampDimension(String(measured.height), 320, 2000, current.height)
    return { family: width < 600 ? 'smartphone' : width < 1100 ? 'tablet' : 'computer', width, height }
  }
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

function deterministicInstructionForIssue(issue: ProjectIssue | null | undefined): string | null {
  if (!issue) return null
  const selector = deterministicVisualTarget(issue)
  if (!selector) return null
  const measuredWidth = issue.evidence?.viewport.width ?? 768
  const breakpoint = measuredWidth > 768 ? Math.min(2_560, Math.round(measuredWidth)) : 768
  if (issue.rule === 'layout.navigation-wrap') return `Cible ${selector}. Jusqu’à ${breakpoint} px, stabilise le menu dans une rangée défilante sans masquer ses liens.`
  if (issue.rule === 'typography.disproportionate') return `Cible ${selector}. Jusqu’à ${breakpoint} px, borne la taille des grands titres disproportionnés.`
  return null
}

function changePlanForIssues(issues: readonly ProjectIssue[]): Pick<ChangePlanRequest, 'issueIds' | 'instructions'> {
  const issueIds: string[] = []
  const instructions: string[] = []
  for (const issue of issues) {
    const instruction = deterministicInstructionForIssue(issue)
    if (instruction && (!issue.fix || issue.fix.kind === 'manual')) instructions.push(instruction)
    else issueIds.push(issue.id)
  }
  return {
    issueIds: [...new Set(issueIds)],
    instructions: [...new Set(instructions)]
  }
}

function issueIsRetained(issue: ProjectIssue, issueIds: readonly string[], instructions: readonly string[]): boolean {
  const instruction = deterministicInstructionForIssue(issue)
  return issueIds.includes(issue.id) || Boolean(instruction && instructions.includes(instruction))
}

const localIssueLimitPerRoute = 18
const localIssueLimitTotal = 60

function stableRuntimeId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function auditFamily(width: number): string {
  return width < 600 ? 'Smartphone' : width < 1_100 ? 'Tablette' : 'Ordinateur'
}

function issuePriority(issue: ProjectIssue): number {
  const severity = issue.severity === 'bloquant' ? 300 : issue.severity === 'attention' ? 200 : 100
  const ruleWeights: Record<string, number> = {
    'layout.element-overlap': 72,
    'layout.navigation-wrap': 70,
    'layout.viewport-overflow': 66,
    'typography.disproportionate': 62,
    'layout.density-hierarchy': 58,
    'layout.useful-area-overflow': 56,
    'layout.truncated-text': 50,
    'layout.clipped-content': 48,
    'layout.fixed-obstruction': 46,
    'media.image-error': 44,
    'media.image-distortion': 36,
    'accessibility.low-contrast': 30,
    'interaction.small-target': 14
  }
  return severity + (ruleWeights[issue.rule] ?? 20) +
    (issue.coverage === 'standard' ? 16 : issue.coverage === 'heuristique' ? 8 : 0) +
    (issue.confidence === 'certain' ? 12 : issue.confidence === 'probable' ? 6 : 0) +
    (issue.fix?.confidence === 'safe' ? 6 : 0)
}

function prioritizedIssues(issues: ProjectIssue[], limit: number): ProjectIssue[] {
  const perRule = new Map<string, number>()
  const caps: Record<string, number> = {
    'layout.navigation-wrap': 2,
    'layout.element-overlap': 3,
    'interaction.small-target': 2,
    'accessibility.low-contrast': 3,
    'layout.viewport-overflow': 3
  }
  const selected: ProjectIssue[] = []
  for (const issue of [...issues].sort((left, right) => issuePriority(right) - issuePriority(left))) {
    const count = perRule.get(issue.rule) ?? 0
    if (count >= (caps[issue.rule] ?? 4)) continue
    selected.push(issue)
    perRule.set(issue.rule, count + 1)
    if (selected.length >= limit) break
  }
  return selected
}

export function consolidatedRuntimeIssues(audits: RuntimeAudit[]): ProjectIssue[] {
  const navigationScopes = new Set(audits.flatMap((audit) => audit.findings
    .filter((finding) => finding.rule === 'layout.navigation-wrap')
    .map(() => `${audit.route}\u001f${audit.viewport.width}x${audit.viewport.height}`)))
  const groups = new Map<string, Array<{ audit: RuntimeAudit; finding: RuntimeAudit['findings'][number] }>>()
  for (const audit of audits) {
    for (const finding of audit.findings) {
      const scope = `${audit.route}\u001f${audit.viewport.width}x${audit.viewport.height}`
      if (finding.rule === 'interaction.small-target' && navigationScopes.has(scope) && /(?:^|[\s>.#_-])(?:nav|menu|navbar|topbar|toolbar|header)(?:[\s>.#_:-]|$)/i.test(finding.selector)) continue
      const key = `${finding.rule}\u001f${finding.route}\u001f${finding.selector}`
      const group = groups.get(key)
      if (group) group.push({ audit, finding })
      else groups.set(key, [{ audit, finding }])
    }
  }

  return [...groups.entries()].map(([key, entries]) => {
    const representative = [...entries].sort((left, right) =>
      Number(right.finding.severity === 'error') - Number(left.finding.severity === 'error') ||
      right.finding.confidence - left.finding.confidence)[0]
    const viewports = [...new Map(entries.map(({ finding }) => [`${finding.viewport.width}x${finding.viewport.height}`, finding.viewport])).values()]
      .sort((left, right) => left.width - right.width)
    const familyNames = [...new Set(viewports.map((viewport) => auditFamily(viewport.width)))]
    const viewportLabel = viewports.map((viewport) => `${viewport.width} × ${viewport.height}`).join(' · ')
    const affected = viewports.length > 1
      ? ` Observé sur ${viewports.length} formats (${familyNames.join(', ').toLowerCase()}).`
      : ''
    const { finding } = representative
    return {
      id: `runtime:${stableRuntimeId(key)}`,
      title: finding.title,
      description: `${finding.description}${affected}`,
      severity: 'attention',
      coverage: finding.confidence >= 0.9 ? 'standard' : 'heuristique',
      viewport: viewportLabel,
      routePath: finding.route,
      rule: finding.rule,
      proposal: finding.proposal,
      confidence: finding.confidence >= 0.9 ? 'certain' : finding.confidence >= 0.7 ? 'probable' : 'review',
      evidence: {
        selector: finding.selector,
        route: finding.route,
        viewport: { width: finding.viewport.width, height: finding.viewport.height },
        rectangle: finding.rect,
        measurements: {
          runtime: true,
          tag: finding.tag,
          label: finding.label,
          affectedViewports: viewportLabel,
          inspectedNodes: entries.reduce((total, entry) => total + entry.audit.inspectedNodes, 0),
          truncated: entries.some((entry) => entry.audit.truncated)
        },
        screenshotDataUrl: null
      }
    } satisfies ProjectIssue
  })
}

const inspectableStyleProperties = new Set([
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'translate',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
  'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'justify-self', 'order',
  'grid-template-columns', 'grid-template-rows', 'font-family', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'text-align', 'color', 'background-color', 'border-color', 'border-width', 'border-style',
  'border-radius', 'box-shadow', 'opacity', 'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'visibility', 'white-space', 'z-index', 'transform'
])

function cleanInspectionText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : ''
}

function sanitizeVisualElement(value: unknown): VisualElementSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.selector !== 'string' || candidate.selector.length > 640) return null
  const selector = cleanInspectionText(candidate.selector, 640)
  const tag = cleanInspectionText(candidate.tag, 32).toLowerCase()
  const route = cleanInspectionText(candidate.route, 2_048)
  if (!selector || !/^[a-z][a-z\d-]*$/i.test(tag) || !route) return null
  const rawRect = candidate.rect && typeof candidate.rect === 'object' ? candidate.rect as Record<string, unknown> : null
  if (!rawRect) return null
  const finite = (entry: unknown): number | null => typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 100_000 ? Math.round(entry * 100) / 100 : null
  const x = finite(rawRect.x)
  const y = finite(rawRect.y)
  const width = finite(rawRect.width)
  const height = finite(rawRect.height)
  if (x === null || y === null || width === null || height === null || width < 0 || height < 0) return null
  const styles: Record<string, string> = {}
  if (candidate.styles && typeof candidate.styles === 'object') {
    for (const [property, raw] of Object.entries(candidate.styles as Record<string, unknown>).slice(0, 80)) {
      if (!inspectableStyleProperties.has(property) || typeof raw !== 'string') continue
      styles[property] = cleanInspectionText(raw, 240)
    }
  }
  const classes = Array.isArray(candidate.classes)
    ? candidate.classes.map((entry) => cleanInspectionText(entry, 80)).filter(Boolean).slice(0, 16)
    : []
  const occurrences = typeof candidate.occurrences === 'number' && Number.isSafeInteger(candidate.occurrences)
    ? Math.min(10_000, Math.max(0, candidate.occurrences))
    : 0
  return {
    selector,
    tag,
    classes,
    rect: { x, y, width, height },
    styles,
    occurrences,
    route,
    text: cleanInspectionText(candidate.text, 160),
    role: cleanInspectionText(candidate.role, 80) || null,
    ariaLabel: cleanInspectionText(candidate.ariaLabel, 160) || null,
    insideFrame: candidate.insideFrame === true,
    editable: candidate.editable !== false && candidate.insideFrame !== true && selector !== '*' && selector.length <= 320
  }
}

function sanitizeCascadeTrace(value: unknown): CascadeTrace | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || !Array.isArray(candidate.properties)) return null
  const selector = cleanInspectionText(candidate.selector, 640)
  const route = cleanInspectionText(candidate.route, 2_048)
  if (!selector || !route) return null
  const statuses = new Set(['winner', 'overridden', 'inactive', 'inherited', 'inline'])
  const kinds = new Set(['stylesheet', 'inline-style', 'style-attribute', 'generated', 'inherited'])
  const properties: CascadeTrace['properties'] = []
  for (const rawProperty of candidate.properties.slice(0, 32)) {
    if (!rawProperty || typeof rawProperty !== 'object') continue
    const entry = rawProperty as Record<string, unknown>
    const property = cleanInspectionText(entry.property, 80)
    if (!inspectableStyleProperties.has(property) || !Array.isArray(entry.declarations)) continue
    const declarations: CascadeTrace['properties'][number]['declarations'] = []
    for (const rawDeclaration of entry.declarations.slice(0, 32)) {
      if (!rawDeclaration || typeof rawDeclaration !== 'object') continue
      const declaration = rawDeclaration as Record<string, unknown>
      const status = cleanInspectionText(declaration.status, 24)
      const source = declaration.source && typeof declaration.source === 'object' ? declaration.source as Record<string, unknown> : null
      const specificity = Array.isArray(declaration.specificity) ? declaration.specificity.slice(0, 3).map((part) => typeof part === 'number' && Number.isFinite(part) ? Math.max(0, Math.min(1_000_000, Math.round(part))) : 0) : [0, 0, 0]
      const kind = cleanInspectionText(source?.kind, 32)
      if (!statuses.has(status) || !kinds.has(kind) || specificity.length !== 3) continue
      declarations.push({
        property,
        value: cleanInspectionText(declaration.value, 240),
        selector: cleanInspectionText(declaration.selector, 640),
        important: declaration.important === true,
        specificity: specificity as [number, number, number],
        order: typeof declaration.order === 'number' && Number.isSafeInteger(declaration.order) ? Math.max(0, declaration.order) : 0,
        media: Array.isArray(declaration.media) ? declaration.media.map((condition) => cleanInspectionText(condition, 240)).filter(Boolean).slice(0, 8) : [],
        status: status as CascadeTrace['properties'][number]['declarations'][number]['status'],
        source: {
          href: cleanInspectionText(source?.href, 2_048) || null,
          file: cleanInspectionText(source?.file, 1_024) || null,
          line: typeof source?.line === 'number' && Number.isSafeInteger(source.line) && source.line > 0 ? source.line : null,
          column: typeof source?.column === 'number' && Number.isSafeInteger(source.column) && source.column > 0 ? source.column : null,
          occurrence: typeof source?.occurrence === 'number' && Number.isSafeInteger(source.occurrence) && source.occurrence > 0 ? Math.min(10_000, source.occurrence) : null,
          certainty: source?.certainty === 'exact' || source?.certainty === 'estimated' ? source.certainty : null,
          kind: kind as CascadeTrace['properties'][number]['declarations'][number]['source']['kind']
        }
      })
    }
    if (declarations.length) properties.push({ property, computed: cleanInspectionText(entry.computed, 240), declarations })
  }
  return {
    version: 1,
    selector,
    route,
    generatedAt: cleanInspectionText(candidate.generatedAt, 80) || new Date().toISOString(),
    properties,
    truncated: candidate.truncated === true
  }
}

function previewOwnsMessageSource(frame: HTMLIFrameElement | null, source: MessageEventSource | null): boolean {
  const root = frame?.contentWindow
  if (!root || !source) return false
  if (source === root) return true
  const queue: Array<{ window: Window; depth: number }> = [{ window: root, depth: 0 }]
  let inspected = 0
  while (queue.length && inspected < 48) {
    const current = queue.shift()!
    if (current.depth >= 6) continue
    let length = 0
    try { length = Math.min(24, current.window.frames.length) } catch { continue }
    for (let index = 0; index < length && inspected < 48; index += 1) {
      let child: Window
      try { child = current.window.frames[index] } catch { continue }
      inspected += 1
      if (child === source) return true
      queue.push({ window: child, depth: current.depth + 1 })
    }
  }
  return false
}

function PreviewFrame({ project, origin, device, path, compact = false, label, focusSelector, themeOverride, scenarioState = null, resizable = false, allowUpscale = false, zoomable = false, inspectorEnabled = false, composerEnabled = false, visualCss = '', onResize, onPathChange, onThemeChange, onExternal, onAudit, onRenderStatus, onEscape, onInspectElement, onCascadeTrace, onInspectorReady, onInspectorStop, onInspectorShortcut, onComposerGesture, onComposerVerified, onComposerRejected, onComposerNotice }: {
  project: ProjectSnapshot & ProjectExtra
  origin: string | null
  device: Device
  path: string
  compact?: boolean
  label?: string
  focusSelector?: string | null
  themeOverride?: ThemeTarget | null
  scenarioState?: MatrixStateId | null
  resizable?: boolean
  allowUpscale?: boolean
  zoomable?: boolean
  inspectorEnabled?: boolean
  composerEnabled?: boolean
  visualCss?: string
  onResize?: (width: number, height: number) => void
  onPathChange?: (path: string) => void
  onThemeChange?: (theme: RuntimeTheme) => void
  onExternal?: (url: string) => void
  onAudit?: (audit: RuntimeAudit) => void
  onRenderStatus?: (status: RuntimeRenderState | null) => void
  onEscape?: () => void
  onInspectElement?: (element: VisualElementSnapshot, phase: 'hover' | 'selected') => void
  onCascadeTrace?: (trace: CascadeTrace) => void
  onInspectorReady?: () => void
  onInspectorStop?: () => void
  onInspectorShortcut?: () => void
  onComposerGesture?: (gesture: VisualGestureCommit) => void
  onComposerVerified?: (gestureId: string) => void
  onComposerRejected?: (gestureId: string, reason: string) => void
  onComposerNotice?: (message: string) => void
}): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const spaceRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const frameLoadTimerRef = useRef<number | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const previousDeviceId = useRef(device.id)
  const [scale, setScale] = useState(compact ? 0.22 : 0.7)
  const scaleRef = useRef(scale)
  const [isResizing, setIsResizing] = useState(false)
  const [autoFit, setAutoFit] = useState(true)
  const [showBlockedSource, setShowBlockedSource] = useState(false)
  const [framePath, setFramePath] = useState(path)
  const [frameNavigationKey, setFrameNavigationKey] = useState(0)
  const focusSelectorRef = useRef(focusSelector)
  const themeOverrideRef = useRef(themeOverride)
  const scenarioStateRef = useRef(scenarioState)
  const inspectorEnabledRef = useRef(inspectorEnabled)
  const composerEnabledRef = useRef(composerEnabled)
  const visualCssRef = useRef(visualCss)
  const composerGestureRef = useRef(onComposerGesture)
  const composerVerifiedRef = useRef(onComposerVerified)
  const composerRejectedRef = useRef(onComposerRejected)
  const composerNoticeRef = useRef(onComposerNotice)
  const inspectElementRef = useRef(onInspectElement)
  const composerPortRef = useRef<MessagePort | null>(null)
  const composerSessionRef = useRef('')
  const composerDocumentRef = useRef('')
  const composerRevisionRef = useRef(0)
  const interactionRevisionRef = useRef(0)
  const composerGestureIdsRef = useRef(new Set<string>())
  const composerPendingGestureIdsRef = useRef(new Set<string>())
  const visualStyleRequestSequenceRef = useRef(0)
  const visualStyleTimerRef = useRef<number | null>(null)
  const pendingPathRef = useRef<string | null>(null)
  const pendingPathLoadedRef = useRef(false)
  const stateRequestSequenceRef = useRef(0)
  const pendingStateRequestRef = useRef<string | null>(null)
  const loadedDocumentIdRef = useRef<string | null>(null)
  const emittedPathRef = useRef<string | null>(null)
  const previousPathPropRef = useRef(path)
  const previousOriginRef = useRef(origin)
  const previousProjectIdRef = useRef(project.id)
  const reportedPathRef = useRef(path)
  focusSelectorRef.current = focusSelector
  themeOverrideRef.current = themeOverride
  scenarioStateRef.current = scenarioState
  inspectorEnabledRef.current = inspectorEnabled
  composerEnabledRef.current = composerEnabled
  visualCssRef.current = visualCss
  composerGestureRef.current = onComposerGesture
  composerVerifiedRef.current = onComposerVerified
  composerRejectedRef.current = onComposerRejected
  composerNoticeRef.current = onComposerNotice
  inspectElementRef.current = onInspectElement
  scaleRef.current = scale
  const [runtimeRender, setRuntimeRender] = useState<RuntimeRenderState | null>(null)
  const safeRoutes = project.routes.length ? project.routes : [{ path: project.entryPath ?? '/', label: 'Page principale' }]
  const matchedRoute = safeRoutes.find((route) => route.path === path) ?? safeRoutes.find((route) => documentPath(route.path) === documentPath(path))
  const routeValue = matchedRoute?.path ?? path
  const displayedRoutes = matchedRoute || !path ? safeRoutes : [...safeRoutes, { path, label: `Page courante — ${path}` }]
  const readinessBlocked = origin === project.previewOrigin && (project.previewReadiness?.status === 'blocked' || project.previewReadiness?.status === 'needs-build')

  useLayoutEffect(() => {
    const pathChanged = previewRoute(previousPathPropRef.current) !== previewRoute(path)
    const contextChanged = previousOriginRef.current !== origin || previousProjectIdRef.current !== project.id
    previousPathPropRef.current = path
    previousOriginRef.current = origin
    previousProjectIdRef.current = project.id
    if (!pathChanged && !contextChanged) return
    const followsFrameNavigation = !contextChanged && Boolean(emittedPathRef.current) && previewRoute(emittedPathRef.current!) === previewRoute(path)
    emittedPathRef.current = null
    if (followsFrameNavigation) {
      pendingPathRef.current = null
      pendingPathLoadedRef.current = false
      return
    }
    pendingPathRef.current = path
    pendingPathLoadedRef.current = false
    pendingStateRequestRef.current = null
    loadedDocumentIdRef.current = null
    setFramePath(path)
    setFrameNavigationKey((value) => value + 1)
  }, [origin, path, project.id])

  useEffect(() => {
    if (isResizing || !autoFit) return
    const stage = stageRef.current
    if (!stage) return
    const update = (): void => {
      const padding = compact ? 28 : 46
      const availableWidth = Math.max(160, stage.clientWidth - padding)
      const availableHeight = Math.max(180, stage.clientHeight - padding)
      const next = clampPreviewScale(Math.min(allowUpscale ? 1.5 : 1, availableWidth / (device.width + 14), availableHeight / (device.height + 14)))
      scaleRef.current = next
      setScale(next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [allowUpscale, autoFit, compact, device.height, device.width, isResizing])

  useEffect(() => {
    if (device.id === previousDeviceId.current) return
    previousDeviceId.current = device.id
    if (!isResizing && device.id !== 'custom') setAutoFit(true)
  }, [device.id, isResizing])

  useEffect(() => {
    if (allowUpscale) setAutoFit(true)
  }, [allowUpscale])

  useEffect(() => {
    setShowBlockedSource(false)
    setRuntimeRender(null)
    onRenderStatus?.(null)
  }, [onRenderStatus, origin, path, project.id])

  useEffect(() => () => resizeCleanupRef.current?.(), [])
  useEffect(() => () => {
    rejectPendingComposerGestures('preview-interrupted')
    composerPortRef.current?.close()
    composerPortRef.current = null
    if (visualStyleTimerRef.current) window.clearTimeout(visualStyleTimerRef.current)
    visualStyleTimerRef.current = null
  }, [])
  useEffect(() => () => {
    if (frameLoadTimerRef.current) window.clearTimeout(frameLoadTimerRef.current)
  }, [])

  useEffect(() => {
    const releaseComposerGesture = (event: PointerEvent): void => {
      if (!composerEnabledRef.current || !event.isTrusted || !event.isPrimary || event.button !== 0) return
      sendComposerCommand('design-release', { pointerId: event.pointerId, shiftKey: event.shiftKey })
    }
    const cancelComposerGesture = (event: PointerEvent): void => {
      if (composerEnabledRef.current && event.isTrusted && event.isPrimary) sendComposerCommand('design-cancel', { pointerId: event.pointerId })
    }
    window.addEventListener('pointerup', releaseComposerGesture, true)
    window.addEventListener('pointercancel', cancelComposerGesture, true)
    return () => {
      window.removeEventListener('pointerup', releaseComposerGesture, true)
      window.removeEventListener('pointercancel', cancelComposerGesture, true)
    }
  }, [])

  function stageCenter(): { x: number; y: number } | undefined {
    const stage = stageRef.current
    if (!stage) return undefined
    const rectangle = stage.getBoundingClientRect()
    return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 }
  }

  function correlatedGestureIds(value: unknown): string[] {
    return Array.isArray(value)
      ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => cleanInspectionText(entry, 80)).filter(Boolean))].slice(0, 200)
      : []
  }

  function applyManualZoom(nextValue: number, anchor = stageCenter()): void {
    if (!zoomable) return
    const previous = scaleRef.current
    const next = clampPreviewScale(nextValue, previous)
    if (Math.abs(next - previous) < .0001) {
      setAutoFit(false)
      return
    }
    const stage = stageRef.current
    const space = spaceRef.current
    const before = anchor && space ? space.getBoundingClientRect() : null
    const ratioX = before && before.width > 0 ? (anchor!.x - before.left) / before.width : .5
    const ratioY = before && before.height > 0 ? (anchor!.y - before.top) / before.height : .5
    setAutoFit(false)
    scaleRef.current = next
    setScale(next)
    if (!stage || !space || !anchor || !before) return
    window.requestAnimationFrame(() => {
      const after = space.getBoundingClientRect()
      stage.scrollLeft += after.left + after.width * ratioX - anchor.x
      stage.scrollTop += after.top + after.height * ratioY - anchor.y
    })
  }

  function handleZoomWheel(event: React.WheelEvent<HTMLElement>): void {
    if (!zoomable || (!event.metaKey && !event.ctrlKey)) return
    event.preventDefault()
    applyManualZoom(wheelPreviewScale(scaleRef.current, event.deltaY, event.deltaMode), { x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    const listener = (event: MessageEvent): void => {
      if (!previewOwnsMessageSource(frameRef.current, event.source)) return
      const directFrameMessage = event.source === frameRef.current?.contentWindow
      if (origin && event.origin !== origin && !(event.origin === 'null' && !directFrameMessage)) return
      const data = event.data as { channel?: string; type?: string; reason?: string; path?: string; documentId?: string; requestId?: string; gestureIds?: unknown; background?: string; detected?: RuntimeTheme; theme?: { detected?: RuntimeTheme }; url?: string; status?: 'ready' | 'empty'; state?: 'visible' | 'empty'; settled?: boolean; stable?: boolean; failureCount?: number; errorCount?: number; errors?: Array<{ detail?: unknown }>; deltaY?: number; deltaMode?: number; clientX?: number; clientY?: number; applied?: boolean } & Partial<RuntimeAudit>
      if (data.channel !== 'responsiver-preview') return
      if (!directFrameMessage && !['preview-zoom', 'inspector-hover', 'inspector-selected', 'inspector-started', 'inspector-stopped', 'inspector-shortcut'].includes(data.type ?? '')) return
      if (data.type === 'state') {
        if (data.path) {
          const pendingPath = pendingPathRef.current
          const pendingRequest = pendingStateRequestRef.current
          if (pendingRequest && !loadedDocumentIdRef.current && data.requestId !== pendingRequest) return
          if (loadedDocumentIdRef.current && data.documentId && data.documentId !== loadedDocumentIdRef.current) return
          if (pendingPath && previewRoute(data.path) !== previewRoute(pendingPath)) {
            if (!pendingPathLoadedRef.current || data.requestId !== pendingRequest) return
          }
          if (pendingRequest && data.requestId === pendingRequest) {
            pendingStateRequestRef.current = null
            if (data.documentId) loadedDocumentIdRef.current = data.documentId
          } else if (!loadedDocumentIdRef.current && data.documentId) {
            loadedDocumentIdRef.current = data.documentId
          }
          pendingPathRef.current = null
          pendingPathLoadedRef.current = false
          reportedPathRef.current = data.path
          emittedPathRef.current = data.path
          onPathChange?.(data.path)
        }
        const measuredTheme = data.detected ?? data.theme?.detected
        if (measuredTheme === 'dark' || measuredTheme === 'light' || measuredTheme === 'unknown') onThemeChange?.(measuredTheme)
        else {
          const value = luminance(data.background ?? '')
          onThemeChange?.(value === null || value >= .42 && value <= .58 ? 'unknown' : value < .42 ? 'dark' : 'light')
        }
      }
      if (data.type === 'audit') {
        const audit = sanitizeRuntimeAudit(data, device)
        if (audit) onAudit?.(audit)
      }
      if (data.type === 'render-status') {
        const status = data.status ?? (data.state === 'visible' ? 'ready' : data.state === 'empty' ? 'empty' : undefined)
        if (status) {
          const firstFailure = typeof data.errors?.[0]?.detail === 'string' ? data.errors[0].detail.trim().replace(/\s+/g, ' ').slice(0, 180) || null : null
          const rawFailureCount = Number(data.failureCount ?? data.errorCount)
          const failureCount = Number.isFinite(rawFailureCount) ? Math.min(999, Math.max(0, Math.trunc(rawFailureCount))) : 0
          const renderState = { status, settled: Boolean(data.settled ?? data.stable), failureCount, firstFailure }
          setRuntimeRender(renderState)
          onRenderStatus?.(renderState)
        }
      }
      if (data.type === 'external-link' && data.url) onExternal?.(data.url)
      if (data.type === 'escape') onEscape?.()
      if (data.type === 'visual-style-preview-result' && data.applied === false && data.requestId) {
        const gestureIds = correlatedGestureIds(data.gestureIds)
        const requestId = cleanInspectionText(data.requestId, 80)
        const reason = data.reason === 'css-too-large' ? 'css-too-large' : 'invalid-css'
        sendComposerCommand('design-discard', { requestId, gestureIds })
        for (const gestureId of gestureIds) {
          if (!composerPendingGestureIdsRef.current.delete(gestureId)) continue
          composerRejectedRef.current?.(gestureId, reason)
        }
        composerNotice(reason)
      }
      if (((data.type === 'visual-style-preview-result' && data.applied !== false) || data.type === 'visual-style-clear-result') && data.requestId) {
        const gestureIds = correlatedGestureIds(data.gestureIds)
        sendComposerCommand('design-sync', { requestId: cleanInspectionText(data.requestId, 80), gestureIds })
      }
      if (data.type === 'preview-zoom' && zoomable && typeof data.deltaY === 'number') {
        const frameRectangle = frameRef.current?.getBoundingClientRect()
        const anchor = directFrameMessage && frameRectangle && typeof data.clientX === 'number' && typeof data.clientY === 'number'
          ? { x: frameRectangle.left + data.clientX * scaleRef.current, y: frameRectangle.top + data.clientY * scaleRef.current }
          : stageCenter()
        applyManualZoom(wheelPreviewScale(scaleRef.current, data.deltaY, data.deltaMode), anchor)
      }
      if (data.type === 'inspector-hover' || data.type === 'inspector-selected') {
        const sanitized = sanitizeVisualElement(data)
        const element = sanitized && !directFrameMessage ? { ...sanitized, insideFrame: true, editable: false } : sanitized
        if (element) onInspectElement?.(element, data.type === 'inspector-hover' ? 'hover' : 'selected')
      }
      if (data.type === 'cascade-trace') {
        const trace = sanitizeCascadeTrace(data)
        if (trace) onCascadeTrace?.(trace)
      }
      if (data.type === 'inspector-started' && inspectorEnabledRef.current) onInspectorReady?.()
      if (data.type === 'inspector-stopped' && inspectorEnabledRef.current && data.reason === 'escape') onInspectorStop?.()
      if (data.type === 'inspector-shortcut') onInspectorShortcut?.()
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [device, onAudit, onCascadeTrace, onEscape, onExternal, onInspectElement, onInspectorReady, onInspectorShortcut, onInspectorStop, onPathChange, onRenderStatus, onThemeChange, origin, zoomable])

  const post = (type: string, payload: Record<string, unknown> = {}): void => frameRef.current?.contentWindow?.postMessage({ channel: 'responsiver-preview', type, ...payload }, origin ?? '*')

  function scheduleVisualStylePreview(delay = 80): void {
    if (visualStyleTimerRef.current) window.clearTimeout(visualStyleTimerRef.current)
    visualStyleTimerRef.current = window.setTimeout(() => {
      visualStyleTimerRef.current = null
      const requestId = `${composerSessionRef.current || project.id}:${++visualStyleRequestSequenceRef.current}`
      const gestureIds = [...composerPendingGestureIdsRef.current].slice(0, 200)
      const css = visualCssRef.current
      post(css ? 'visual-style-preview' : 'visual-style-clear', css ? { css, requestId, gestureIds } : { requestId, gestureIds })
    }, delay)
  }
  const source = origin ? `${origin}${framePath}` : undefined
  const runtimeBlocked = runtimeRender?.status === 'empty' && runtimeRender.settled
  const outerWidth = Math.round((device.width + 14) * scale)
  const outerHeight = Math.round((device.height + 14) * scale)

  function sendComposerCommand(type: string, payload: Record<string, unknown> = {}): void {
    const port = composerPortRef.current
    const sessionId = composerSessionRef.current
    if (!port || !sessionId || !composerDocumentRef.current) return
    const revision = ++composerRevisionRef.current
    port.postMessage({ protocol: 1, sessionId, revision, type, ...payload })
  }

  function composerNotice(reason: unknown): void {
    const messages: Record<string, string> = {
      'unstable-or-sensitive-target': 'Cet élément ne peut pas être déplacé sûrement. Sélectionnez son conteneur.',
      'existing-complex-transform': 'Ce bloc utilise déjà une transformation complexe. Responsiver refuse de l’écraser.',
      'target-detached': 'Le site a recréé cet élément ; sélectionnez-le de nouveau.',
      'payload-too-large': 'Cette réorganisation touche trop d’éléments en une fois. Manipulez un groupe plus petit.',
      'layout-still-constrained': 'Cette cible n’a pas suivi le geste, probablement à cause d’une règle prioritaire du site. La dernière tentative a été retirée ; essayez son conteneur ou le panneau Inspecter.',
      'invalid-css': 'Le CSS temporaire produit par ce geste est invalide. Le geste a été retiré sans toucher aux autres changements.',
      'css-too-large': 'La prévisualisation temporaire dépasse la limite de sécurité. Les gestes concernés ont été retirés sans toucher aux changements plus récents.',
      'preview-interrupted': 'La prévisualisation a été interrompue avant validation. Seuls les gestes encore en attente ont été annulés.'
    }
    composerNoticeRef.current?.(messages[String(reason)] ?? 'Ce geste ne peut pas être converti en CSS responsive sûr.')
  }

  function rejectPendingComposerGestures(reason: 'preview-interrupted'): void {
    let rejected = false
    for (const gestureId of [...composerPendingGestureIdsRef.current]) {
      if (!composerPendingGestureIdsRef.current.delete(gestureId)) continue
      composerRejectedRef.current?.(gestureId, reason)
      rejected = true
    }
    if (rejected) composerNotice(reason)
  }

  function connectComposerBridge(): void {
    rejectPendingComposerGestures('preview-interrupted')
    composerPortRef.current?.close()
    composerPortRef.current = null
    composerDocumentRef.current = ''
    composerRevisionRef.current = 0
    composerGestureIdsRef.current.clear()
    composerPendingGestureIdsRef.current.clear()
    const frameWindow = frameRef.current?.contentWindow
    if (!frameWindow || !origin || !composerGestureRef.current) return
    const bridgeChannel = new MessageChannel()
    const sessionId = window.crypto.randomUUID?.() ?? `composer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    composerSessionRef.current = sessionId
    composerPortRef.current = bridgeChannel.port1
    bridgeChannel.port1.onmessage = (event: MessageEvent): void => {
      const data = event.data as Record<string, unknown>
      if (!data || data.protocol !== 1 || data.sessionId !== composerSessionRef.current || typeof data.type !== 'string') return
      if (data.type === 'design-ready') {
        const documentId = cleanInspectionText(data.documentId, 80)
        if (!documentId) return
        composerDocumentRef.current = documentId
        sendComposerCommand(composerEnabledRef.current ? 'design-start' : 'design-stop', { interactionRevision: Math.max(1, interactionRevisionRef.current) })
        if (composerEnabledRef.current && focusSelectorRef.current) sendComposerCommand('design-select', { selector: focusSelectorRef.current })
        return
      }
      const eventRevision = Number(data.revision)
      if (data.documentId !== composerDocumentRef.current || !Number.isSafeInteger(eventRevision) || eventRevision < 0 || eventRevision > composerRevisionRef.current) return
      if (data.type === 'design-selection') {
        const selection = sanitizeVisualElement(data.selection)
        if (selection) inspectElementRef.current?.(selection, 'selected')
      }
      if (data.type === 'design-commit') {
        const gesture = sanitizeVisualGestureCommit(data)
        if (!gesture) composerNoticeRef.current?.('Le geste reçu n’a pas passé les contrôles de sécurité.')
        else if (!composerGestureIdsRef.current.has(gesture.gestureId)) {
          composerGestureIdsRef.current.add(gesture.gestureId)
          composerPendingGestureIdsRef.current.add(gesture.gestureId)
          if (composerGestureIdsRef.current.size > 200) composerGestureIdsRef.current.delete(composerGestureIdsRef.current.values().next().value!)
          composerGestureRef.current?.(gesture)
          scheduleVisualStylePreview()
        }
      }
      if (data.type === 'design-verified') {
        const gestureId = cleanInspectionText(data.gestureId, 80)
        if (gestureId) {
          composerPendingGestureIdsRef.current.delete(gestureId)
          composerVerifiedRef.current?.(gestureId)
        }
      }
      if (data.type === 'design-rejected') {
        const gestureId = cleanInspectionText(data.gestureId, 80)
        const reason = cleanInspectionText(data.reason, 80)
        if (gestureId) composerPendingGestureIdsRef.current.delete(gestureId)
        if (gestureId && reason) composerRejectedRef.current?.(gestureId, reason)
        composerNotice(data.reason)
      }
      if (data.type === 'design-invalidated') composerNotice(data.reason)
    }
    bridgeChannel.port1.start()
    frameWindow.postMessage({ channel: 'responsiver-preview', type: 'design-connect', protocol: 1, sessionId }, origin, [bridgeChannel.port2])
  }

  function synchronizeLoadedFrame(): void {
    connectComposerBridge()
    pendingPathLoadedRef.current = true
    loadedDocumentIdRef.current = null
    const requestId = `${project.id}:${++stateRequestSequenceRef.current}`
    pendingStateRequestRef.current = requestId
    post('state-request', { requestId })
    if (frameLoadTimerRef.current) window.clearTimeout(frameLoadTimerRef.current)
    frameLoadTimerRef.current = window.setTimeout(() => {
      const currentFocus = focusSelectorRef.current
      const currentTheme = themeOverrideRef.current
      post(inspectorEnabledRef.current ? 'inspector-start' : 'inspector-stop', { interactionRevision: Math.max(1, interactionRevisionRef.current) })
      scheduleVisualStylePreview(0)
      post(currentTheme ? 'set-theme-preview' : 'clear-theme-preview', currentTheme ? { theme: currentTheme } : {})
      post(currentFocus ? 'focus-selector' : 'clear-focus', currentFocus ? { selector: currentFocus } : {})
      const currentScenario = scenarioStateRef.current
      if (currentScenario && currentScenario !== 'initial') post('matrix-scenario', { state: currentScenario })
    }, 90)
  }

  useEffect(() => {
    if (!focusSelector) {
      post('clear-focus')
      return
    }
    const timer = window.setTimeout(() => post('focus-selector', { selector: focusSelector }), 220)
    if (composerEnabled && focusSelector) sendComposerCommand('design-select', { selector: focusSelector })
    return () => window.clearTimeout(timer)
  }, [composerEnabled, device.height, device.width, focusSelector, source])

  useEffect(() => {
    const timer = window.setTimeout(() => post(themeOverride ? 'set-theme-preview' : 'clear-theme-preview', themeOverride ? { theme: themeOverride } : {}), 240)
    return () => window.clearTimeout(timer)
  }, [source, themeOverride])

  useEffect(() => {
    const interactionRevision = ++interactionRevisionRef.current
    const timer = window.setTimeout(() => {
      post(inspectorEnabled ? 'inspector-start' : 'inspector-stop', { interactionRevision })
      sendComposerCommand(composerEnabled ? 'design-start' : 'design-stop', { interactionRevision })
      if (composerEnabled && focusSelectorRef.current) sendComposerCommand('design-select', { selector: focusSelectorRef.current })
    }, 20)
    return () => window.clearTimeout(timer)
  }, [composerEnabled, inspectorEnabled, source])

  useEffect(() => {
    scheduleVisualStylePreview()
    return () => {
      if (visualStyleTimerRef.current) window.clearTimeout(visualStyleTimerRef.current)
      visualStyleTimerRef.current = null
    }
  }, [source, visualCss])

  function beginResize(edge: ResizeEdge, event: React.PointerEvent<HTMLButtonElement>): void {
    if (!resizable || !onResize) return
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const captureTarget = event.currentTarget
    const pointerId = event.pointerId
    captureTarget.setPointerCapture(pointerId)
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
      if (captureTarget.isConnected && captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId)
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
    const horizontalKey = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
    const verticalKey = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
    const horizontal = edge.includes('w') ? -horizontalKey : edge.includes('e') ? horizontalKey : 0
    const vertical = edge.includes('n') ? -verticalKey : edge.includes('s') ? verticalKey : 0
    const nextWidth = Math.min(2560, Math.max(240, device.width + horizontal))
    const nextHeight = Math.min(2000, Math.max(320, device.height + vertical))
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

  function diagnosticCard(overlay = false): ReactElement {
    return <div className={overlay ? 'preview-diagnostic preview-diagnostic--overlay' : 'preview-diagnostic'} role="status"><span className="preview-diagnostic__index">R—00</span><div className="preview-diagnostic__icon"><Icon name="finding" size={20} /></div><span className="overline">Diagnostic du rendu</span><strong>{readinessBlocked ? project.previewReadiness.summary : 'La page s’est chargée, mais aucun contenu visible n’a été produit.'}</strong><p>{readinessBlocked ? project.previewReadiness.diagnostics[0]?.detail ?? 'La page sélectionnée ne produit aucun contenu exploitable.' : runtimeRender?.failureCount ? `${runtimeRender.failureCount} erreur${runtimeRender.failureCount > 1 ? 's' : ''} de script ou de ressource ont été observées pendant le chargement.${runtimeRender.firstFailure ? ` ${runtimeRender.firstFailure}` : ''}` : 'Le point de montage est resté vide après le chargement. Vérifiez le bundle local et les dépendances nécessaires.'}</p>{origin && <button className="button button--secondary" type="button" onClick={() => setShowBlockedSource(true)}>Afficher la source brute</button>}<small>{origin ? 'Le runner continue en arrière-plan et requalifiera automatiquement un montage tardif.' : 'Le runner reste arrêté tant qu’aucune entrée exploitable n’est disponible.'}</small></div>
  }

  return <section className={`${compact ? 'preview preview--compact' : 'preview'}${isResizing ? ' is-resizing' : ''}`} aria-label={label ?? `Aperçu ${device.name}`}>
    {!compact && <div className="browser-bar">
      <div className="browser-controls">
        <button className="icon-button" onClick={() => post('back')} aria-label="Page précédente" disabled={!origin}><Icon name="back" size={15} /></button>
        <button className="icon-button" onClick={() => post('forward')} aria-label="Page suivante" disabled={!origin}><Icon name="forward" size={15} /></button>
        <button className="icon-button" onClick={() => { setRuntimeRender(null); setShowBlockedSource(false); post('reload') }} aria-label="Recharger" disabled={!origin}><Icon name="refresh" size={15} /></button>
      </div>
      <select aria-label="Page du site" value={routeValue} onChange={(event) => {
        pendingPathRef.current = event.target.value
        pendingPathLoadedRef.current = false
        onPathChange?.(event.target.value)
      }}>
        {displayedRoutes.map((route) => <option value={route.path} key={route.path}>{route.label}</option>)}
      </select>
      <code title={path}>{path}</code>
      {origin ? <span className="runner-status"><i /> Local</span> : <span className="runner-status runner-status--stopped">Arrêté</span>}
    </div>}
    <div ref={stageRef} className="preview-stage" onWheel={handleZoomWheel}>
      {readinessBlocked && !showBlockedSource ? diagnosticCard() : <><div className="device-space" style={{ width: outerWidth, height: outerHeight }}>
        <div ref={spaceRef} className="device-shell" style={{ width: device.width, height: device.height, transform: `scale(${scale})` }}>
          <iframe key={`${project.id}:${origin ?? 'inline-preview'}:${frameNavigationKey}`} ref={frameRef} title={`${project.name} — ${device.name}`} width={device.width} height={device.height} sandbox={origin ? 'allow-scripts allow-forms allow-same-origin' : ''} src={source} srcDoc={source ? undefined : project.previewHtml ?? undefined} onLoad={synchronizeLoadedFrame} />
          {resizable && !composerEnabled && (Object.keys(resizeLabels) as ResizeEdge[]).map((edge) => <button type="button" key={edge} className={`resize-handle resize-handle--${edge}`} aria-label={resizeLabels[edge]} title={`${resizeLabels[edge]} · flèches, Maj pour 20 px`} onPointerDown={(event) => beginResize(edge, event)} onKeyDown={(event) => resizeWithKeyboard(edge, event)} />)}
        </div>
      </div>{runtimeBlocked && !showBlockedSource && diagnosticCard(true)}</>}
    </div>
    <footer className="preview-meta"><strong>{label ?? device.name}</strong><code>{device.width} × {device.height} CSS px</code>{resizable && !composerEnabled && <span><i /> Glissez un bord</span>}{composerEnabled && <span><i /> Poignées de l’élément actives</span>}{zoomable && <PreviewZoomControls scale={scale} autoFit={autoFit} onZoomOut={() => applyManualZoom(stepPreviewScale(scaleRef.current, -1))} onZoomIn={() => applyManualZoom(stepPreviewScale(scaleRef.current, 1))} onActualSize={() => applyManualZoom(1)} onFit={() => setAutoFit(true)} />}</footer>
  </section>
}

export default function App(): ReactElement {
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return window.localStorage.getItem('responsiver.rail-collapsed') === 'true' } catch { return false }
  })
  const [onboardingState, setOnboardingState] = useState(() => {
    const hideOnStartup = isOnboardingHidden()
    return { open: !hideOnStartup, hideOnStartup }
  })
  const [destination, setDestination] = useState<Destination>('projects')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('findings')
  const [project, setProject] = useState<(ProjectSnapshot & ProjectExtra) | null>(null)
  const [staging, setStaging] = useState<StagingSnapshot | null>(null)
  const [matrixResult, setMatrixResult] = useState<MatrixRunResult | null>(null)
  const [matrixProgress, setMatrixProgress] = useState<MatrixRunProgress | null>(null)
  const [matrixBusy, setMatrixBusy] = useState(false)
  const [matrixScenario, setMatrixScenario] = useState<{ route: string; state: MatrixStateId } | null>(null)
  const [expressVerification, setExpressVerification] = useState<ExpressVerificationState | null>(null)
  const [proposal, setProposal] = useState<StagingSnapshot | null>(null)
  const [proposalContext, setProposalContext] = useState<ProposalContext | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('source')
  const [labMode, setLabMode] = useState<LabMode>('device')
  const [stageFullscreen, setStageFullscreen] = useState(false)
  const [visualFullscreen, setVisualFullscreen] = useState(false)
  const [visualMode, setVisualMode] = useState<VisualEditorMode>('compose')
  const [inspectorLocation, setInspectorLocation] = useState<InspectorLocation>(null)
  const [inspectorPhase, setInspectorPhase] = useState<InspectorPhase>('idle')
  const [inspectedElement, setInspectedElement] = useState<VisualElementSnapshot | null>(null)
  const [cascadeTrace, setCascadeTrace] = useState<CascadeTrace | null>(null)
  const [cascadeLoading, setCascadeLoading] = useState(false)
  const [codeLocation, setCodeLocation] = useState<{ file: string; line: number | null; column: number | null } | null>(null)
  const [visualScope, setVisualScope] = useState<VisualEditScope>({ kind: 'mobile' })
  const [visualRouteScope, setVisualRouteScope] = useState<'current' | 'all'>('current')
  const [visualMultipleConfirmed, setVisualMultipleConfirmed] = useState(false)
  const [visualHistory, setVisualHistory] = useState<VisualEditHistory>({ past: [], present: [], future: [] })
  const visualHistoryRef = useRef(visualHistory)
  const visualMutationSequenceRef = useRef(0)
  const visualKeyRevisionsRef = useRef(new Map<string, number>())
  const visualGestureCheckpoints = useRef(new Map<string, VisualGestureCheckpoint>())
  visualHistoryRef.current = visualHistory
  const [family, setFamily] = useState<DeviceFamily>('smartphone')
  const [deviceId, setDeviceId] = useState('iphone-15')
  const [width, setWidth] = useState('393')
  const [height, setHeight] = useState('852')
  const [activePath, setActivePath] = useState('/index.html')
  const [runtimeTheme, setRuntimeTheme] = useState<RuntimeTheme>('unknown')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([])
  const [queuedIssueIds, setQueuedIssueIds] = useState<string[]>([])
  const [showAllIssues, setShowAllIssues] = useState(false)
  const [themeTarget, setThemeTarget] = useState<ThemeTarget | null>(null)
  const [previewThemeTarget, setPreviewThemeTarget] = useState<ThemeTarget | null>(null)
  const [instructions, setInstructions] = useState<string[]>([])
  const [messages, setMessages] = useState<ConversationMessage[]>([{ id: 'welcome', author: 'system', text: 'Décrivez un ajustement précis. Responsiver applique uniquement les règles locales qu’il sait interpréter et vous montre le résultat avant export.' }])
  const [draft, setDraft] = useState('')
  const [runtimeAudit, setRuntimeAudit] = useState<RuntimeAudit | null>(null)
  const [, setLocalAuditRevision] = useState(0)
  const [runtimeRenderStatus, setRuntimeRenderStatus] = useState<RuntimeRenderState | null>(null)
  const [remoteAudit, setRemoteAudit] = useState<RemoteAuditResult | null>(null)
  const [remoteState, setRemoteState] = useState<RemotePageState | null>(null)
  const [workspaceOrigin, setWorkspaceOrigin] = useState<string | null>(null)
  const [publicUrl, setPublicUrl] = useState('')
  const [localhostUrl, setLocalhostUrl] = useState('http://localhost:5173')
  const [localhostRoot, setLocalhostRoot] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [recentProjects, setRecentProjects] = useState<RecentProjectSummary[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [forgettingRecentId, setForgettingRecentId] = useState<string | null>(null)
  const [preparation, setPreparation] = useState<ProjectPreparationProgress | null>(null)
  const [showPreparation, setShowPreparation] = useState(false)
  const [pageGuideOpen, setPageGuideOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [undoAvailable, setUndoAvailable] = useState(false)
  const noticeTimer = useRef<number | null>(null)
  const appMainRef = useRef<HTMLElement>(null)
  const previewSequence = useRef(0)
  const draftRevision = useRef(0)
  const activeProjectId = useRef<string | null>(null)
  const activeProjectSnapshot = useRef<(ProjectSnapshot & ProjectExtra) | null>(null)
  const activePathRef = useRef(activePath)
  const fastApplyInFlight = useRef(false)
  const queuedIssuesAwaitingAudit = useRef(new Map<string, ProjectIssue>())
  const queuedViewportsAwaitingAudit = useRef(new Map<string, Set<string>>())
  const renderedProjectRef = useRef<(ProjectSnapshot & ProjectExtra) | null>(project)
  const queuedIssueIdsRef = useRef(queuedIssueIds)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const visualFullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const onboardingTriggerRef = useRef<HTMLButtonElement>(null)
  const onboardingFallbackFocusRef = useRef<HTMLButtonElement>(null)
  const onboardingOpenedFromRail = useRef(false)
  const remoteAudits = useRef(new Map<string, RemoteAuditResult>())
  const localRuntimeAudits = useRef(new Map<string, RuntimeAudit>())
  const localSourceIssues = useRef<ProjectIssue[]>([])
  renderedProjectRef.current = project
  queuedIssueIdsRef.current = queuedIssueIds

  async function refreshRecentProjects(): Promise<void> {
    if (!api().listRecentProjects) {
      setRecentProjects([])
      setRecentLoading(false)
      return
    }
    try {
      setRecentProjects(await api().listRecentProjects!())
    } catch {
      setRecentProjects([])
    } finally {
      setRecentLoading(false)
    }
  }

  const currentDevice = useMemo<Device>(() => {
    if (deviceId === 'custom') return { id: 'custom', family, name: 'Format personnalisé', width: clampDimension(width, 240, 2560, 393), height: clampDimension(height, 320, 2000, 852) }
    return devices.find((device) => device.id === deviceId) ?? devices[1]
  }, [deviceId, family, height, width])
  const familyDevices = devices.filter((device) => device.family === family)
  const visualAuthorization = useMemo(() => project ? authorizeVisualEditor({
    sourceKind: project.source.kind,
    readOnly: project.source.readOnly,
    localRoot: project.source.localRoot,
    artifact: Boolean(project.previewBasePath || project.capabilities.previewStrategy === 'artifact')
  }) : null, [project])
  const compiledVisualEdits = useMemo(() => compileVisualEditCss(visualHistory.present), [visualHistory.present])
  const visualCss = useMemo(() => compileVisualEditCss(visualHistory.present, activePath).css, [activePath, visualHistory.present])
  const currentVisualRoutePersistent = useMemo(() => {
    if (!project) return false
    const route = project.routes.find((candidate) => candidate.path === activePath) ?? project.routes.find((candidate) => documentPath(candidate.path) === documentPath(activePath))
    return /\.html?$/i.test(route?.sourcePath ?? route?.path ?? '')
  }, [activePath, project])
  const routeIssues = useMemo(() => {
    if (!project) return []
    const remoteProject = project.source.kind === 'remote-url' || project.source.kind === 'linked-localhost'
    if (remoteProject) {
      return project.issues.filter((issue) => {
        const routePath = (issue as ProjectIssue & IssueExtra).routePath ?? issue.evidence?.route
        return !routePath || routePath === activePath
      })
    }
    const currentPath = documentPath(activePath)
    const knownRoute = project.routes.find((route) => route.path === activePath) ?? project.routes.find((route) => documentPath(route.path) === currentPath)
    const issuePath = documentPath(knownRoute?.path ?? project.entryPath ?? project.routes[0]?.path ?? activePath)
    return project.issues.filter((issue) => {
      const routePath = (issue as ProjectIssue & IssueExtra).routePath
      return !routePath || documentPath(routePath) === issuePath
    })
  }, [activePath, project])
  const inspectorIssues = showAllIssues ? project?.issues ?? [] : routeIssues
  const scopedProject = useMemo(() => project ? { ...project, issues: inspectorIssues } : null, [inspectorIssues, project])
  const selectedIssue = inspectorIssues.find((issue) => issue.id === selectedIssueId) ?? inspectorIssues[0] ?? null
  const localAuditProfileCount = new Set([...localRuntimeAudits.current.values()]
    .filter((audit) => documentPath(audit.route) === documentPath(activePath))
    .map((audit) => `${audit.viewport.width}x${audit.viewport.height}`)).size
  const isRemote = project?.source.kind === 'remote-url' || project?.source.kind === 'linked-localhost'
  const frameworkSupport = useMemo(() => project ? frameworkSupportFor(project) : null, [project])
  const workspaceEnabled = Boolean(project && !project.source.readOnly && project.source.localRoot)
  const stagingAvailable = Boolean(project && !project.source.readOnly && project.source.localRoot && project.capabilities?.staging)
  const labCorrectionAvailable = Boolean(stagingAvailable && project?.source.kind === 'local-project')
  const directApplyAvailable = Boolean(labCorrectionAvailable && Boolean(api().applyStagingToSource) && frameworkSupport?.durableAutomaticFixes)
  const activeOrigin = previewMode === 'staging' && staging?.previewOrigin
    ? staging.previewOrigin
    : (previewMode === 'proposal' || previewMode === 'before-after') && proposal?.previewOrigin
      ? proposal.previewOrigin
      : workspaceOrigin ?? project?.previewOrigin ?? null
  const focusedSelector = proposalContext?.issueId
    ? (() => {
        const issue = project?.issues.find((candidate) => candidate.id === proposalContext.issueId) as (ProjectIssue & IssueExtra) | undefined
        return issue?.fix?.selector ?? issue?.evidence?.selector ?? null
      })()
    : null
  const nativeThemeTarget = previewMode === 'source' && proposalContext?.kind === 'theme' && previewThemeTarget && project && (
    project.theme.detected === 'dual' || project.theme.detected === previewThemeTarget || (previewThemeTarget === 'dark' ? project.theme.hasDark : project.theme.hasLight)
  ) ? previewThemeTarget : null

  useEffect(() => {
    if (!inspectorIssues.some((issue) => issue.id === selectedIssueId)) setSelectedIssueId(inspectorIssues[0]?.id ?? null)
  }, [inspectorIssues, selectedIssueId])

  useEffect(() => {
    if (!project) return
    const knownIssueIds = new Set(project.issues.map((issue) => issue.id))
    setQueuedIssueIds((current) => current.filter((id) => knownIssueIds.has(id) || queuedIssuesAwaitingAudit.current.has(id)))
  }, [project])

  useEffect(() => {
    void refreshRecentProjects()
    const unsubscribe = api().onProjectPreparation?.((progress) => setPreparation(progress))
    const unsubscribeExtension = window.responsiver.onExtensionOpenProject((payload) => {
      applyProject(payload.project)
      setWidth(String(payload.viewport.width))
      setHeight(String(payload.viewport.height))
      setFamily(payload.viewport.width < 600 ? 'smartphone' : payload.viewport.width < 1_100 ? 'tablet' : 'computer')
      setDeviceId('custom')
      flash('Page reçue depuis l’extension Chrome et ouverte dans une session isolée.')
    })
    const unsubscribeBlocked = window.responsiver.onRemoteBlockedNavigation((payload) => flash(`${payload.detail} ${payload.url}`))
    const unsubscribeRemoteInspector = window.responsiver.onRemoteInspectorSelection((selection: RemoteInspectorSelection) => {
      if (selection.projectId !== activeProjectId.current) return
      setInspectedElement(selection)
      setCascadeTrace(null)
      setCascadeLoading(false)
      setInspectorPhase('active')
      setVisualMultipleConfirmed(false)
    })
    const unsubscribeWorkspace = window.responsiver.onWorkspacePreviewOrigin(setWorkspaceOrigin)
    const unsubscribeMatrix = window.responsiver.onMatrixProgress((progress) => setMatrixProgress(progress))
    const unsubscribeApplied = window.responsiver.onWorkspaceApplied(() => {
      const renderedProject = renderedProjectRef.current
      const queuedIssuesToPreserve = queuedIssueIdsRef.current
        .map((id) => renderedProject?.issues.find((issue) => issue.id === id))
        .filter((issue): issue is ProjectIssue => Boolean(issue))
      previewSequence.current += 1
      setStaging(null)
      setProposal(null)
      setProposalContext(null)
      setWorkspaceOrigin(null)
      setPreviewMode('source')
      localRuntimeAudits.current.clear()
      setRuntimeAudit(null)
      const current = renderedProject ?? activeProjectSnapshot.current
      if (!current || fastApplyInFlight.current) return
      if (current.source.kind === 'local-project') {
        const pathBeforeWrite = activePathRef.current
        void window.responsiver.reanalyzeCurrentProject().then((snapshot) => {
          applyProject(snapshot, queuedIssuesToPreserve)
          if (snapshot.routes.some((route) => route.path === pathBeforeWrite)) setActivePath(pathBeforeWrite)
        }).catch(() => {
          flash('Les fichiers ont été appliqués. Rouvrez le projet pour recalculer tous les constats.')
        })
      }
    })
    return () => { unsubscribe?.(); unsubscribeExtension(); unsubscribeBlocked(); unsubscribeRemoteInspector(); unsubscribeWorkspace(); unsubscribeMatrix(); unsubscribeApplied() }
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem('responsiver.rail-collapsed', String(railCollapsed)) } catch { /* préférence non persistée dans ce contexte */ }
  }, [railCollapsed])

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  const preparationActive = preparation !== null

  useEffect(() => {
    if (!busy || !preparationActive) {
      setShowPreparation(false)
      return
    }
    const timer = window.setTimeout(() => setShowPreparation(true), 320)
    return () => window.clearTimeout(timer)
  }, [busy, preparationActive])

  useEffect(() => {
    if (!stageFullscreen) return
    const suppressed = [...document.querySelectorAll<HTMLElement>('.nav-rail, .titlebar, .command-bar, .inspector, .activity-bar')]
    for (const element of suppressed) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    const focusFrame = window.requestAnimationFrame(() => fullscreenButtonRef.current?.focus())
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setStageFullscreen(false)
    }
    window.addEventListener('keydown', close)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', close)
      for (const element of suppressed) {
        element.inert = false
        element.removeAttribute('aria-hidden')
      }
      window.requestAnimationFrame(() => fullscreenButtonRef.current?.focus())
    }
  }, [stageFullscreen])

  useEffect(() => {
    if (destination !== 'lab') setStageFullscreen(false)
  }, [destination])

  useLayoutEffect(() => {
    appMainRef.current?.scrollTo({ top: 0, left: 0 })
  }, [destination])

  useEffect(() => {
    if (!visualFullscreen) return
    const dialog = visualFullscreenButtonRef.current?.closest<HTMLElement>('.visual-workspace')
    if (!dialog) return
    const suppressed: HTMLElement[] = []
    let branch: HTMLElement = dialog
    while (branch.parentElement) {
      const parent = branch.parentElement
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.classList.contains('toast')) suppressed.push(sibling)
      }
      branch = parent
      if (branch.classList.contains('app-shell')) break
    }
    const previous = suppressed.map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') }))
    for (const { element } of previous) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    const focusFrame = window.requestAnimationFrame(() => visualFullscreenButtonRef.current?.focus())
    const focusableElements = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')]
      .filter((element) => !element.inert && !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0)
    const keepFocusInside = (event: FocusEvent): void => {
      if (event.target instanceof Node && dialog.contains(event.target)) return
      visualFullscreenButtonRef.current?.focus()
    }
    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setVisualFullscreen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        visualFullscreenButtonRef.current?.focus()
        return
      }
      const active = document.activeElement
      if (!(active instanceof Node) || !dialog.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('focusin', keepFocusInside, true)
    document.addEventListener('keydown', handleKeydown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('focusin', keepFocusInside, true)
      document.removeEventListener('keydown', handleKeydown, true)
      for (const { element, inert, ariaHidden } of previous) {
        element.inert = inert
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
      window.requestAnimationFrame(() => visualFullscreenButtonRef.current?.focus())
    }
  }, [visualFullscreen])

  useEffect(() => {
    if (destination !== 'visual') setVisualFullscreen(false)
  }, [destination])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      const togglesInspector = event.key === 'F12' || ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'i') || ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c')
      if (!togglesInspector || onboardingState.open || showPreparation || (destination !== 'lab' && destination !== 'code' && destination !== 'visual')) return
      event.preventDefault()
      if (destination === 'visual') {
        setInspectedElement(null)
        setVisualMode((current) => current === 'select' ? 'interact' : 'select')
      } else toggleInspector(destination)
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [destination, inspectorLocation, onboardingState.open, project?.id, showPreparation])

  useEffect(() => window.responsiver.onRemoteInspectorShortcut((projectId) => {
    if (projectId !== activeProjectId.current || onboardingState.open || showPreparation || (destination !== 'lab' && destination !== 'code' && destination !== 'visual')) return
    if (destination === 'visual') {
      setInspectedElement(null)
      setVisualMode((current) => current === 'select' ? 'interact' : 'select')
    } else toggleInspector(destination)
  }), [destination, inspectorLocation, onboardingState.open, project?.id, showPreparation, visualMode])

  useEffect(() => window.responsiver.onRemoteInspectorCanceled((projectId) => {
    if (projectId !== activeProjectId.current) return
    setInspectedElement(null)
    setCascadeTrace(null)
    setCascadeLoading(false)
    setCodeLocation(null)
    setInspectorPhase('idle')
    if (destination === 'visual') setVisualMode('interact')
    else setInspectorLocation(null)
  }), [destination])

  useEffect(() => window.responsiver.onRemoteInspectorReady((projectId) => {
    if (projectId !== activeProjectId.current) return
    if ((destination === 'lab' && inspectorLocation === 'lab') || (destination === 'code' && inspectorLocation === 'code') || (destination === 'visual' && visualMode === 'select')) {
      setInspectorPhase('active')
    }
  }), [destination, inspectorLocation, visualMode])

  useEffect(() => {
    if (!project || !isRemote) return
    const active = (destination === 'lab' && inspectorLocation === 'lab') || (destination === 'code' && inspectorLocation === 'code') || (destination === 'visual' && visualMode === 'select')
    const request = { projectId: project.id }
    let cancelled = false
    if (active) {
      setInspectorPhase('starting')
      void window.responsiver.startRemoteInspector(request).then((state) => {
        if (!cancelled) setInspectorPhase(state.active ? 'active' : 'starting')
      }).catch((error) => {
        if (cancelled) return
        setInspectorLocation(null)
        setInspectorPhase('idle')
        flash(error instanceof Error ? error.message : 'L’inspecteur distant n’a pas pu démarrer.')
      })
    } else {
      setInspectorPhase('idle')
      void window.responsiver.stopRemoteInspector(request).catch(() => undefined)
    }
    return () => {
      cancelled = true
      if (active) void window.responsiver.stopRemoteInspector(request).catch(() => undefined)
    }
  }, [destination, inspectorLocation, isRemote, project?.id, visualMode])

  useEffect(() => {
    if (!project || project.source.kind !== 'linked-localhost') return
    const request = { projectId: project.id }
    if (destination === 'visual' && visualCss) {
      void window.responsiver.previewRemoteVisualStyle({ ...request, visualEdits: visualHistory.present, route: activePath }).catch((error) => flash(error instanceof Error ? error.message : 'La preview CSS du localhost a échoué.'))
    } else {
      void window.responsiver.clearRemoteVisualStyle(request).catch(() => undefined)
    }
    return () => { void window.responsiver.clearRemoteVisualStyle(request).catch(() => undefined) }
  }, [activePath, destination, project?.id, project?.source.kind, visualCss, visualHistory.present])

  useEffect(() => {
    if (destination === 'visual' && !currentVisualRoutePersistent) setVisualRouteScope('all')
  }, [currentVisualRoutePersistent, destination])

  function flash(message: string): void {
    setNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4300)
  }

  function applyProject(snapshot: ProjectSnapshot, preserveQueuedIssues: readonly ProjectIssue[] = []): void {
    previewSequence.current += 1
    draftRevision.current += 1
    const next = snapshot as ProjectSnapshot & ProjectExtra
    const analyzedIssueIds = new Set(next.issues.map((issue) => issue.id))
    const uniquePreservedIssues = [...new Map(preserveQueuedIssues.map((issue) => [issue.id, issue])).values()]
    const pendingIssues = uniquePreservedIssues.filter((issue) => !analyzedIssueIds.has(issue.id) && runtimeIssueViewportKeys(issue).length > 0)
    const pendingIssueIds = new Set(pendingIssues.map((issue) => issue.id))
    const revalidatedQueuedIssues = uniquePreservedIssues.filter((issue) => analyzedIssueIds.has(issue.id) || pendingIssueIds.has(issue.id))
    const displayedNext = pendingIssues.length ? { ...next, issues: [...next.issues, ...pendingIssues] } : next
    queuedIssuesAwaitingAudit.current = new Map(pendingIssues.map((issue) => [issue.id, issue]))
    queuedViewportsAwaitingAudit.current = new Map(pendingIssues.map((issue) => [issue.id, new Set(runtimeIssueViewportKeys(issue))]))
    activeProjectId.current = displayedNext.id
    activeProjectSnapshot.current = displayedNext
    localSourceIssues.current = next.source.kind === 'local-project' ? [...next.issues] : []
    localRuntimeAudits.current.clear()
    setProject(displayedNext)
    setStaging(null)
    setMatrixResult(null)
    setMatrixProgress(null)
    setMatrixBusy(false)
    setMatrixScenario(null)
    setExpressVerification(null)
    setProposal(null)
    setProposalContext(null)
    setPreviewMode('source')
    setActivePath(next.entryPath ?? next.routes[0]?.path ?? '/')
    setRuntimeTheme('unknown')
    setSelectedIssueId(displayedNext.issues[0]?.id ?? null)
    setSelectedIssueIds([])
    setQueuedIssueIds(revalidatedQueuedIssues.map((issue) => issue.id))
    setShowAllIssues(false)
    setThemeTarget(null)
    setPreviewThemeTarget(null)
    setInstructions([])
    setMessages([{ id: 'welcome', author: 'system', text: 'Décrivez un ajustement précis. Responsiver applique uniquement les règles locales qu’il sait interpréter et vous montre le résultat avant export.' }])
    setDraft('')
    setRuntimeAudit(null)
    setRuntimeRenderStatus(null)
    setRemoteAudit(null)
    remoteAudits.current.clear()
    setRemoteState(null)
    setWorkspaceOrigin(null)
    setInspectorTab('findings')
    setLabMode('device')
    setVisualMode(next.source.kind === 'local-project' ? 'compose' : 'select')
    setVisualScope({ kind: 'mobile' })
    setVisualRouteScope('current')
    setVisualMultipleConfirmed(false)
    visualGestureCheckpoints.current.clear()
    visualKeyRevisionsRef.current.clear()
    visualMutationSequenceRef.current = 0
    const emptyVisualHistory = { past: [], present: [], future: [] }
    visualHistoryRef.current = emptyVisualHistory
    setVisualHistory(emptyVisualHistory)
    setInspectorLocation(null)
    setInspectorPhase('idle')
    setInspectedElement(null)
    setStageFullscreen(false)
    setPreviewBusy(false)
    setUndoAvailable(false)
    const readiness = next.previewReadiness?.status ?? 'ready'
    setDestination(readiness === 'blocked' || readiness === 'needs-build' ? 'projects' : 'lab')
  }

  async function openWith(action: () => Promise<ProjectSnapshot | null>, success: string): Promise<void> {
    setBusy(true)
    try {
      const snapshot = await action()
      if (snapshot) {
        applyProject(snapshot)
        const next = snapshot as ProjectSnapshot & ProjectExtra
        await refreshRecentProjects()
        if (next.previewReadiness?.status === 'blocked') flash(next.previewReadiness.summary)
        else if (next.previewReadiness?.status === 'needs-build') flash('Ce projet doit être compilé localement avant de pouvoir être prévisualisé fidèlement.')
        else flash(next.capabilities?.buildRequired ? 'Projet source détecté : pour un rendu fidèle, ouvrez son fichier HTML compilé dans dist ou out.' : success)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      flash(/récent|historique|plus accessible/i.test(detail)
        ? 'Cet ancien projet n’est plus accessible. Reconnectez son disque, téléchargez-le depuis iCloud ou retirez-le de l’historique.'
        : 'Impossible d’ouvrir ce projet. Vérifiez le chemin et ses droits d’accès.')
    } finally {
      setBusy(false)
      setPreparation(null)
    }
  }

  async function openPath(path = projectPath): Promise<void> {
    const value = path.trim()
    if (!value) { flash('Indiquez un fichier ou un dossier local.'); return }
    await openWith(() => window.responsiver.openProjectPath(value), 'Projet analysé et servi localement.')
  }

  async function openRemote(mode: 'public' | 'localhost'): Promise<void> {
    const url = (mode === 'public' ? publicUrl : localhostUrl).trim()
    if (!url) { flash('Indiquez une URL à ouvrir.'); return }
    setBusy(true)
    try {
      const snapshot = await window.responsiver.openRemoteUrl({ url, mode, linkedRoot: mode === 'localhost' ? localhostRoot.trim() || null : null })
      applyProject(snapshot)
      flash(mode === 'public' ? 'URL publique ouverte en lecture seule.' : snapshot.source.kind === 'linked-localhost' ? 'Localhost ouvert et associé à ses sources.' : 'Localhost ouvert en lecture seule.')
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Cette URL ne peut pas être ouverte en sécurité.')
    } finally {
      setBusy(false)
      setPreparation(null)
    }
  }

  async function chooseLocalhostRoot(): Promise<void> {
    try {
      const path = await window.responsiver.chooseLinkedRoot()
      if (path) setLocalhostRoot(path)
    } catch {
      flash('Le dossier source n’a pas pu être associé.')
    }
  }

  async function associateCurrentLocalhostRoot(): Promise<void> {
    if (!project || project.source.network !== 'localhost') return
    setBusy(true)
    try {
      const root = await window.responsiver.chooseLinkedRoot()
      if (!root) return
      const snapshot = await window.responsiver.associateRemoteRoot({ projectId: project.id, root })
      activeProjectId.current = snapshot.id
      activeProjectSnapshot.current = snapshot as ProjectSnapshot & ProjectExtra
      setProject(snapshot as ProjectSnapshot & ProjectExtra)
      setLocalhostRoot(root)
      setWorkspaceOrigin(null)
      flash('Dossier source associé. L’éditeur local est maintenant disponible.')
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Le dossier source n’a pas pu être associé à ce localhost.')
    } finally {
      setBusy(false)
    }
  }

  async function openRecentProject(id: string): Promise<void> {
    if (!api().openRecentProject) return
    await openWith(() => api().openRecentProject!(id), 'Projet réanalysé et prêt dans le laboratoire.')
  }

  async function forgetRecentProject(id: string): Promise<void> {
    if (!api().forgetRecentProject) return
    setForgettingRecentId(id)
    try {
      setRecentProjects(await api().forgetRecentProject!(id))
      flash('Le projet a été retiré de l’historique local. Ses fichiers n’ont pas été modifiés.')
    } catch {
      flash('Impossible de mettre à jour l’historique local.')
    } finally {
      setForgettingRecentId(null)
    }
  }

  function invalidateStaging(): void {
    draftRevision.current += 1
    setExpressVerification(null)
    setMatrixResult(null)
    setMatrixProgress(null)
    if (!staging) return
    setStaging(null)
    if (previewMode === 'staging') setPreviewMode('source')
    void api().clearStaging?.().catch(() => undefined)
  }

  const sameVisualPlan = (left: readonly VisualEditOperation[], right: readonly VisualEditOperation[]): boolean =>
    left.length === right.length && left.every((operation, index) => {
      const candidate = right[index]
      return Boolean(candidate) && visualEditOperationKey(operation) === visualEditOperationKey(candidate) && operation.after === candidate.after && operation.before === candidate.before
    })

  const visualTransitionKeys = (left: readonly VisualEditOperation[], right: readonly VisualEditOperation[]): string[] =>
    [...new Set([...left, ...right].map((operation) => visualEditOperationKey(operation)))]

  function replaceVisualHistory(next: VisualEditHistory, touchedKeys: readonly string[]): number {
    const revision = ++visualMutationSequenceRef.current
    for (const key of touchedKeys) visualKeyRevisionsRef.current.set(key, revision)
    visualHistoryRef.current = next
    setVisualHistory(next)
    return revision
  }

  function commitVisualOperations(next: VisualEditOperation[], touchedKeys?: readonly string[]): number | null {
    const current = visualHistoryRef.current
    if (sameVisualPlan(current.present, next)) return null
    invalidateStaging()
    const history = { past: [...current.past.slice(-49), current.present], present: next, future: [] }
    return replaceVisualHistory(history, touchedKeys ?? visualTransitionKeys(current.present, next))
  }

  function updateVisualProperty(property: VisualEditProperty, after: string): void {
    if (!inspectedElement || !visualAuthorization?.allowed) return
    try {
      const operation = createVisualEditOperation({
        target: {
          selector: inspectedElement.selector,
          metadata: {
            matchCount: inspectedElement.occurrences,
            selectionMode: inspectedElement.occurrences > 1 ? 'matching' : 'single',
            stable: !inspectedElement.selector.includes('>>>'),
            editable: inspectedElement.editable !== false,
            multipleConfirmed: visualMultipleConfirmed,
            insideShadowRoot: inspectedElement.selector.includes('>>>'),
            crossOrigin: Boolean(inspectedElement.insideFrame)
          }
        },
        property,
        before: inspectedElement.styles[property] ?? null,
        after,
        scope: visualScope,
        route: visualRouteScope === 'current' ? { kind: 'current', path: documentPath(activePath) } : { kind: 'all' }
      })
      const key = visualEditOperationKey(operation)
      const current = visualHistoryRef.current.present.filter((entry) => visualEditOperationKey(entry) !== key)
      if (operation.before !== operation.after) current.push(operation)
      commitVisualOperations(current, [key])
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Cette valeur ne peut pas être transformée en CSS sûr.')
    }
  }

  function commitVisualGesture(value: VisualGestureCommit): void {
    if (!visualAuthorization?.allowed) return
    try {
      const gesture = sanitizeVisualGestureCommit(value)
      if (!gesture) throw new Error('Ce geste ne peut pas être appliqué en toute sécurité.')
      const route = visualRouteScope === 'current' ? { kind: 'current' as const, path: documentPath(activePath) } : { kind: 'all' as const }
      const batch = visualGestureOperations(gesture, { scope: visualScope, route })
      const current = visualHistoryRef.current.present
      const next = mergeVisualGestureOperations(current, batch)
      const changes = visualGestureOperationChanges(current, next, batch)
      if (!changes.length || sameVisualPlan(current, next)) return
      const revision = commitVisualOperations(next, changes.map((change) => change.key))
      if (revision === null) return
      visualGestureCheckpoints.current.set(gesture.gestureId, { changes, revision })
      while (visualGestureCheckpoints.current.size > 200) {
        const oldestGestureId = visualGestureCheckpoints.current.keys().next().value
        if (!oldestGestureId) break
        visualGestureCheckpoints.current.delete(oldestGestureId)
      }
      const selected = gesture.mutations[0]?.target
      if (selected) setInspectedElement(selected)
      const retainedCount = next.filter((operation) => batch.some((candidate) => visualEditOperationKey(candidate) === visualEditOperationKey(operation))).length
      const message = retainedCount === 0
        ? 'Le réglage est revenu à sa valeur source ; la surcharge temporaire a été retirée.'
        : gesture.kind === 'reorder'
          ? `Ordre visuel préparé pour ${retainedCount} élément${retainedCount > 1 ? 's' : ''}. Testez aussi le clavier avant validation.`
        : gesture.kind === 'resize'
          ? 'Dimensions définies pour ce format. La règle CSS responsive est visible immédiatement ; passez en mode Tester pour vérifier le contenu.'
          : 'Placement libre défini pour ce format. La règle CSS responsive est visible immédiatement et reste modifiable.'
      flash(message)
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Ce geste ne peut pas être transformé en CSS responsive sûr.')
    }
  }

  function verifyVisualGesture(gestureId: string): void {
    visualGestureCheckpoints.current.delete(gestureId)
  }

  function rejectVisualGesture(gestureId: string, reason: string): void {
    if (!['layout-still-constrained', 'target-detached', 'invalid-css', 'css-too-large', 'preview-interrupted'].includes(reason)) return
    const checkpoint = visualGestureCheckpoints.current.get(gestureId)
    visualGestureCheckpoints.current.delete(gestureId)
    if (!checkpoint) return
    for (const laterCheckpoint of visualGestureCheckpoints.current.values()) {
      if (laterCheckpoint.revision <= checkpoint.revision) continue
      laterCheckpoint.changes = rebaseVisualGestureChangesAfterRejection(laterCheckpoint.changes, checkpoint.changes)
    }
    const eligible = checkpoint.changes.filter((change) => visualKeyRevisionsRef.current.get(change.key) === checkpoint.revision)
    if (!eligible.length) return
    const current = visualHistoryRef.current
    const compact = (plans: VisualEditOperation[][]): VisualEditOperation[][] => plans.filter((plan, index) => index === 0 || !sameVisualPlan(plan, plans[index - 1]!))
    const present = rollbackVisualGestureOperations(current.present, eligible)
    let past = compact(current.past.map((plan) => rollbackVisualGestureOperations(plan, eligible)))
    const future = compact(current.future.map((plan) => rollbackVisualGestureOperations(plan, eligible)))
    while (past.length && sameVisualPlan(past.at(-1)!, present)) past = past.slice(0, -1)
    if (sameVisualPlan(current.present, present) && current.past.length === past.length && current.future.length === future.length) return
    invalidateStaging()
    replaceVisualHistory({ past, present, future }, eligible.map((change) => change.key))
    for (const change of eligible) {
      let predecessorRevision = 0
      for (const pendingCheckpoint of visualGestureCheckpoints.current.values()) {
        if (pendingCheckpoint.revision >= checkpoint.revision || pendingCheckpoint.revision <= predecessorRevision) continue
        const predecessor = pendingCheckpoint.changes.find((candidate) => candidate.key === change.key)
        if (!predecessor || !sameVisualPlan(
          predecessor.after ? [predecessor.after] : [],
          change.before ? [change.before] : []
        )) continue
        predecessorRevision = pendingCheckpoint.revision
      }
      if (predecessorRevision) visualKeyRevisionsRef.current.set(change.key, predecessorRevision)
    }
  }

  function removeVisualOperation(id: string): void {
    const current = visualHistoryRef.current.present
    const removed = current.find((operation) => operation.id === id)
    const next = current.filter((operation) => operation.id !== id)
    if (removed) commitVisualOperations(next, [visualEditOperationKey(removed)])
  }

  function undoVisualEdit(): void {
    const current = visualHistoryRef.current
    if (!current.past.length) return
    const previous = current.past.at(-1)
    if (!previous) return
    invalidateStaging()
    replaceVisualHistory(
      { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future].slice(0, 50) },
      visualTransitionKeys(current.present, previous)
    )
  }

  function redoVisualEdit(): void {
    const current = visualHistoryRef.current
    if (!current.future.length) return
    const next = current.future[0]
    if (!next) return
    invalidateStaging()
    replaceVisualHistory(
      { past: [...current.past.slice(-49), current.present], present: next, future: current.future.slice(1) },
      visualTransitionKeys(current.present, next)
    )
  }

  function clearVisualEdits(): void {
    const current = visualHistoryRef.current.present
    if (!current.length) return
    commitVisualOperations([], current.map((operation) => visualEditOperationKey(operation)))
  }

  async function prepareVisualChanges(openReview = false): Promise<StagingSnapshot | null> {
    const visualEdits = visualHistoryRef.current.present
    if (!visualEdits.length) { flash('Sélectionnez un élément puis effectuez au moins un ajustement.'); return null }
    if (compiledVisualEdits.invalid.length || compiledVisualEdits.conflicts.length) {
      flash('Le plan visuel contient une valeur invalide ou deux changements incompatibles. Corrigez les lignes signalées avant de continuer.')
      return null
    }
    const result = await buildStaging({ issueIds: [], themeTarget: null, instructions: [], visualEdits })
    if (result && openReview && project?.source.kind === 'local-project') setDestination('review')
    return result
  }

  async function applyVisualChanges(): Promise<void> {
    if (!visualAuthorization?.persistable) {
      const result = await prepareVisualChanges(false)
      if (!result) return
      setDestination('export')
      flash('La feuille visuelle est prête. Choisissez son format de livraison dans Exporter.')
      return
    }
    await applyPlanToSource(
      { issueIds: [], themeTarget: null, instructions: [], visualEdits: visualHistory.present },
      `${visualHistory.present.length} ajustement${visualHistory.present.length > 1 ? 's visuels appliqués' : ' visuel appliqué'} au projet puis réanalysé.`
    )
  }

  async function requestProposal(request: { issueIds: string[]; themeTarget: ThemeTarget | null; instructions: string[]; visualEdits?: VisualEditOperation[] }, context: ProposalContext, mode: PreviewMode): Promise<StagingSnapshot | null> {
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
    } catch (error) {
      if (sequence === previewSequence.current) flash(actionError(error, 'La proposition n’a pas pu être prévisualisée. Aucun choix n’a été validé.'))
      return null
    } finally {
      if (sequence === previewSequence.current) setPreviewBusy(false)
    }
  }

  async function discardProposal(message = 'La proposition a été écartée. Aucun choix n’a été ajouté au plan.', returnMode: PreviewMode = 'source'): Promise<void> {
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

  function discardNoopProposal(result: StagingSnapshot): boolean {
    if (result.changes.length > 0) return false
    const outcomes = result.outcomes ?? []
    const alreadyCovered = outcomes.length > 0 && outcomes.every((outcome) => outcome.status === 'skipped' && /déjà|existe|couverte|identique regroupée/i.test(outcome.reason))
    if (!alreadyCovered) {
      const reasons = [...new Set(outcomes.map((outcome) => outcome.reason).filter(Boolean))]
      flash(reasons.length ? `Aucun changement applicable : ${reasons.join(' · ')}` : 'Aucun changement applicable n’a été produit. Consultez le constat avant de l’écarter ou de le reformuler.')
      return false
    }
    previewSequence.current += 1
    setProposal(null)
    setPreviewMode('source')
    if (result.previewOrigin) void api().clearPreviewStaging?.(result.previewOrigin).catch(() => undefined)
    flash('Ce correctif est déjà couvert par la version actuelle. Aucun nouveau changement n’est nécessaire.')
    return true
  }

  async function previewIssue(issue: ProjectIssue): Promise<void> {
    const extra = issue as ProjectIssue & IssueExtra
    const policy = classifyProjectIssue(issue, project?.issues)
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
    if (isRemote) {
      setProposalContext({ kind: 'issue', issueId: issue.id })
      setPreviewMode('source')
      const route = extra.routePath ?? issue.evidence?.route
      if (route && route !== remoteState?.path && project?.source.url) {
        try {
          const target = new URL(route, project.source.url).href
          const state = await window.responsiver.navigateRemote('url', target)
          setRemoteState(state)
          setActivePath(state.path)
          const previousAudit = remoteAudits.current.get(state.path)
          if (previousAudit) setRemoteAudit(previousAudit)
        } catch {
          flash('La route du constat n’a pas pu être restaurée dans la session sécurisée.')
          return
        }
      }
      const selector = issue.evidence?.selector
      const focus = selector ? await window.responsiver.focusRemoteFinding(selector).catch(() => null) : null
      flash(!selector
        ? 'La route et le viewport du constat sont affichés.'
        : focus?.found
          ? 'Route et viewport restaurés ; l’élément mesuré est mis en évidence.'
          : 'La route et le viewport sont restaurés, mais l’élément a changé ou n’existe plus dans le DOM actuel.')
      return
    }
    const runtimeInstruction = deterministicInstructionForIssue(issue)
    if (policy.action !== 'advisory' && labCorrectionAvailable && runtimeInstruction && (!extra.fix || extra.fix.kind === 'manual')) {
      const result = await requestProposal(
        { issueIds: [], themeTarget: null, instructions: [runtimeInstruction] },
        { kind: 'instruction', instruction: runtimeInstruction, issueId: issue.id },
        'before-after'
      )
      if (result && discardNoopProposal(result)) return
      if (result && !result.changes.length) return
      if (result) flash('Une correction CSS prudente est affichée en avant / après. Elle reste à réviser et à valider explicitement.')
      return
    }
    if (policy.action === 'advisory' || !labCorrectionAvailable || !extra.fix || extra.fix.kind === 'manual') {
      const expectedOrigin = proposal?.previewOrigin ?? null
      previewSequence.current += 1
      setPreviewBusy(false)
      setProposalContext({ kind: 'issue', issueId: issue.id })
      setProposal(null)
      setPreviewMode('source')
      if (expectedOrigin) void api().clearPreviewStaging?.(expectedOrigin).catch(() => undefined)
      flash(project?.source.kind === 'linked-localhost'
        ? 'Le localhost reste auditable. Ce constat n’a pas de transformation automatique fiable : ouvrez sa source associée pour l’ajuster avec le rendu réel.'
        : !labCorrectionAvailable
          ? 'Ce projet ne possède pas encore de layout exploitable : le constat reste consultable, sans générer de faux correctif.'
        : 'Ce constat demande une vérification manuelle : la source concernée est affichée sans faux correctif.')
      return
    }
    const verificationMode: PreviewMode = policy.verification === 'source-diff' ? 'proposal' : 'before-after'
    const result = await requestProposal({ issueIds: [issue.id], themeTarget: null, instructions: [] }, { kind: 'issue', issueId: issue.id }, verificationMode)
    if (result && discardNoopProposal(result)) return
    if (result && !result.changes.length) return
    if (result) flash(verificationMode === 'before-after'
      ? 'Avant et après sont synchronisés sur la zone concernée. Validez ou écartez ce correctif depuis le constat.'
      : 'Le changement de code est prêt à être relu avant validation.')
  }

  async function previewQueuedIssues(issueIds: readonly string[] = queuedIssueIds): Promise<void> {
    if (!project) return
    if (!labCorrectionAvailable) { flash('La comparaison de correctifs exige un projet local modifiable avec ses sources liées.'); return }
    const requested = [...new Set(issueIds)]
      .map((id) => project.issues.find((issue) => issue.id === id))
      .filter((issue): issue is ProjectIssue => Boolean(issue))
      .filter((issue) => {
        const policy = classifyProjectIssue(issue, project.issues)
        return policy.action !== 'advisory' && Boolean(deterministicInstructionForIssue(issue) || issue.fix && issue.fix.kind !== 'manual')
      })
    if (!requested.length) {
      flash('Sélectionnez au moins un constat prévisualisable.')
      return
    }
    const first = requested[0]
    setSelectedIssueId(first.id)
    const extra = first as ProjectIssue & IssueExtra
    if (extra.routePath) setActivePath(extra.routePath)
    const issueDevice = deviceForIssue(first, currentDevice)
    if (issueDevice) {
      setFamily(issueDevice.family)
      setWidth(String(issueDevice.width))
      setHeight(String(issueDevice.height))
      setDeviceId('custom')
    }
    const batch = changePlanForIssues(requested)
    const policies = requested.map((issue) => classifyProjectIssue(issue, project.issues))
    const mode: PreviewMode = policies.every((policy) => policy.verification === 'source-diff') ? 'proposal' : 'before-after'
    if (mode === 'before-after') {
      setLabMode('device')
      setInspectorLocation(null)
      setInspectorPhase('idle')
      setInspectedElement(null)
    }
    const result = await requestProposal(
      { issueIds: batch.issueIds, themeTarget: null, instructions: batch.instructions },
      { kind: 'batch', issueIds: requested.map((issue) => issue.id) },
      mode
    )
    if (result && discardNoopProposal(result)) return
    if (result && !result.changes.length) return
    if (result) flash(`${requested.length} correctif${requested.length > 1 ? 's sont' : ' est'} réuni${requested.length > 1 ? 's' : ''} dans une comparaison temporaire. Validez la sélection pour la conserver.`)
  }

  async function previewTheme(target: ThemeTarget): Promise<void> {
    if (!project) return
    if (!labCorrectionAvailable) { flash('Rendez d’abord le layout local exploitable avant de prévisualiser une variante de thème.'); return }
    const alreadyPresent = project.theme.detected === 'dual' || project.theme.detected === target || (target === 'dark' ? project.theme.hasDark : project.theme.hasLight)
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

  function planForProposalContext(context: ProposalContext, snapshot: StagingSnapshot | null = proposal): ChangePlanRequest {
    const request: ChangePlanRequest = { issueIds: [], themeTarget: null, instructions: [], visualEdits: [] }
    const issueWasApplied = (issueId: string): boolean => !snapshot?.outcomes?.length || snapshot.outcomes.some((outcome) => outcome.status === 'applied' && (outcome.proposalId === issueId || outcome.findingIds.includes(issueId)))
    const instructionWasApplied = (instruction: string): boolean => {
      if (snapshot?.recognizedInstructions) return snapshot.recognizedInstructions.includes(instruction)
      if (snapshot?.ignoredInstructions?.includes(instruction)) return false
      return true
    }
    if (context.kind === 'issue' && context.issueId && issueWasApplied(context.issueId)) request.issueIds.push(context.issueId)
    if (context.kind === 'batch' && context.issueIds?.length && project) {
      const issues = context.issueIds
        .map((id) => project.issues.find((issue) => issue.id === id))
        .filter((issue): issue is ProjectIssue => Boolean(issue))
      const batch = changePlanForIssues(issues)
      request.issueIds.push(...batch.issueIds.filter(issueWasApplied))
      request.instructions.push(...batch.instructions.filter(instructionWasApplied))
    }
    if (context.kind === 'theme' && context.themeTarget && snapshot?.themeTarget === context.themeTarget) request.themeTarget = context.themeTarget
    if (context.kind === 'instruction' && context.instruction && instructionWasApplied(context.instruction)) request.instructions.push(context.instruction)
    return request
  }

  function planIncludingProposal(): ChangePlanRequest | null {
    if (!proposal || !proposalContext || !proposal.changes.length) return null
    const proposalPlan = planForProposalContext(proposalContext, proposal)
    const next: ChangePlanRequest = {
      issueIds: [...selectedIssueIds],
      themeTarget,
      instructions: [...instructions],
      visualEdits: [...visualHistory.present]
    }
    next.issueIds = [...new Set([...next.issueIds, ...proposalPlan.issueIds])]
    next.instructions = [...new Set([...next.instructions, ...proposalPlan.instructions])]
    if (proposalPlan.themeTarget) next.themeTarget = proposalPlan.themeTarget
    return next
  }

  function retainPlan(request: ChangePlanRequest): void {
    setSelectedIssueIds(request.issueIds)
    setThemeTarget(request.themeTarget)
    setInstructions(request.instructions)
  }

  function acceptProposal(): void {
    const next = planIncludingProposal()
    if (!next) return
    const acceptedProposalPlan = proposalContext ? planForProposalContext(proposalContext, proposal) : null
    invalidateStaging()
    retainPlan(next)
    const contextualIssueIds = proposalContext?.kind === 'batch' ? proposalContext.issueIds ?? [] : proposalContext?.issueId ? [proposalContext.issueId] : []
    if (contextualIssueIds.length) setQueuedIssueIds((current) => current.filter((id) => !contextualIssueIds.includes(id)))
    if (proposalContext?.kind === 'theme') {
      flash('Variante validée et ajoutée au plan. Préparez la version corrigée pour la réviser ou l’exporter.')
    } else if (proposalContext?.kind === 'batch') {
      const retainedCount = project && acceptedProposalPlan
        ? contextualIssueIds
          .map((id) => project.issues.find((issue) => issue.id === id))
          .filter((issue): issue is ProjectIssue => Boolean(issue))
          .filter((issue) => issueIsRetained(issue, acceptedProposalPlan.issueIds, acceptedProposalPlan.instructions)).length
        : 0
      const skippedCount = Math.max(0, contextualIssueIds.length - retainedCount)
      flash(`${retainedCount} correctif${retainedCount > 1 ? 's validés' : ' validé'} et ajouté${retainedCount > 1 ? 's' : ''} au plan${skippedCount ? ` · ${skippedCount} écarté${skippedCount > 1 ? 's' : ''} car aucune transformation fiable n’a été produite` : ''}.`)
    } else if (proposalContext?.kind === 'instruction' && !proposalContext.issueId) {
      setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: 'Ajustement validé et ajouté au plan de correctifs. Le projet source reste intact.' }])
      flash('Ajustement validé. Préparez la version corrigée depuis Correctifs pour le réviser ou l’exporter.')
    } else {
      flash('Correctif validé et ajouté au plan. Le projet source reste intact tant que vous ne l’appliquez pas.')
    }
  }

  function rejectProposal(): void {
    const proposalPlan = proposalContext ? planForProposalContext(proposalContext, proposal) : null
    const proposalItemCount = (proposalPlan?.issueIds.length ?? 0) + (proposalPlan?.instructions.length ?? 0) + (proposalPlan?.themeTarget ? 1 : 0)
    const proposalFullyRetained = Boolean(proposalPlan && proposalItemCount > 0 && proposalPlan.issueIds.every((id) => selectedIssueIds.includes(id)) && proposalPlan.instructions.every((instruction) => instructions.includes(instruction)) && (!proposalPlan.themeTarget || proposalPlan.themeTarget === themeTarget))
    const removedIssueIds = proposalFullyRetained ? proposalPlan?.issueIds ?? [] : []
    const removedInstructions = proposalFullyRetained ? proposalPlan?.instructions ?? [] : []
    const removesTheme = Boolean(proposalFullyRetained && proposalPlan?.themeTarget)
    const changesDraft = removedIssueIds.length > 0 || removedInstructions.length > 0 || removesTheme
    const keepStaging = Boolean(staging && !changesDraft)
    if (removedIssueIds.length) setSelectedIssueIds((current) => current.filter((id) => !removedIssueIds.includes(id)))
    if (removesTheme) setThemeTarget(null)
    if (removedInstructions.length) setInstructions((current) => current.filter((value) => !removedInstructions.includes(value)))
    const contextIssueIds = proposalContext?.kind === 'batch' ? proposalContext.issueIds ?? [] : proposalContext?.issueId ? [proposalContext.issueId] : []
    const batchSelectionStillMatches = proposalContext?.kind !== 'batch' || contextIssueIds.length === queuedIssueIds.length && queuedIssueIds.every((id) => contextIssueIds.includes(id))
    if (contextIssueIds.length && !changesDraft && batchSelectionStillMatches) setQueuedIssueIds((current) => current.filter((id) => !contextIssueIds.includes(id)))
    if (changesDraft) invalidateStaging()
    void discardProposal(changesDraft ? 'La proposition et sa validation ont été retirées du plan.' : undefined, keepStaging ? 'staging' : 'source')
  }

  async function buildStaging(request: ChangePlanRequest = { issueIds: selectedIssueIds, themeTarget, instructions, visualEdits: visualHistory.present }): Promise<StagingSnapshot | null> {
    if (!project) return null
    if (!stagingAvailable) { flash('Ce projet ne possède pas de sources locales modifiables et exploitables pour préparer une correction.'); return null }
    if (!api().buildStaging) { flash('Le moteur de préparation sera disponible dans l’application desktop.'); return null }
    const requestedRevision = draftRevision.current
    const requestedProjectId = project.id
    setExpressVerification(null)
    setBusy(true)
    try {
      const result = await api().buildStaging!(request)
      if (requestedRevision !== draftRevision.current || requestedProjectId !== activeProjectId.current) {
        await api().clearStaging?.().catch(() => undefined)
        flash('Le plan a changé pendant la préparation. La version obsolète a été supprimée ; relancez la révision.')
        return null
      }
      setStaging(result)
      setProposal(null)
      setProposalContext(null)
      setPreviewThemeTarget(null)
      setPreviewMode('staging')
      flash(`${result.changes.length} modification${result.changes.length > 1 ? 's' : ''} préparée${result.changes.length > 1 ? 's' : ''} sans toucher aux sources.`)
      return result
    } catch (error) {
      flash(actionError(error, 'La version corrigée n’a pas pu être préparée. Aucun fichier source n’a été modifié.'))
      return null
    } finally { setBusy(false) }
  }

  async function refreshProjectAfterSourceWrite(snapshotBeforeWrite: ProjectSnapshot & ProjectExtra, pathBeforeWrite: string, queuedIssuesToPreserve: readonly ProjectIssue[]): Promise<boolean> {
    if (snapshotBeforeWrite.source.kind !== 'local-project') return false
    try {
      const refreshed = await window.responsiver.reanalyzeCurrentProject()
      applyProject(refreshed, queuedIssuesToPreserve)
      if (refreshed.routes.some((route) => route.path === pathBeforeWrite)) setActivePath(pathBeforeWrite)
      return true
    } catch {
      localRuntimeAudits.current.clear()
      setRuntimeAudit(null)
      return false
    }
  }

  async function writePreparedStagingToSource(prepared: StagingSnapshot, message: string, appliedQueuedIssueIds: readonly string[] = []): Promise<boolean> {
    if (!project || project.source.kind !== 'local-project' || project.source.readOnly || !api().applyStagingToSource) {
      flash('L’application directe exige un projet local modifiable. La révision et l’export restent disponibles.')
      return false
    }
    const conflicts = prepared.outcomes?.filter((outcome) => outcome.status === 'conflict') ?? []
    if (conflicts.length) {
      flash(`${conflicts.length} proposition${conflicts.length > 1 ? 's sont incompatibles' : ' est incompatible'} avec une autre. Retirez l’une des corrections signalées avant de les appliquer.`)
      return false
    }
    if (!prepared.changes.length) {
      flash('La version révisée ne contient aucun changement à appliquer.')
      return false
    }
    const projectBeforeWrite = project
    const pathBeforeWrite = activePath
    const appliedIssueIds = new Set([
      ...appliedQueuedIssueIds,
      ...(prepared.outcomes ?? []).filter((outcome) => outcome.status === 'applied').flatMap((outcome) => outcome.findingIds)
    ])
    const queuedIssuesToPreserve = queuedIssueIds
      .filter((id) => !appliedIssueIds.has(id))
      .map((id) => project.issues.find((issue) => issue.id === id))
      .filter((issue): issue is ProjectIssue => Boolean(issue))
    setBusy(true)
    fastApplyInFlight.current = true
    try {
      const result = await api().applyStagingToSource!()
      setStaging(null)
      setProposal(null)
      setProposalContext(null)
      setPreviewMode('source')
      const refreshed = await refreshProjectAfterSourceWrite(projectBeforeWrite, pathBeforeWrite, queuedIssuesToPreserve)
      setUndoAvailable(Boolean((result as { undoAvailable?: boolean } | null)?.undoAvailable ?? true))
      flash(refreshed
        ? message
        : 'Les fichiers ont bien été appliqués et restent annulables, mais la réanalyse automatique a échoué. Rouvrez le projet pour actualiser les constats.')
      return true
    } catch (error) {
      flash(actionError(error, 'L’application directe a échoué. La version préparée reste disponible et aucune modification partielle n’a été conservée.'))
      return false
    } finally {
      fastApplyInFlight.current = false
      setBusy(false)
    }
  }

  async function applyPlanToSource(request: ChangePlanRequest, message: string, appliedQueuedIssueIds: readonly string[] = []): Promise<boolean> {
    if (!project || project.source.kind !== 'local-project' || project.source.readOnly || !api().applyStagingToSource) {
      flash('L’application directe exige un projet local modifiable. La révision et l’export restent disponibles.')
      return false
    }
    invalidateStaging()
    const prepared = await buildStaging(request)
    if (!prepared) return false
    retainPlan(request)
    return writePreparedStagingToSource(prepared, message, appliedQueuedIssueIds)
  }

  async function acceptAndApplyProposal(): Promise<void> {
    if (!project || !proposal || !proposalContext || !proposal.changes.length) return
    const next = planIncludingProposal()
    if (!next) return
    const contextIssueIds = proposalContext.kind === 'batch' ? proposalContext.issueIds ?? [] : proposalContext.issueId ? [proposalContext.issueId] : []
    const acceptedProposalPlan = planForProposalContext(proposalContext, proposal)
    const acceptedQueuedIssueIds = contextIssueIds.filter((id) => {
      if (acceptedProposalPlan.issueIds.includes(id)) return true
      const instruction = deterministicInstructionForIssue(project.issues.find((issue) => issue.id === id))
      return Boolean(instruction && acceptedProposalPlan.instructions.includes(instruction))
    })
    const appliedCount = next.issueIds.length + next.instructions.length + (next.visualEdits?.length ?? 0) + (next.themeTarget ? 1 : 0)
    await applyPlanToSource(next, `${appliedCount} correctif${appliedCount > 1 ? 's appliqués' : ' appliqué'} au projet puis réanalysé. Vous pouvez encore annuler cette application.`, acceptedQueuedIssueIds)
  }

  async function applyQueuedSafeIssues(issueIds: string[]): Promise<void> {
    if (!project) return
    const expressIds = issueIds.filter((id) => {
      const issue = project.issues.find((candidate) => candidate.id === id)
      return issue && isExpressEligibleIssue(issue, project.issues)
    })
    if (!expressIds.length) { flash('Aucune correction vérifiable en mode Express n’est sélectionnée.'); return }
    const next: ChangePlanRequest = { issueIds: [...new Set(expressIds)], themeTarget: null, instructions: [], visualEdits: [] }
    invalidateStaging()
    const prepared = await buildStaging(next)
    if (!prepared) return
    retainPlan(next)
    setMatrixBusy(true)
    setMatrixProgress(null)
    try {
      const result = await window.responsiver.verifyStaging({ projectId: project.id, issueIds: expressIds })
      setMatrixResult(result.matrix)
      setExpressVerification({ issueIds: expressIds, token: result.verificationToken, result })
      if (result.report.status === 'passed') {
        flash(`${result.report.comparableCells} vues vérifiées sans régression. Le correctif exact est prêt à être appliqué.`)
        setInspectorTab('fixes')
      } else {
        setDestination('matrix')
        flash(result.report.status === 'blocked' ? 'Une régression a été détectée : aucune source n’a été modifiée.' : 'La preuve est incomplète : ouvrez les détails avant toute application.')
      }
    } catch (error) {
      flash(actionError(error, 'La vérification anti-régression n’a pas pu aboutir. Les sources restent intactes.'))
    } finally {
      setMatrixBusy(false)
    }
  }

  async function applyExpressVerification(): Promise<void> {
    if (!project || !staging || !expressVerification?.token) return
    const projectBeforeWrite = project
    const pathBeforeWrite = activePath
    const appliedIds = new Set(expressVerification.issueIds)
    const queuedIssuesToPreserve = queuedIssueIds
      .filter((id) => !appliedIds.has(id))
      .map((id) => project.issues.find((issue) => issue.id === id))
      .filter((issue): issue is ProjectIssue => Boolean(issue))
    setBusy(true)
    fastApplyInFlight.current = true
    try {
      const result = await window.responsiver.applyVerifiedStaging(expressVerification.token)
      setStaging(null)
      setProposal(null)
      setProposalContext(null)
      setExpressVerification(null)
      setPreviewMode('source')
      const refreshed = await refreshProjectAfterSourceWrite(projectBeforeWrite, pathBeforeWrite, queuedIssuesToPreserve)
      setUndoAvailable(result.undoAvailable)
      flash(refreshed
        ? `Correctif vérifié appliqué à ${result.paths.length} fichier${result.paths.length > 1 ? 's' : ''}. Vous pouvez encore annuler cette application.`
        : 'Le correctif vérifié a été appliqué, mais la réanalyse automatique a échoué. Vous pouvez encore annuler.')
    } catch (error) {
      setExpressVerification(null)
      flash(actionError(error, 'La version ou ses sources ont changé depuis la vérification. Aucune écriture partielle n’a été conservée.'))
    } finally {
      fastApplyInFlight.current = false
      setBusy(false)
    }
  }

  async function runMatrix(compare: boolean): Promise<void> {
    if (!project) return
    if (compare && !staging) { flash('Préparez d’abord une version corrigée depuis Révision.'); return }
    setMatrixBusy(true)
    setMatrixProgress(null)
    try {
      const result = await window.responsiver.runMatrix({
        projectId: project.id,
        mode: compare ? 'compare' : 'source',
        deviceIds: ['mobile', 'tablet', 'desktop'],
        states: ['initial', 'navigation-open']
      })
      setMatrixResult(result)
      flash(result.report?.status === 'passed' ? 'La version préparée ne crée aucune régression détectable.' : `Matrice terminée : ${result.source.observations.length} vues mesurées.`)
    } catch (error) {
      flash(actionError(error, 'La matrice n’a pas pu terminer toutes ses vues.'))
    } finally {
      setMatrixBusy(false)
    }
  }

  function openMatrixCell(observation: MatrixObservation): void {
    const job = observation.job
    const replayableState = job.state === 'initial' || observation.scenario?.supported === true
    setActivePath(job.route)
    setWidth(String(job.width))
    setHeight(String(job.height))
    setFamily(job.width < 600 ? 'smartphone' : job.width < 1_100 ? 'tablet' : 'computer')
    setDeviceId('custom')
    setLabMode('device')
    setMatrixScenario(replayableState ? { route: job.route, state: job.state } : null)
    setDestination('lab')
    const stateLabel = job.state === 'navigation-open' ? 'navigation ouverte' : job.state === 'keyboard-focus' ? 'focus clavier' : 'état initial'
    flash(`${job.deviceName} · ${job.width} × ${job.height} · ${replayableState ? stateLabel : `${stateLabel} non applicable, vue initiale`} · ${job.route}`)
  }

  async function undoLastApply(): Promise<void> {
    if (!project || !undoAvailable || !api().undoLastStagingApply) return
    const projectBeforeUndo = project
    const pathBeforeUndo = activePath
    const queuedIssuesToPreserve = queuedIssueIds
      .map((id) => project.issues.find((issue) => issue.id === id))
      .filter((issue): issue is ProjectIssue => Boolean(issue))
    setBusy(true)
    fastApplyInFlight.current = true
    try {
      await api().undoLastStagingApply!()
      setStaging(null)
      setProposal(null)
      setProposalContext(null)
      setPreviewMode('source')
      const refreshed = await refreshProjectAfterSourceWrite(projectBeforeUndo, pathBeforeUndo, queuedIssuesToPreserve)
      setUndoAvailable(false)
      flash(refreshed
        ? 'La dernière application a été annulée et le projet a été réanalysé.'
        : 'La dernière application a bien été annulée, mais la réanalyse automatique a échoué. Rouvrez le projet pour actualiser les constats.')
    } catch (error) {
      flash(actionError(error, 'La dernière application n’a pas pu être annulée.'))
    } finally {
      fastApplyInFlight.current = false
      setBusy(false)
    }
  }

  async function clearStaging(): Promise<void> {
    try { await api().clearStaging?.() } catch { /* le serveur sera remplacé à la prochaine construction */ }
    setStaging(null)
    setExpressVerification(null)
    setMatrixResult(null)
    setMatrixProgress(null)
    setPreviewMode('source')
    flash('La version corrigée a été supprimée. Les sources restent intactes.')
  }

  async function prepareAndOpenReview(): Promise<void> {
    if (!project || project.source.kind !== 'local-project') {
      flash('La révision combinée exige un projet local.')
      return
    }
    const prepared = staging ?? await buildStaging()
    if (prepared) setDestination('review')
  }

  async function applyApprovedPlan(): Promise<void> {
    if (!staging) {
      flash('Préparez puis relisez la version corrigée avant de l’appliquer.')
      return
    }
    const appliedCount = staging.changes.length
    await writePreparedStagingToSource(staging, `${appliedCount} changement${appliedCount > 1 ? 's appliqués' : ' appliqué'} exactement comme révisé, puis projet réanalysé. Vous pouvez annuler cette application.`)
  }

  async function submitInstruction(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!labCorrectionAvailable) { flash('Rendez d’abord le layout local exploitable avant de proposer un ajustement.'); return }
    const value = draft.trim()
    if (!value) return
    setMessages((current) => [...current, { id: `u-${Date.now()}`, author: 'user', text: value }])
    setDraft('')
    if (!api().previewStaging) {
      setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: 'La prévisualisation locale de cette instruction est disponible dans l’application desktop.' }])
      return
    }
    const result = await requestProposal({ issueIds: [], themeTarget: null, instructions: [value] }, { kind: 'instruction', instruction: value }, 'proposal')
    if (!result) {
      setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: 'La proposition n’a pas pu être préparée. Aucun changement n’a été ajouté au plan.' }])
      return
    }
    const alreadyCovered = result.changes.length === 0 && Boolean(result.outcomes?.some((outcome) => outcome.status === 'skipped' && /déjà|existe|couverte/i.test(outcome.reason)))
    if (alreadyCovered) {
      discardNoopProposal(result)
      setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: 'Ajustement reconnu, mais déjà couvert par la version actuelle. Aucun doublon n’a été créé.' }])
      return
    }
    const recognized = result.changes.length > 0
    setMessages((current) => [...current, { id: `s-${Date.now()}`, author: 'system', text: recognized ? 'Ajustement interprété et affiché en proposition. Validez-le explicitement ci-dessous avant de préparer la version corrigée.' : 'Je n’ai pas reconnu de règle locale sûre. Reformulez avec une couleur, un espacement, un rayon ou une taille de texte précise.' }])
  }

  async function copyPatch(): Promise<void> {
    const text = staging?.patch || selectedIssueIds.map((id) => project?.issues.find((issue) => issue.id === id)?.proposal).filter(Boolean).join('\n\n') || '# Aucun changement préparé.\n'
    try {
      if (api().copyText) await api().copyText!(text)
      else await navigator.clipboard.writeText(text)
      flash('Le patch a été copié.')
    } catch { flash('La copie est indisponible dans ce contexte.') }
  }

  async function copyRemoteSummary(): Promise<void> {
    if (!project || !isRemote) return
    const text = [
      `# Rapport Responsiver — ${project.name}`,
      project.source.url ? `URL : ${project.source.url}` : '',
      `Routes auditées : ${remoteAudits.current.size}`,
      `Constats : ${project.issues.length}`,
      project.analysis.truncated ? 'Couverture : partielle (limite de sécurité atteinte)' : 'Couverture : mesures terminées sur les routes visitées',
      '',
      ...project.issues.flatMap((issue) => [
        `## ${issue.title}`,
        `Route : ${issue.routePath ?? issue.evidence?.route ?? '/'}`,
        `Viewport : ${issue.viewport}`,
        `Règle : ${issue.rule}`,
        issue.description,
        `Solution à vérifier : ${issue.proposal}`,
        ''
      ])
    ].join('\n')
    try {
      if (api().copyText) await api().copyText!(text)
      else await navigator.clipboard.writeText(text)
      flash('La synthèse de l’audit URL a été copiée.')
    } catch {
      flash('La synthèse n’a pas pu être copiée.')
    }
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
    if (next === 'visual' && (!project?.source.localRoot || project.source.readOnly || project.source.kind === 'remote-url')) {
      flash('L’Atelier visuel exige les sources du projet. Une URL sans code associé reste strictement en lecture seule.')
      return
    }
    if (next === 'review' && project?.source.kind !== 'local-project') {
      flash('La comparaison de la version corrigée exige un projet local. Le rapport URL reste disponible dans Exporter.')
      return
    }
    if (next === 'matrix' && project?.source.kind !== 'local-project') {
      flash('La matrice reproductible exige le runner local. Pour une URL ou un localhost, utilisez l’audit multi-format du Laboratoire.')
      return
    }
    if (next === 'visual') alignVisualDeviceWithScope(visualScope)
    if (next === 'code') setCodeLocation(selectedIssue?.source ? { file: selectedIssue.source.file, line: selectedIssue.source.line, column: null } : null)
    if ((next === 'lab' || next === 'code') && next !== destination) {
      setInspectorLocation(null)
      setInspectorPhase('idle')
      setInspectedElement(null)
    }
    if (next !== 'lab' && next !== 'code') {
      setInspectorLocation(null)
      setInspectorPhase('idle')
    }
    setDestination(next)
  }

  function toggleInspector(location: Exclude<InspectorLocation, null>): void {
    if (!project) return
    const opening = inspectorLocation !== location
    if (location === 'lab') {
      setLabMode('device')
      if (opening && previewMode === 'before-after') {
        setPreviewMode('source')
        flash('L’inspecteur cible la source. La comparaison avant/après reste disponible après la sélection.')
      }
    }
    setInspectedElement(null)
    setInspectorLocation(opening ? location : null)
    setInspectorPhase(opening ? 'starting' : 'idle')
  }

  function receiveInspectedElement(element: VisualElementSnapshot, phase: 'hover' | 'selected'): void {
    if (phase === 'selected') {
      setInspectedElement(element)
      setCascadeTrace(null)
      setCascadeLoading(!element.insideFrame && element.editable !== false)
      setVisualMultipleConfirmed(false)
      return
    }
    if (!inspectedElement) setInspectedElement(element)
  }

  function receiveCascadeTrace(trace: CascadeTrace): void {
    setCascadeTrace((current) => current?.selector === trace.selector && current.generatedAt > trace.generatedAt ? current : trace)
    setCascadeLoading(false)
  }

  function openCascadeSource(file: string, line: number | null, column: number | null): void {
    setCodeLocation({ file, line, column })
    setDestination('code')
    setInspectorLocation(null)
    setInspectorPhase('idle')
  }

  function selectFamily(next: DeviceFamily): void {
    const first = devices.find((device) => device.family === next)!
    setFamily(next)
    setDeviceId(first.id)
    setWidth(String(first.width))
    setHeight(String(first.height))
    setMatrixScenario(null)
  }

  function selectDevice(id: string): void {
    setDeviceId(id)
    const device = devices.find((candidate) => candidate.id === id)
    if (device) { setWidth(String(device.width)); setHeight(String(device.height)) }
    setMatrixScenario(null)
  }

  function alignVisualDeviceWithScope(scope: VisualEditScope): void {
    if (scope.kind === 'mobile' && currentDevice.width > 767) selectFamily('smartphone')
    if (scope.kind === 'tablet' && (currentDevice.width < 768 || currentDevice.width > 1024)) selectFamily('tablet')
  }

  function selectVisualScope(scope: VisualEditScope): void {
    setVisualScope(scope)
    alignVisualDeviceWithScope(scope)
  }

  function toggleAcceptedIssue(id: string): void {
    const issue = project?.issues.find((candidate) => candidate.id === id)
    const deterministicInstruction = deterministicInstructionForIssue(issue)
    const retainedAsInstruction = Boolean(deterministicInstruction && instructions.includes(deterministicInstruction))
    const retainedAsIssue = selectedIssueIds.includes(id)
    invalidateStaging()
    setSelectedIssueIds((current) => retainedAsIssue || retainedAsInstruction ? current.filter((item) => item !== id) : [...current, id])
    if (deterministicInstruction && retainedAsInstruction) setInstructions((current) => current.filter((instruction) => instruction !== deterministicInstruction))
    setQueuedIssueIds((current) => current.filter((item) => item !== id))
  }

  function toggleQueuedIssue(id: string): void {
    const issue = project?.issues.find((candidate) => candidate.id === id)
    if (!issue || classifyProjectIssue(issue, project?.issues).action === 'advisory') return
    setQueuedIssueIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
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
    if (path !== activePath) {
      setMatrixScenario(null)
      setInspectedElement(null)
      setVisualMultipleConfirmed(false)
    }
    setActivePath(path)
  }

  function applyRuntimeAudit(audit: RuntimeAudit, primary = true): void {
    if (primary) setRuntimeAudit(audit)
    const auditKey = `${audit.route}\u001f${audit.viewport.width}x${audit.viewport.height}`
    const newProfile = !localRuntimeAudits.current.has(auditKey)
    localRuntimeAudits.current.delete(auditKey)
    localRuntimeAudits.current.set(auditKey, audit)
    if (newProfile) setLocalAuditRevision((revision) => revision + 1)
    const canonicalProfiles = new Set(auditDevices.map((device) => `${device.width}x${device.height}`))
    const routeEntries = [...localRuntimeAudits.current.entries()].filter(([, entry]) => entry.route === audit.route)
    while (routeEntries.length > 6) {
      const removableIndex = routeEntries.findIndex(([, entry]) => !canonicalProfiles.has(`${entry.viewport.width}x${entry.viewport.height}`))
      const [removed] = routeEntries.splice(removableIndex >= 0 ? removableIndex : 0, 1)
      localRuntimeAudits.current.delete(removed[0])
    }
    while (localRuntimeAudits.current.size > 48) {
      const oldest = localRuntimeAudits.current.keys().next().value as string | undefined
      if (!oldest) break
      localRuntimeAudits.current.delete(oldest)
    }

    const runtimeIssues = consolidatedRuntimeIssues([...localRuntimeAudits.current.values()])
    const runtimeIssueIds = new Set(runtimeIssues.map((issue) => issue.id))
    const noLongerReportedIds: string[] = []
    for (const [id, pendingIssue] of queuedIssuesAwaitingAudit.current) {
      if (runtimeIssueIds.has(id)) {
        queuedIssuesAwaitingAudit.current.delete(id)
        queuedViewportsAwaitingAudit.current.delete(id)
        continue
      }
      const pendingRoute = pendingIssue.routePath ?? pendingIssue.evidence?.route
      const remainingViewports = queuedViewportsAwaitingAudit.current.get(id)
      if (pendingRoute && remainingViewports && documentPath(pendingRoute) === documentPath(audit.route)) {
        remainingViewports.delete(`${audit.viewport.width}x${audit.viewport.height}`)
      }
      if (remainingViewports?.size === 0) {
        queuedIssuesAwaitingAudit.current.delete(id)
        queuedViewportsAwaitingAudit.current.delete(id)
        noLongerReportedIds.push(id)
      }
    }
    if (noLongerReportedIds.length) {
      setQueuedIssueIds((current) => current.filter((id) => !noLongerReportedIds.includes(id)))
    }
    const deferredIssues = [...queuedIssuesAwaitingAudit.current.values()]

    setProject((current) => {
      if (!current || current.source.kind !== 'local-project') return current
      const currentIssueIds = new Set([...localSourceIssues.current, ...runtimeIssues].map((issue) => issue.id))
      const allIssues = [...localSourceIssues.current, ...runtimeIssues, ...deferredIssues.filter((issue) => !currentIssueIds.has(issue.id))]
      const projectIssues = allIssues.filter((issue) => !(issue.routePath ?? issue.evidence?.route))
      const routeGroups = new Map<string, ProjectIssue[]>()
      for (const issue of allIssues) {
        const route = issue.routePath ?? issue.evidence?.route
        if (!route) continue
        const group = routeGroups.get(route)
        if (group) group.push(issue)
        else routeGroups.set(route, [issue])
      }
      const routeOrder = [
        ...current.routes.map((route) => route.path),
        ...[...routeGroups.keys()].filter((route) => !current.routes.some((known) => known.path === route))
      ]
      const proposalIssueIds = proposalContext?.kind === 'batch' ? proposalContext.issueIds ?? [] : proposalContext?.issueId ? [proposalContext.issueId] : []
      const retainedIds = new Set([...selectedIssueIds, ...queuedIssueIds, ...proposalIssueIds])
      const nextIssues = allIssues.filter((issue) => retainedIds.has(issue.id))
      const selectedIds = new Set(nextIssues.map((issue) => issue.id))
      nextIssues.push(...prioritizedIssues(projectIssues.filter((issue) => !selectedIds.has(issue.id)), Math.min(12, Math.max(0, localIssueLimitTotal - nextIssues.length))))
      for (const issue of nextIssues) selectedIds.add(issue.id)
      for (const route of routeOrder) {
        const available = localIssueLimitTotal - nextIssues.length
        if (available <= 0) break
        const routeIssues = (routeGroups.get(route) ?? []).filter((issue) => !selectedIds.has(issue.id))
        const additions = prioritizedIssues(routeIssues, Math.min(localIssueLimitPerRoute, available))
        nextIssues.push(...additions)
        for (const issue of additions) selectedIds.add(issue.id)
      }
      const truncated = current.analysis.truncated || [...localRuntimeAudits.current.values()].some((entry) => entry.truncated) || nextIssues.length < allIssues.length
      const unchanged = current.issues.length === nextIssues.length && current.issues.every((issue, index) => issue.id === nextIssues[index]?.id && issue.description === nextIssues[index]?.description)
      if (unchanged && truncated === current.analysis.truncated) return current
      return {
        ...current,
        issues: nextIssues,
        analysis: { ...current.analysis, truncated }
      }
    })
  }

  function applyRemoteAudit(result: RemoteAuditResult): void {
    remoteAudits.current.set(result.path, result)
    setRemoteAudit(result)
    setActivePath(result.path)
    setProject((current) => current ? {
      ...current,
      analyzedAt: result.generatedAt,
      issues: [
        ...current.issues.filter((issue) => ((issue as ProjectIssue & IssueExtra).routePath ?? issue.evidence?.route) !== result.path),
        ...result.findings
      ],
      source: { ...current.source, url: result.url },
      routes: current.routes.some((route) => route.path === result.path)
        ? current.routes
        : [...current.routes, { path: result.path, label: result.path || 'Page courante' }],
      analysis: {
        ...current.analysis,
        truncated: [...remoteAudits.current.values()].some((audit) => audit.truncated)
      }
    } : current)
    setSelectedIssueId(result.findings[0]?.id ?? null)
  }

  const counts = project ? {
    blockers: project.issues.filter((issue) => issue.severity === 'bloquant').length,
    issues: project.issues.length,
    selected: selectedIssueIds.length + instructions.length + visualHistory.present.length + (themeTarget ? 1 : 0),
    changes: staging?.changes.length ?? 0
  } : { blockers: 0, issues: 0, selected: 0, changes: 0 }

  const interfaceOverlayOpen = pageGuideOpen || onboardingState.open || showPreparation

  function openOnboarding(): void {
    onboardingOpenedFromRail.current = true
    setOnboardingState({ open: true, hideOnStartup: isOnboardingHidden() })
  }

  function closeOnboarding(hideOnStartup: boolean): void {
    persistOnboardingHidden(hideOnStartup)
    const restoreRailFocus = onboardingOpenedFromRail.current
    onboardingOpenedFromRail.current = false
    setOnboardingState({ open: false, hideOnStartup })
    window.requestAnimationFrame(() => {
      const fallback = onboardingFallbackFocusRef.current
      const target = restoreRailFocus || fallback?.disabled ? onboardingTriggerRef.current : fallback
      target?.focus()
    })
  }

  return <div className={railCollapsed ? 'app-shell is-rail-collapsed' : 'app-shell'}>
    <aside className="nav-rail" aria-label="Navigation principale">
      <div className="rail-head"><button className="brand" onClick={() => go('projects')} aria-label="Responsiver — Projets"><Mark /><span><strong>Responsiver</strong><small>Responsive workbench</small></span></button><button className="rail-toggle" type="button" onClick={() => setRailCollapsed((current) => !current)} aria-label={railCollapsed ? 'Déployer le menu latéral' : 'Replier le menu latéral'} aria-expanded={!railCollapsed} title={railCollapsed ? 'Déployer le menu' : 'Replier le menu'}><Icon name={railCollapsed ? 'panelExpand' : 'panelCollapse'} size={17} /></button></div>
      <nav>{destinations.map((item) => {
        const visualUnavailable = item.id === 'visual' && Boolean(project && (!project.source.localRoot || project.source.readOnly || project.source.kind === 'remote-url'))
        const limited = (isRemote && (item.id === 'review' || item.id === 'matrix')) || visualUnavailable
        return <button key={item.id} className={`${destination === item.id ? 'nav-link is-active' : 'nav-link'}${limited ? ' is-limited' : ''}`} onClick={() => go(item.id)} aria-label={item.label} aria-current={destination === item.id ? 'page' : undefined} aria-disabled={visualUnavailable || undefined} title={visualUnavailable ? 'Sources locales requises' : item.label}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'review' && counts.changes > 0 && <b>{counts.changes}</b>}</button>
      })}<button ref={onboardingTriggerRef} type="button" className="nav-link nav-link--guide" onClick={openOnboarding} aria-label="Ouvrir le guide de prise en main" aria-haspopup="dialog" aria-expanded={onboardingState.open && !showPreparation} aria-controls="responsiver-onboarding" title="Guide de prise en main"><Icon name="help" /><span>Guide</span></button></nav>
      <div className="rail-foot"><span><Icon name="shield" size={15} /> Local strict par défaut</span><small>v0.7 · open source</small></div>
    </aside>

    <main ref={appMainRef} className="app-main">
      <header className="titlebar">
        <div className="project-identity"><span>{project ? project.source.kind === 'remote-url' ? 'Audit URL' : project.source.kind === 'linked-localhost' ? 'Localhost associé' : 'Projet actif' : 'Espace local'}</span><strong>{project?.name ?? 'Aucun projet ouvert'}</strong>{project && <code title={project.source.url ?? project.root}>{project.source.url ?? project.root}</code>}</div>
        <div className="title-actions">
          {(destination === 'code' || destination === 'visual') && <PageGuide key={destination} page={destination} onOpenChange={setPageGuideOpen} />}
          {project && <span className={`origin-indicator${project.source.readOnly ? ' is-readonly' : ''}`}><i />{project.source.kind === 'remote-url' ? 'URL · lecture seule' : project.source.kind === 'linked-localhost' ? 'Localhost · sources liées' : 'Runner local'}</span>}
          <button ref={onboardingFallbackFocusRef} className="button button--quiet" onClick={() => openWith(() => window.responsiver.chooseProject(), 'Projet analysé et servi localement.')} disabled={busy}><Icon name="folder" /> Ouvrir</button>
        </div>
      </header>

      {destination === 'projects' && <ProjectsView project={project} projectPath={projectPath} publicUrl={publicUrl} localhostUrl={localhostUrl} localhostRoot={localhostRoot} recentProjects={recentProjects} recentLoading={recentLoading} forgettingRecentId={forgettingRecentId} busy={busy} onPath={setProjectPath} onPublicUrl={setPublicUrl} onLocalhostUrl={setLocalhostUrl} onLocalhostRoot={setLocalhostRoot} onChooseLocalhostRoot={() => void chooseLocalhostRoot()} onOpenPublic={() => void openRemote('public')} onOpenLocalhost={() => void openRemote('localhost')} onOpenFolder={() => openWith(() => window.responsiver.chooseProject(), 'Projet analysé et servi localement.')} onOpenFile={() => openWith(() => api().chooseProjectFile ? api().chooseProjectFile!() : window.responsiver.chooseProject(), 'Fichier analysé et servi localement.')} onOpenPath={() => openPath()} onOpenRecent={(id) => void openRecentProject(id)} onForgetRecent={(id) => void forgetRecentProject(id)} onDemo={() => openWith(() => window.responsiver.openDemoProject(), 'Démonstration locale prête.')} onContinue={() => go('lab')} onDrop={(file) => { const path = api().getPathForFile?.(file); if (path) void openPath(path); else flash('Déposez le projet dans l’application desktop.') }} />}

      {destination === 'lab' && project && <div className="workbench">
        <div className="command-bar">
          <div className="mode-switch" role="group" aria-label="Disposition de l’aperçu"><button className={labMode === 'device' ? 'is-active' : ''} onClick={() => setLabMode('device')} aria-pressed={labMode === 'device'}><Icon name="ruler" /> Appareil</button><button className={labMode === 'compare' ? 'is-active' : ''} onClick={() => { setLabMode('compare'); if (previewMode === 'before-after') setPreviewMode('proposal'); setInspectorLocation(null); setInspectorPhase('idle'); setInspectedElement(null) }} aria-pressed={labMode === 'compare'} disabled={isRemote} title={isRemote ? 'Le balayage distant analyse déjà cinq largeurs sans multiplier les sessions.' : undefined}><Icon name="compare" /> 3 écrans</button></div>
          <div className="command-divider" aria-hidden="true" />
          {!isRemote ? <div className="version-switch" role="group" aria-label="État du projet affiché">
            <button className={previewMode === 'source' ? 'is-active' : ''} onClick={() => setPreviewMode('source')} aria-pressed={previewMode === 'source'}>Version actuelle</button>
            <button className={previewMode === 'proposal' ? 'is-active' : ''} onClick={() => proposal && setPreviewMode('proposal')} disabled={!proposal} aria-pressed={previewMode === 'proposal'}>Correctif en cours {proposal && <b>{proposal.changes.length}</b>}</button>
            <button className={previewMode === 'before-after' ? 'is-active' : ''} onClick={() => { if (proposal) { setLabMode('device'); setPreviewMode('before-after'); setInspectorLocation(null); setInspectorPhase('idle'); setInspectedElement(null) } }} disabled={!proposal} aria-pressed={previewMode === 'before-after'}>Avant / Après</button>
            <button className={previewMode === 'staging' ? 'is-active' : ''} onClick={() => staging ? setPreviewMode('staging') : flash('Préparez la version corrigée depuis les corrections validées.')} disabled={!staging} aria-pressed={previewMode === 'staging'}>Version corrigée {staging && <b>{staging.changes.length}</b>}</button>
          </div> : <div className="remote-mode-label"><span><i /> Rendu réel</span><small>{project.source.readOnly ? 'Lecture seule' : workspaceOrigin ? 'Overlay code actif' : 'Sources associées'}</small></div>}
          <div className="command-spacer" />
          {labMode === 'device' && <DeviceControls family={family} devices={familyDevices} selectedId={deviceId} width={width} height={height} onFamily={selectFamily} onDevice={selectDevice} onWidth={(value) => { setMatrixScenario(null); setWidth(value); setDeviceId('custom') }} onHeight={(value) => { setMatrixScenario(null); setHeight(value); setDeviceId('custom') }} onRotate={() => { setMatrixScenario(null); setWidth(height); setHeight(width); setDeviceId('custom') }} />}
        </div>

        <div className="lab-grid">
          <div className={`${stageFullscreen ? 'stage-column is-fullscreen' : 'stage-column'}${inspectorLocation === 'lab' ? ' is-inspecting' : ''}`} role={stageFullscreen ? 'dialog' : undefined} aria-modal={stageFullscreen || undefined} aria-label={stageFullscreen ? 'Prévisualisation en plein écran' : undefined}>
            <div className="stage-toolbar">
              <span><i className={proposal && previewMode !== 'source' && previewMode !== 'staging' ? 'status-dot status-dot--proposal' : 'status-dot status-dot--ok'} />{isRemote ? project.source.kind === 'linked-localhost' ? 'Localhost connecté' : 'URL publique isolée' : previewMode === 'before-after' ? 'Comparaison du correctif' : previewMode === 'proposal' ? 'Correctif temporaire' : previewMode === 'staging' ? 'Version corrigée prête' : workspaceOrigin ? 'Overlay code temporaire' : 'Version actuelle du projet'}</span>
              <small>{isRemote ? 'Navigation réelle · audit multi-viewport' : previewMode === 'before-after' ? 'Deux rendus synchronisés' : labMode === 'device' ? 'Bords redimensionnables' : 'Trois familles d’appareils'}</small>
              <button className={`stage-inspect${inspectorLocation === 'lab' ? ' is-active' : ''}${inspectorLocation === 'lab' && inspectorPhase === 'starting' ? ' is-starting' : ''}`} type="button" onClick={() => toggleInspector('lab')} aria-pressed={inspectorLocation === 'lab'} aria-busy={inspectorLocation === 'lab' && inspectorPhase === 'starting'} title="Inspecter un élément · F12"><Icon name="cursor" size={15} /><span>{inspectorLocation === 'lab' && inspectorPhase === 'starting' ? 'Activation…' : 'Inspecter'}</span></button>
              <button ref={fullscreenButtonRef} className="stage-fullscreen" onClick={() => setStageFullscreen((current) => !current)} aria-label={stageFullscreen ? 'Quitter le plein écran de la prévisualisation' : 'Afficher la prévisualisation en plein écran'} aria-pressed={stageFullscreen}><Icon name={stageFullscreen ? 'fullscreenExit' : 'fullscreen'} size={15} /><span>{stageFullscreen ? 'Réduire' : 'Plein écran'}</span></button>
            </div>
            <div className="stage-canvas">
              {previewBusy && <div className="preview-loading" role="status"><span className="loading-mark" /><strong>Préparation de la proposition…</strong></div>}
              {isRemote ? <RemotePreview projectId={project.id} device={currentDevice} visible={destination === 'lab' && !interfaceOverlayOpen} allowUpscale={stageFullscreen} onResize={(nextWidth, nextHeight) => { setWidth(String(nextWidth)); setHeight(String(nextHeight)); setDeviceId('custom') }} onAudit={applyRemoteAudit} onState={(state) => { setRemoteState(state); changePreviewPath(state.path) }} onNotice={flash} /> : labMode === 'device' && previewMode === 'before-after' && proposal ? <div className="before-after-grid" aria-label="Comparaison avant et après le correctif">
                <div className="comparison-pane"><header><span>Avant</span><strong>Version actuelle</strong></header><PreviewFrame compact zoomable project={project} origin={project.previewOrigin} device={currentDevice} path={activePath} label="Avant — Version actuelle" focusSelector={focusedSelector} onPathChange={changePreviewPath} onThemeChange={setRuntimeTheme} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} /></div>
                <div className="comparison-pane comparison-pane--after"><header><span>Après</span><strong>Correctif non validé</strong></header><PreviewFrame compact zoomable project={project} origin={proposal.previewOrigin} device={currentDevice} path={activePath} label="Après — Correctif en cours" focusSelector={focusedSelector} onPathChange={changePreviewPath} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} /></div>
              </div> : labMode === 'device' ? <PreviewFrame project={project} origin={activeOrigin} device={currentDevice} path={activePath} focusSelector={focusedSelector} themeOverride={nativeThemeTarget} scenarioState={matrixScenario && documentPath(matrixScenario.route) === documentPath(activePath) ? matrixScenario.state : null} resizable allowUpscale={stageFullscreen} zoomable inspectorEnabled={!isRemote && inspectorLocation === 'lab'} onInspectElement={receiveInspectedElement} onCascadeTrace={receiveCascadeTrace} onInspectorReady={() => setInspectorPhase('active')} onInspectorStop={() => { setInspectorLocation(null); setInspectorPhase('idle') }} onInspectorShortcut={() => toggleInspector('lab')} onResize={(nextWidth, nextHeight) => { setMatrixScenario(null); setWidth(String(nextWidth)); setHeight(String(nextHeight)); setDeviceId('custom') }} onPathChange={changePreviewPath} onThemeChange={activeOrigin === project.previewOrigin ? setRuntimeTheme : undefined} onAudit={activeOrigin === project.previewOrigin ? applyRuntimeAudit : undefined} onRenderStatus={setRuntimeRenderStatus} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} /> : <div className="comparison-grid">{compareDevices.map((device) => <PreviewFrame key={device.id} project={project} origin={activeOrigin} device={device} path={activePath} compact focusSelector={focusedSelector} themeOverride={nativeThemeTarget} label={device.family === 'smartphone' ? 'Smartphone' : device.family === 'tablet' ? 'Tablette' : 'Ordinateur'} onPathChange={changePreviewPath} onThemeChange={activeOrigin === project.previewOrigin ? setRuntimeTheme : undefined} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} onEscape={() => setStageFullscreen(false)} />)}</div>}
            </div>
            {inspectorLocation === 'lab' && <QuickInspectorPanel element={inspectedElement} phase={inspectorPhase} readOnly={project.source.kind === 'remote-url' || Boolean(project.previewBasePath)} cascade={cascadeTrace} cascadeLoading={cascadeLoading} onOpenSource={openCascadeSource} onClose={() => { setInspectorLocation(null); setInspectorPhase('idle') }} onEdit={() => go('visual')} />}
          </div>
          {scopedProject && <Inspector project={scopedProject} allIssues={project.issues} activeIssueCount={routeIssues.length} totalIssueCount={project.issues.length} showAllIssues={showAllIssues} onShowAllIssues={setShowAllIssues} tab={inspectorTab} onTab={setInspectorTab} selectedIssue={selectedIssue} selectedIds={selectedIssueIds} queuedIds={queuedIssueIds} visualEditCount={visualHistory.present.length} onPreviewIssue={(issue) => void previewIssue(issue)} onPreviewBatch={(ids) => void previewQueuedIssues(ids)} onToggleIssue={toggleAcceptedIssue} onToggleQueued={toggleQueuedIssue} runtimeTheme={runtimeTheme} themeTarget={themeTarget} previewThemeTarget={previewThemeTarget} onPreviewTheme={(target) => void previewTheme(target)} onRemoveTheme={removeTheme} proposal={proposal} proposalContext={proposalContext} previewBusy={previewBusy} staging={staging} runtimeAudit={runtimeAudit} runtimeRenderStatus={runtimeRenderStatus} instructions={instructions} onRemoveInstruction={removeInstruction} messages={messages} draft={draft} onDraft={setDraft} onSubmit={submitInstruction} busy={busy || matrixBusy} expressVerification={expressVerification} onApplyExpress={() => void applyExpressVerification()} onAcceptProposal={acceptProposal} onAcceptAndApply={() => void acceptAndApplyProposal()} onRejectProposal={rejectProposal} onApplySafe={(ids) => void applyQueuedSafeIssues(ids)} undoAvailable={undoAvailable} onUndo={() => void undoLastApply()} directApplyAvailable={directApplyAvailable} onReview={() => void prepareAndOpenReview()} onClear={() => void clearStaging()} assistantRoute={remoteState?.path ?? activePath} assistantViewport={{ width: currentDevice.width, height: currentDevice.height, deviceScaleFactor: 1, mobile: currentDevice.family !== 'computer', touch: currentDevice.family !== 'computer' }} assistantScreenshot={remoteAudit?.screenshotDataUrl ?? null} workspaceEnabled={workspaceEnabled} onWorkspacePreviewOrigin={setWorkspaceOrigin} onNotice={flash} onOpenCode={() => go('code')} />}
        </div>
        {!isRemote && previewMode === 'source' && project.previewOrigin && (project.previewReadiness.status === 'ready' || project.previewReadiness.status === 'degraded') && <div className="runtime-audit-probes" aria-hidden="true" inert>
          {auditDevices.map((device) => <PreviewFrame key={`${project.id}:${device.id}`} compact project={project} origin={project.previewOrigin} device={device} path={activePath} label={`Sonde ${auditFamily(device.width)}`} onAudit={(audit) => applyRuntimeAudit(audit, false)} />)}
        </div>}
        <footer className="activity-bar"><span><i className="status-dot status-dot--ok" /> {isRemote ? `${remoteAudits.current.size} route${remoteAudits.current.size > 1 ? 's' : ''} auditée${remoteAudits.current.size > 1 ? 's' : ''}` : `${project.routes.length} page${project.routes.length > 1 ? 's' : ''}`}</span>{project.capabilities?.buildRequired ? <span className="activity-alert" title="Responsiver n’exécute jamais les scripts arbitraires d’un projet sans consentement. Ouvrez plutôt le fichier HTML généré dans dist ou out.">Sources à compiler · choisir dist/out</span> : <span className={counts.blockers ? 'activity-alert' : ''}>{counts.blockers} bloquant{counts.blockers > 1 ? 's' : ''}</span>}<span>{isRemote ? remoteAudit ? `${project.issues.length} constats cumulés · ${remoteAudit.viewports.length} largeurs` : 'Audit visuel en préparation' : localAuditProfileCount ? `${routeIssues.length} constat${routeIssues.length > 1 ? 's' : ''} consolidé${routeIssues.length > 1 ? 's' : ''} · ${localAuditProfileCount}/${auditDevices.length} formats` : 'Audit visuel en attente'}</span><span className="activity-end"><Icon name="shield" size={13} /> {project.source.network === 'local-only' ? 'Hors ligne' : project.source.network === 'localhost' ? 'Serveur local · dépendances web autorisées' : 'Session réseau éphémère'}</span></footer>
      </div>}

      {destination === 'matrix' && project && <React.Suspense fallback={<div className="code-loading"><span /> Préparation de la matrice…</div>}><MatrixView project={project} result={matrixResult} progress={matrixProgress} busy={matrixBusy} compareAvailable={Boolean(staging)} onRun={(compare) => void runMatrix(compare)} onOpenCell={openMatrixCell} onReview={() => go('review')} /></React.Suspense>}

      {destination === 'visual' && project && visualAuthorization?.allowed && <VisualEditorView
        project={project}
        remotePreviewVisible={!interfaceOverlayOpen}
        device={currentDevice}
        family={family}
        familyDevices={familyDevices}
        selectedDeviceId={deviceId}
        width={width}
        height={height}
        path={activePath}
        mode={visualMode}
        scope={visualScope}
        routeScope={visualRouteScope}
        currentRoutePersistent={currentVisualRoutePersistent}
        target={inspectedElement}
        multipleConfirmed={visualMultipleConfirmed}
        operations={visualHistory.present}
        visualCss={visualCss}
        authorization={visualAuthorization}
        canUndo={visualHistory.past.length > 0}
        canRedo={visualHistory.future.length > 0}
        busy={busy}
        fullscreen={visualFullscreen}
        fullscreenButtonRef={visualFullscreenButtonRef}
        onMode={setVisualMode}
        onScope={selectVisualScope}
        onRouteScope={setVisualRouteScope}
        onMultipleConfirmed={setVisualMultipleConfirmed}
        onInspect={(element, phase) => { if (phase === 'selected') { setInspectedElement(element); setVisualMultipleConfirmed(false) } }}
        onInspectorStop={() => setVisualMode('interact')}
        onGesture={commitVisualGesture}
        onGestureVerified={verifyVisualGesture}
        onGestureRejected={rejectVisualGesture}
        onProperty={updateVisualProperty}
        onRemoveOperation={removeVisualOperation}
        onUndo={undoVisualEdit}
        onRedo={redoVisualEdit}
        onClear={clearVisualEdits}
        onPrepare={() => void prepareVisualChanges(true)}
        onApply={() => void applyVisualChanges()}
        onFamily={selectFamily}
        onDevice={selectDevice}
        onWidth={(value) => { setWidth(value); setDeviceId('custom') }}
        onHeight={(value) => { setHeight(value); setDeviceId('custom') }}
        onRotate={() => { setWidth(height); setHeight(width); setDeviceId('custom') }}
        onResize={(nextWidth, nextHeight) => { setWidth(String(nextWidth)); setHeight(String(nextHeight)); setDeviceId('custom') }}
        onPathChange={changePreviewPath}
        onFullscreen={() => setVisualFullscreen((current) => !current)}
        onOpenCode={() => go('code')}
        onNotice={flash}
      />}

      {destination === 'code' && project && <div className="code-page">
        <h1 className="sr-only">Code</h1>
        <div className="code-context-bar"><span className="code-overlay-state"><Icon name="shield" size={14} /> Overlay en mémoire · disque intact</span><div className="code-head-actions">{project.source.kind === 'linked-localhost' && <span className="code-runtime-chip" title="Le CSS est prévisualisé instantanément. Pour HTML, Twig, PHP, JavaScript ou les fichiers de framework, appliquez explicitement le fichier puis laissez votre serveur local le recharger."><Icon name="info" size={13} /> CSS instantané · autres sources après validation</span>}{project.source.network === 'localhost' && !workspaceEnabled && <button className="button button--secondary" type="button" onClick={() => void associateCurrentLocalhostRoot()} disabled={busy}><Icon name="folder" size={15} /> Associer les sources</button>}<span className={workspaceEnabled ? 'code-capability is-ready' : 'code-capability'}><i />{workspaceEnabled ? 'Sources locales liées' : 'Lecture seule'}</span>{frameworkSupport && <details className="framework-support"><summary><Icon name="code" size={13} /><span>{frameworkSupport.stack}</span><b>{frameworkSupport.editingLabel}</b></summary><p>{frameworkSupport.detail}</p></details>}</div></div>
        <div className="code-studio">
          <React.Suspense fallback={<div className="code-workspace code-loading"><span /> Chargement de l’éditeur local…</div>}><CodeWorkspace projectId={project.id} enabled={workspaceEnabled} preferredPath={selectedIssue?.source?.file ?? null} preferredLocation={codeLocation} onNotice={flash} onPreviewOrigin={setWorkspaceOrigin} /></React.Suspense>
          <aside className={`code-live-preview${inspectorLocation === 'code' ? ' is-inspecting' : ''}`}>
            <header><div><span className="overline">Aperçu direct</span><strong>{currentDevice.name}</strong></div><div className="code-preview-actions"><button className={`${inspectorLocation === 'code' ? 'text-button is-active' : 'text-button'}${inspectorLocation === 'code' && inspectorPhase === 'starting' ? ' is-starting' : ''}`} onClick={() => toggleInspector('code')} aria-pressed={inspectorLocation === 'code'} aria-busy={inspectorLocation === 'code' && inspectorPhase === 'starting'} title="Inspecter un élément · F12"><Icon name="cursor" size={14} /> {inspectorLocation === 'code' && inspectorPhase === 'starting' ? 'Activation…' : 'Inspecter'}</button><button className="text-button" onClick={() => go('lab')}><Icon name="fullscreen" size={14} /> Ouvrir en grand</button></div></header>
            <div className="code-preview-body">
              {isRemote
                ? <RemotePreview projectId={project.id} device={currentDevice} visible={destination === 'code' && !interfaceOverlayOpen} embedded automaticAudit={false} onResize={(nextWidth, nextHeight) => { setWidth(String(nextWidth)); setHeight(String(nextHeight)); setDeviceId('custom') }} onAudit={applyRemoteAudit} onState={(state) => { setRemoteState(state); changePreviewPath(state.path) }} onNotice={flash} />
                : <PreviewFrame compact zoomable project={project} origin={workspaceOrigin ?? project.previewOrigin} device={currentDevice} path={activePath} resizable inspectorEnabled={inspectorLocation === 'code'} onInspectElement={receiveInspectedElement} onCascadeTrace={receiveCascadeTrace} onInspectorReady={() => setInspectorPhase('active')} onInspectorStop={() => { setInspectorLocation(null); setInspectorPhase('idle') }} onInspectorShortcut={() => toggleInspector('code')} onResize={(nextWidth, nextHeight) => { setWidth(String(nextWidth)); setHeight(String(nextHeight)); setDeviceId('custom') }} onPathChange={changePreviewPath} onThemeChange={setRuntimeTheme} onAudit={!workspaceOrigin ? applyRuntimeAudit : undefined} onRenderStatus={setRuntimeRenderStatus} onExternal={(url) => flash(`Lien externe bloqué : ${url}`)} />}
            </div>
            {inspectorLocation === 'code' && <QuickInspectorPanel element={inspectedElement} phase={inspectorPhase} readOnly={project.source.kind === 'remote-url' || Boolean(project.previewBasePath)} cascade={cascadeTrace} cascadeLoading={cascadeLoading} onOpenSource={openCascadeSource} onClose={() => { setInspectorLocation(null); setInspectorPhase('idle') }} onEdit={() => go('visual')} />}
            <footer><span><i /> Overlay en mémoire</span><code>{currentDevice.width} × {currentDevice.height}</code></footer>
          </aside>
        </div>
      </div>}

      {destination === 'review' && project && <ReviewView project={project} staging={staging} sourceOrigin={project.previewOrigin} path={activePath} device={currentDevice} acceptedCount={counts.selected} canApply={directApplyAvailable} onBuild={() => void prepareAndOpenReview()} onApply={() => void applyApprovedPlan()} onClear={() => void clearStaging()} onCopy={() => void copyPatch()} busy={busy} />}
      {destination === 'export' && project && (project.source.kind === 'remote-url'
        ? <RemoteReportView project={project} auditedRouteCount={remoteAudits.current.size} busy={busy} onCopy={() => void copyRemoteSummary()} onExport={() => void exportAction('report')} onLab={() => go('lab')} />
        : <ExportView project={project} staging={staging} selectedCount={counts.selected} busy={busy} onCopy={() => void copyPatch()} onExport={exportAction} onReview={() => project.source.kind === 'linked-localhost' ? go('visual') : go('review')} reviewLabel={project.source.kind === 'linked-localhost' ? 'Revenir à l’Atelier' : 'Réviser la version corrigée'} />)}
    </main>
    {onboardingState.open && !showPreparation && <OnboardingTour initialHideOnStartup={onboardingState.hideOnStartup} onClose={closeOnboarding} />}
    {showPreparation && preparation && <PreparationOverlay progress={preparation} />}
    {notice && <div className={destination === 'visual' ? 'toast toast--above-visual-tray' : 'toast'} role="status" inert={visualFullscreen || undefined} aria-hidden={visualFullscreen || undefined}><Icon name="info" size={16} /> <span>{notice}</span><button aria-label="Fermer" onClick={() => setNotice(null)}><Icon name="close" size={14} /></button></div>}
  </div>
}

function QuickInspectorPanel({ element, phase, readOnly, cascade, cascadeLoading, onOpenSource, onClose, onEdit }: { element: VisualElementSnapshot | null; phase: InspectorPhase; readOnly: boolean; cascade: CascadeTrace | null; cascadeLoading: boolean; onOpenSource: (file: string, line: number | null, column: number | null) => void; onClose: () => void; onEdit: () => void }): ReactElement {
  const [tab, setTab] = useState<'computed' | 'origin'>('computed')
  const [cascadeProperty, setCascadeProperty] = useState('')
  useEffect(() => { setTab('computed'); setCascadeProperty('') }, [element?.selector])
  const essentialStyles = element ? [
    ['display', element.styles.display],
    ['width', element.styles.width],
    ['height', element.styles.height],
    ['font-size', element.styles['font-size']],
    ['line-height', element.styles['line-height']],
    ['color', element.styles.color],
    ['background-color', element.styles['background-color']],
    ['gap', element.styles.gap]
  ].filter((entry): entry is [string, string] => Boolean(entry[1])) : []
  const effectiveReadOnly = readOnly || element?.editable === false
  const tracedProperties = cascade && element && cascade.selector === element.selector ? cascade.properties : []
  const selectedTrace = tracedProperties.find((property) => property.property === cascadeProperty) ?? (!cascadeProperty ? tracedProperties.find((property) => property.declarations.some((declaration) => declaration.status === 'winner' || declaration.status === 'inline')) ?? tracedProperties[0] : undefined)
  const winningDeclaration = selectedTrace?.declarations.find((declaration) => declaration.status === 'winner' || declaration.status === 'inline') ?? null
  const cascadeSourceControl = (declaration: CascadeTrace['properties'][number]['declarations'][number], withIcon = false): ReactElement => {
    const source = declaration.source
    if (source.file && source.kind !== 'generated' && !readOnly) {
      const estimated = source.certainty === 'estimated'
      return <button type="button" title={estimated ? 'Emplacement rapproché du texte source : ligne estimée' : 'Ouvrir cette déclaration dans le fichier source'} onClick={() => onOpenSource(source.file!, source.line, source.column)}>{withIcon && <Icon name="code" size={13} />} {estimated ? '≈ ' : ''}{source.file}{source.line ? `:${source.line}` : ''}{source.occurrence && source.occurrence > 1 ? ` · occurrence ${source.occurrence}` : ''}</button>
    }
    if (source.kind === 'generated') return <span>Feuille générée par Responsiver · lecture seule</span>
    if (source.file && readOnly) return <span>{source.file} · source auteur indisponible</span>
    return <span>Source externe ou runtime · lecture seule</span>
  }
  return <aside className="quick-inspector" aria-label="Inspecteur de la prévisualisation">
    <header><div><span className="overline">Inspecteur</span><strong>{element ? `<${element.tag}>` : 'Sélection DOM'}</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer l’inspecteur"><Icon name="close" size={14} /></button></header>
    {!element ? <div className={`quick-inspector-empty${phase === 'starting' ? ' is-starting' : ''}`}><span className="inspector-cursor"><Icon name="cursor" size={22} /></span><strong>{phase === 'starting' ? 'Activation de l’inspecteur…' : 'Pointez un élément'}</strong><p>{phase === 'starting' ? 'Responsiver attend que le rendu soit prêt. Vous pourrez cliquer dès que le curseur devient actif.' : 'Survolez la preview puis cliquez sur un texte, un bouton, une image ou un conteneur.'}</p><small>{phase === 'starting' ? 'Le bouton reste synchronisé avec le moteur de rendu.' : 'Échap quitte le mode sélection.'}</small></div> : <div className="quick-inspector-content">
      <section className="dom-summary"><div><code>{element.selector}</code><span>{element.occurrences} correspondance{element.occurrences > 1 ? 's' : ''}</span></div>{element.text && <p>{element.text}</p>}<dl><div><dt>Route</dt><dd>{element.route}</dd></div><div><dt>Dimensions</dt><dd>{Math.round(element.rect.width)} × {Math.round(element.rect.height)} px</dd></div>{element.role && <div><dt>Rôle</dt><dd>{element.role}</dd></div>}{element.ariaLabel && <div><dt>Nom accessible</dt><dd>{element.ariaLabel}</dd></div>}</dl></section>
      <div className="inspector-detail-tabs" role="tablist" aria-label="Détails des styles"><button type="button" role="tab" aria-selected={tab === 'computed'} className={tab === 'computed' ? 'is-active' : ''} onClick={() => setTab('computed')}>Calculés</button><button type="button" role="tab" aria-selected={tab === 'origin'} className={tab === 'origin' ? 'is-active' : ''} onClick={() => setTab('origin')}>Origine {cascadeLoading && <i />}</button></div>
      {tab === 'computed' ? <><section className="box-model-card"><span className="overline">Modèle de boîte</span><div className="box-model-visual"><span>margin<em>{element.styles['margin-top'] ?? '0'}</em><i>border<em>{element.styles['border-width'] ?? '0'}</em><b>padding<em>{element.styles['padding-top'] ?? '0'}</em><strong>{Math.round(element.rect.width)} × {Math.round(element.rect.height)}</strong></b></i></span></div></section><section className="computed-style-list"><span className="overline">Styles calculés</span>{essentialStyles.map(([property, value]) => <button type="button" key={property} onClick={() => { setCascadeProperty(property); setTab('origin') }}><code>{property}</code><span>{value}</span><Icon name="arrow" size={11} /></button>)}</section></> : <section className="cascade-panel" role="tabpanel">
        {cascadeLoading ? <div className="cascade-empty"><span className="loading-mark" /><strong>Traçage de la cascade…</strong><p>Responsiver relie le style prioritaire calculé à la feuille réellement chargée.</p></div> : !tracedProperties.length ? <div className="cascade-empty"><Icon name="info" size={18} /><strong>Origine partielle</strong><p>Cette source est distante, encapsulée ou fournie par le navigateur. Le style calculé reste disponible.</p></div> : <><label>Propriété<select value={selectedTrace?.property ?? ''} onChange={(event) => setCascadeProperty(event.target.value)}>{tracedProperties.map((property) => <option key={property.property} value={property.property}>{property.property} · {property.computed}</option>)}</select></label>{winningDeclaration && <article className="cascade-winner"><header><span>Priorité calculée</span><b>{winningDeclaration.important ? '!important' : `0-${winningDeclaration.specificity.join('-')}`}</b></header><code>{winningDeclaration.selector} {'{'} {selectedTrace?.property}: {winningDeclaration.value}; {'}'}</code>{winningDeclaration.media.map((condition) => <small key={condition}>@media {condition} · actif</small>)}{cascadeSourceControl(winningDeclaration, true)}</article>}<div className="cascade-stack">{selectedTrace?.declarations.filter((declaration) => declaration !== winningDeclaration).map((declaration, index) => <article className={`is-${declaration.status}`} key={`${declaration.selector}:${declaration.order}:${index}`}><header><span>{declaration.status === 'inactive' ? 'Condition inactive' : 'Écrasée'}</span>{declaration.media.length > 0 && <b>{declaration.media[0]}</b>}</header><code>{declaration.selector}</code><p>{selectedTrace.property}: {declaration.value}{declaration.important ? ' !important' : ''}</p>{cascadeSourceControl(declaration)}</article>)}</div>{cascade?.truncated && <small className="cascade-limit">Trace partielle : la page dépasse les limites de collecte sûres.</small>}</>}
      </section>}
      <footer><span className={effectiveReadOnly ? 'source-badge is-readonly' : 'source-badge'}><i />{element.insideFrame ? 'Sous-frame · inspection seule' : effectiveReadOnly ? 'Lecture seule' : 'Surcharge CSS sûre'}</span>{!effectiveReadOnly && <button className="button button--primary button--compact" type="button" onClick={onEdit}><Icon name="cursor" size={14} /> Modifier dans l’Atelier</button>}</footer>
    </div>}
  </aside>
}

const visualControlGroups: Array<{ title: string; description: string; controls: Array<{ property: VisualEditProperty; label: string; placeholder?: string; options?: Array<{ value: string; label: string }> }> }> = [
  {
    title: 'Mise en page',
    description: 'Contraintes de flux, jamais de coordonnées absolues.',
    controls: [
      { property: 'display', label: 'Affichage', options: [{ value: 'block', label: 'Bloc' }, { value: 'flex', label: 'Flex' }, { value: 'grid', label: 'Grille' }, { value: 'inline-flex', label: 'Flex en ligne' }, { value: 'none', label: 'Masqué' }] },
      { property: 'flex-direction', label: 'Direction', options: [{ value: 'row', label: 'Ligne' }, { value: 'column', label: 'Colonne' }, { value: 'row-reverse', label: 'Ligne inversée' }, { value: 'column-reverse', label: 'Colonne inversée' }] },
      { property: 'justify-content', label: 'Répartition', options: [{ value: 'flex-start', label: 'Début' }, { value: 'center', label: 'Centre' }, { value: 'space-between', label: 'Espacé' }, { value: 'space-around', label: 'Réparti' }, { value: 'flex-end', label: 'Fin' }] },
      { property: 'align-items', label: 'Alignement', options: [{ value: 'stretch', label: 'Étiré' }, { value: 'flex-start', label: 'Début' }, { value: 'center', label: 'Centre' }, { value: 'flex-end', label: 'Fin' }, { value: 'baseline', label: 'Ligne de base' }] },
      { property: 'gap', label: 'Espacement', placeholder: '16px' }
    ]
  },
  {
    title: 'Dimensions',
    description: 'Valeurs fluides acceptées : %, rem, clamp(), min() ou max().',
    controls: [
      { property: 'width', label: 'Largeur', placeholder: '100%' },
      { property: 'max-width', label: 'Largeur max.', placeholder: '72rem' },
      { property: 'min-height', label: 'Hauteur min.', placeholder: '44px' },
      { property: 'object-fit', label: 'Image', options: [{ value: 'cover', label: 'Couvrir' }, { value: 'contain', label: 'Contenir' }, { value: 'fill', label: 'Étirer' }, { value: 'none', label: 'Taille native' }] }
    ]
  },
  {
    title: 'Espacements',
    description: 'Ajustez la respiration du composant dans le flux.',
    controls: [
      { property: 'padding', label: 'Padding', placeholder: '12px 18px' },
      { property: 'margin', label: 'Marge', placeholder: '0 auto' },
      { property: 'padding-inline', label: 'Padding horizontal', placeholder: '1rem' },
      { property: 'padding-block', label: 'Padding vertical', placeholder: '.75rem' }
    ]
  },
  {
    title: 'Typographie',
    description: 'Conservez une hiérarchie lisible sur le viewport sélectionné.',
    controls: [
      { property: 'font-size', label: 'Taille', placeholder: 'clamp(1rem, 2vw, 1.5rem)' },
      { property: 'line-height', label: 'Interligne', placeholder: '1.45' },
      { property: 'font-weight', label: 'Graisse', placeholder: '600' },
      { property: 'text-align', label: 'Alignement', options: [{ value: 'left', label: 'Gauche' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Droite' }, { value: 'justify', label: 'Justifié' }] },
      { property: 'color', label: 'Couleur', placeholder: '#1f211e' }
    ]
  },
  {
    title: 'Aspect',
    description: 'Surfaces et contours sans altérer les images de marque.',
    controls: [
      { property: 'background-color', label: 'Fond', placeholder: '#f5f2ea' },
      { property: 'border-radius', label: 'Rayon', placeholder: '12px' },
      { property: 'border-color', label: 'Bordure', placeholder: '#c7c2b8' },
      { property: 'box-shadow', label: 'Ombre', placeholder: '0 12px 32px rgba(0,0,0,.12)' },
      { property: 'opacity', label: 'Opacité', placeholder: '1' }
    ]
  }
]

function sameVisualScope(left: VisualEditScope, right: VisualEditScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function VisualValueField({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit: (value: string) => void }): ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft.trim() && draft.trim() !== value) onCommit(draft.trim()) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
}

function VisualPropertiesPanel({ target, scope, routeScope, multipleConfirmed, operations, authorization, onMultipleConfirmed, onProperty, onRemoveOperation, onOpenCode }: {
  target: VisualElementSnapshot | null
  scope: VisualEditScope
  routeScope: 'current' | 'all'
  multipleConfirmed: boolean
  operations: VisualEditOperation[]
  authorization: ReturnType<typeof authorizeVisualEditor>
  onMultipleConfirmed: (confirmed: boolean) => void
  onProperty: (property: VisualEditProperty, value: string) => void
  onRemoveOperation: (id: string) => void
  onOpenCode: () => void
}): ReactElement {
  const currentRoute = target?.route ?? ''
  const operationFor = (property: VisualEditProperty): VisualEditOperation | undefined => operations.find((operation) =>
    operation.target.selector === target?.selector && operation.property === property && sameVisualScope(operation.scope, scope) &&
    (routeScope === 'all' ? operation.route.kind === 'all' : operation.route.kind === 'current' && operation.route.path === currentRoute))
  const editable = Boolean(target && target.editable !== false && !target.selector.includes('>>>') && (target.occurrences <= 1 || multipleConfirmed))
  return <aside className="visual-properties">
    <header><div><span className="overline">Propriétés</span><strong>{target ? `<${target.tag}>` : 'Aucun élément'}</strong></div>{target && <span className={authorization.persistable ? 'source-badge' : 'source-badge is-review'}><i />{authorization.persistable ? 'Surcharge sûre' : 'Export contrôlé'}</span>}</header>
    {!target ? <div className="visual-empty-selection"><span><Icon name="cursor" size={28} /></span><h2>Sélectionnez dans la page</h2><p>Survolez la preview, puis cliquez sur le bouton, le texte, l’image ou le conteneur à ajuster.</p><small>Le site ne reçoit aucun accès aux fichiers.</small></div> : <>
      <section className="visual-target-card"><code title={target.selector}>{target.selector}</code><div><span>{Math.round(target.rect.width)} × {Math.round(target.rect.height)} px</span><span>{target.occurrences} occurrence{target.occurrences > 1 ? 's' : ''}</span></div>{target.text && <p>{target.text}</p>}</section>
      {target.selector.includes('>>>') && <div className="visual-warning"><Icon name="info" size={15} /><span>Ce nœud appartient à un Shadow DOM. Il reste inspectable, mais une feuille CSS externe ne peut pas le cibler sûrement.</span></div>}
      {target.insideFrame && <div className="visual-warning"><Icon name="info" size={15} /><span>Ce nœud appartient à une sous-frame. Il reste inspectable, mais la feuille du document principal ne peut pas le modifier.</span></div>}
      {target.occurrences > 1 && <label className="matching-confirmation"><input type="checkbox" checked={multipleConfirmed} onChange={(event) => onMultipleConfirmed(event.target.checked)} /><span><strong>Modifier les {target.occurrences} éléments similaires</strong><small>Le sélecteur est partagé. La preview permet de vérifier l’ensemble avant application.</small></span></label>}
      <fieldset className={editable ? 'visual-control-scroll' : 'visual-control-scroll is-locked'} disabled={!editable}>{visualControlGroups.map((group) => <details key={group.title} open={group.title === 'Mise en page' || group.title === 'Dimensions'}><summary><span><strong>{group.title}</strong><small>{group.description}</small></span><Icon name="plus" size={14} /></summary><div className="visual-control-grid">{group.controls.map((control) => {
        const operation = operationFor(control.property)
        const value = operation?.after ?? target.styles[control.property] ?? ''
        return <label key={control.property}><span>{control.label}{operation && <i>modifié</i>}</span>{control.options ? <select value={value} onChange={(event) => event.target.value && onProperty(control.property, event.target.value)}><option value="">Valeur calculée</option>{control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <VisualValueField key={`${target.selector}:${control.property}:${JSON.stringify(scope)}:${routeScope}`} value={value} placeholder={control.placeholder} onCommit={(next) => onProperty(control.property, next)} />}{operation && <button type="button" onClick={() => onRemoveOperation(operation.id)} aria-label={`Rétablir ${control.label}`} title="Rétablir la valeur source"><Icon name="undo" size={12} /></button>}</label>
      })}</div></details>)}</fieldset>
      <footer><button className="text-button" type="button" onClick={onOpenCode}><Icon name="code" size={14} /> Ouvrir le code</button><span>{operations.filter((operation) => operation.target.selector === target.selector).length} réglage{operations.filter((operation) => operation.target.selector === target.selector).length > 1 ? 's' : ''} sur cette cible</span></footer>
    </>}
  </aside>
}

function VisualEditorView({ project, remotePreviewVisible, device, family, familyDevices, selectedDeviceId, width, height, path, mode, scope, routeScope, currentRoutePersistent, target, multipleConfirmed, operations, visualCss, authorization, canUndo, canRedo, busy, fullscreen, fullscreenButtonRef, onMode, onScope, onRouteScope, onMultipleConfirmed, onInspect, onInspectorStop, onGesture, onGestureVerified, onGestureRejected, onProperty, onRemoveOperation, onUndo, onRedo, onClear, onPrepare, onApply, onFamily, onDevice, onWidth, onHeight, onRotate, onResize, onPathChange, onFullscreen, onOpenCode, onNotice }: {
  project: ProjectSnapshot & ProjectExtra
  remotePreviewVisible: boolean
  device: Device
  family: DeviceFamily
  familyDevices: Device[]
  selectedDeviceId: string
  width: string
  height: string
  path: string
  mode: VisualEditorMode
  scope: VisualEditScope
  routeScope: 'current' | 'all'
  currentRoutePersistent: boolean
  target: VisualElementSnapshot | null
  multipleConfirmed: boolean
  operations: VisualEditOperation[]
  visualCss: string
  authorization: ReturnType<typeof authorizeVisualEditor>
  canUndo: boolean
  canRedo: boolean
  busy: boolean
  fullscreen: boolean
  fullscreenButtonRef: React.RefObject<HTMLButtonElement | null>
  onMode: (mode: VisualEditorMode) => void
  onScope: (scope: VisualEditScope) => void
  onRouteScope: (scope: 'current' | 'all') => void
  onMultipleConfirmed: (confirmed: boolean) => void
  onInspect: (element: VisualElementSnapshot, phase: 'hover' | 'selected') => void
  onInspectorStop: () => void
  onGesture: (gesture: VisualGestureCommit) => void
  onGestureVerified: (gestureId: string) => void
  onGestureRejected: (gestureId: string, reason: string) => void
  onProperty: (property: VisualEditProperty, value: string) => void
  onRemoveOperation: (id: string) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onPrepare: () => void
  onApply: () => void
  onFamily: (family: DeviceFamily) => void
  onDevice: (id: string) => void
  onWidth: (value: string) => void
  onHeight: (value: string) => void
  onRotate: () => void
  onResize: (width: number, height: number) => void
  onPathChange: (path: string) => void
  onFullscreen: () => void
  onOpenCode: () => void
  onNotice: (message: string) => void
}): ReactElement {
  const remote = project.source.kind === 'linked-localhost'
  const selectedScope = scope.kind
  const operationScopes = new Set(operations.map((operation) => {
    const operationScope = operation.scope.kind === 'all' ? 'Toutes tailles' : operation.scope.kind === 'mobile' ? 'Mobile ≤ 767 px' : operation.scope.kind === 'tablet' ? 'Tablette 768–1024 px' : `${operation.scope.minWidth ?? '…'}–${operation.scope.maxWidth ?? '…'} px`
    return `${operation.route.kind === 'all' ? 'Site' : operation.route.path} · ${operationScope}`
  }))
  const operationScopeSummary = operationScopes.size === 1 ? [...operationScopes][0] : `${operationScopes.size} portées distinctes`
  return <div className="visual-editor-page">
    <h1 className="sr-only">Atelier visuel</h1>
    <div className="visual-toolbar">
      <div className="visual-mode-switch" role="group" aria-label="Mode de l’Atelier"><button className={mode === 'compose' ? 'is-active' : ''} onClick={() => onMode('compose')} aria-pressed={mode === 'compose'} disabled={remote} title={remote ? 'La composition directe nécessite la preview locale instrumentée. L’inspection reste disponible.' : 'Figer la page et manipuler ses éléments à la souris'}><Icon name="compose" size={15} /> Composer</button><button className={mode === 'select' ? 'is-active' : ''} onClick={() => onMode('select')} aria-pressed={mode === 'select'} title="Inspecter un élément · F12"><Icon name="cursor" size={15} /> Inspecter</button><button className={mode === 'interact' ? 'is-active' : ''} onClick={() => onMode('interact')} aria-pressed={mode === 'interact'}><Icon name="play" size={15} /> Tester</button><button className={mode === 'compare' ? 'is-active' : ''} onClick={() => onMode('compare')} aria-pressed={mode === 'compare'} disabled={remote} title={remote ? 'La comparaison du localhost utilise une seule session réelle.' : undefined}><Icon name="compare" size={15} /> Avant / après</button></div>
      <div className="visual-history-actions"><button className="icon-button" type="button" onClick={onUndo} disabled={!canUndo} aria-label="Annuler la dernière modification" title="Annuler"><Icon name="undo" size={15} /></button><button className="icon-button" type="button" onClick={onRedo} disabled={!canRedo} aria-label="Rétablir la modification" title="Rétablir"><Icon name="redo" size={15} /></button></div>
      <div className="visual-toolbar-divider" />
      <div className="visual-scope-group" aria-label="Portée du changement"><span>Appliquer à</span><label className="visual-scope-select"><span>Tailles</span><select aria-label="Tailles concernées" value={selectedScope} onChange={(event) => { const next = event.target.value; onScope(next === 'all' || next === 'mobile' || next === 'tablet' ? { kind: next } : { kind: 'custom', minWidth: device.width, maxWidth: device.width }) }}><option value="all">Tous les écrans</option><option value="mobile">Mobile uniquement (≤ 767 px)</option><option value="tablet">Tablette uniquement (768–1024 px)</option><option value="custom">Plage personnalisée</option></select></label><label className="visual-scope-select"><span>Pages</span><select aria-label="Pages concernées" value={routeScope} onChange={(event) => onRouteScope(event.target.value === 'all' ? 'all' : 'current')}><option value="current" disabled={!currentRoutePersistent}>Cette page seulement</option><option value="all">Tout le site</option></select></label></div>
      {scope.kind === 'custom' && <div className="custom-scope-fields"><label>Min <input aria-label="Largeur minimale concernée" type="number" min="240" max="3840" value={scope.minWidth ?? ''} onChange={(event) => onScope({ ...scope, minWidth: event.target.value ? Number(event.target.value) : null })} /></label><label>Max <input aria-label="Largeur maximale concernée" type="number" min="240" max="3840" value={scope.maxWidth ?? ''} onChange={(event) => onScope({ ...scope, maxWidth: event.target.value ? Number(event.target.value) : null })} /></label></div>}
    </div>
    <div className="visual-device-bar"><DeviceControls family={family} devices={familyDevices} selectedId={selectedDeviceId} width={width} height={height} onFamily={onFamily} onDevice={onDevice} onWidth={onWidth} onHeight={onHeight} onRotate={onRotate} /></div>
    <div className={`visual-workspace${fullscreen ? ' is-fullscreen' : ''}`} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? 'Atelier visuel en plein écran' : undefined}>
      <section className={`visual-canvas visual-canvas--${mode}`}><header><span><i />{mode === 'compose' ? 'Page figée · déplacez ou redimensionnez librement' : mode === 'select' ? 'Inspection active · cliquez un élément' : mode === 'interact' ? 'Aperçu fonctionnel · interactions actives' : 'Source et proposition synchronisées'}</span><div className="visual-canvas-actions"><code>{path}</code><button className={`stage-inspect${mode === 'select' ? ' is-active' : ''}`} type="button" onClick={() => onMode(mode === 'select' ? 'interact' : 'select')} aria-pressed={mode === 'select'} title="Inspecter un élément · F12"><Icon name="cursor" size={15} /><span>Inspecter</span></button><button ref={fullscreenButtonRef} className="stage-fullscreen" type="button" onClick={onFullscreen} aria-label={fullscreen ? 'Quitter le plein écran de l’Atelier' : 'Afficher l’Atelier en plein écran'} aria-pressed={fullscreen}><Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={15} /><span>{fullscreen ? 'Réduire' : 'Plein écran'}</span></button></div></header><div className="visual-canvas-body">{remote
        ? <RemotePreview projectId={project.id} device={device} visible={remotePreviewVisible} embedded automaticAudit={false} allowUpscale={fullscreen} onResize={onResize} onAudit={() => undefined} onState={(state) => onPathChange(state.path)} onNotice={onNotice} />
        : mode === 'compare' ? <div className="before-after-grid visual-before-after"><div className="comparison-pane"><header><span>Avant</span><strong>Source</strong></header><PreviewFrame compact zoomable allowUpscale={fullscreen} project={project} origin={project.previewOrigin} device={device} path={path} label="Avant — Source" onPathChange={onPathChange} onEscape={() => fullscreen && onFullscreen()} /></div><div className="comparison-pane comparison-pane--after"><header><span>Après</span><strong>{operations.length} ajustement{operations.length > 1 ? 's' : ''}</strong></header><PreviewFrame compact zoomable allowUpscale={fullscreen} project={project} origin={project.previewOrigin} device={device} path={path} label="Après — Atelier" visualCss={visualCss} onPathChange={onPathChange} onEscape={() => fullscreen && onFullscreen()} /></div></div>
          : <PreviewFrame project={project} origin={project.previewOrigin} device={device} path={path} resizable allowUpscale={fullscreen} zoomable inspectorEnabled={mode === 'select'} composerEnabled={mode === 'compose'} focusSelector={mode === 'compose' || mode === 'select' ? target?.selector : null} visualCss={visualCss} onInspectElement={onInspect} onInspectorStop={onInspectorStop} onInspectorShortcut={() => onMode(mode === 'select' ? 'interact' : 'select')} onComposerGesture={onGesture} onComposerVerified={onGestureVerified} onComposerRejected={onGestureRejected} onComposerNotice={onNotice} onResize={onResize} onPathChange={onPathChange} onEscape={() => fullscreen && onFullscreen()} />}</div><footer><span className="source-badge"><i />Preview temporaire</span><small>{mode === 'compose' ? 'Glisser : déplacer · Poignées : redimensionner · Maj + glisser : réordonner · ⌥ + clic : cibler dans un bloc.' : mode === 'select' ? 'Les clics sont capturés ; repassez en mode Tester pour naviguer.' : mode === 'interact' ? 'Le vrai site fonctionne avec les changements temporaires.' : 'Aucun fichier n’est modifié pendant cette étape.'}</small></footer></section>
      <VisualPropertiesPanel target={target} scope={scope} routeScope={routeScope} multipleConfirmed={multipleConfirmed} operations={operations} authorization={authorization} onMultipleConfirmed={onMultipleConfirmed} onProperty={onProperty} onRemoveOperation={onRemoveOperation} onOpenCode={onOpenCode} />
    </div>
    <footer className="visual-change-tray"><div className="visual-change-summary"><span className="visual-change-count">{operations.length}</span><span><strong>Changement{operations.length > 1 ? 's' : ''} dans l’Atelier</strong><small>{operations.length ? `${new Set(operations.map((operation) => operation.target.selector)).size} cible${new Set(operations.map((operation) => operation.target.selector)).size > 1 ? 's' : ''} · ${operationScopeSummary}` : 'Sélectionnez un élément pour commencer.'}</small></span></div><div className="visual-change-list">{operations.slice(-3).map((operation) => <span key={operation.id}><code>{operation.property}</code><b>{operation.after}</b><button onClick={() => onRemoveOperation(operation.id)} aria-label={`Retirer ${operation.property}`}><Icon name="close" size={11} /></button></span>)}{operations.length > 3 && <em>+{operations.length - 3}</em>}</div><div className="visual-tray-actions">{operations.length > 0 && <button className="text-button" type="button" onClick={onClear} disabled={busy}>Tout effacer</button>}{authorization.persistable ? <><button className="button button--secondary visual-commit-action" type="button" onClick={onPrepare} disabled={!operations.length || busy} title="Prépare un aperçu et un diff sans modifier les fichiers."><Icon name="changes" size={15} /><span><strong>Réviser sans modifier</strong><small>Aperçu + diff · fichiers intacts</small></span></button><button className="button button--primary visual-commit-action" type="button" onClick={onApply} disabled={!operations.length || busy} title="Écrit les ajustements dans les fichiers, puis réanalyse le projet."><Icon name="check" size={15} /><span><strong>Appliquer aux fichiers</strong><small>Écrit puis réanalyse · annulable</small></span></button></> : <button className="button button--primary visual-commit-action" type="button" onClick={onApply} disabled={!operations.length || busy}><Icon name="export" size={15} /><span><strong>Préparer l’export CSS</strong><small>Aucune écriture dans le framework</small></span></button>}</div></footer>
  </div>
}

function PreparationOverlay({ progress }: { progress: ProjectPreparationProgress }): ReactElement {
  const percentage = Math.max(8, Math.min(100, Math.round((progress.step / Math.max(progress.total, 1)) * 100)))
  const networkSession = /url|chromium|localhost|distant|session isolée/i.test(`${progress.label} ${progress.detail ?? ''}`)
  return <div className="preparation-overlay" role="dialog" aria-modal="true" aria-labelledby="preparation-title" aria-describedby="preparation-detail">
    <section className="preparation-card">
      <header><div className="preparation-mark"><Mark /><span className="preparation-orbit" /></div><div><span className="overline">Préparation contrôlée</span><h2 id="preparation-title">Le laboratoire prend forme</h2></div><span className="preparation-step">{progress.step}/{progress.total}</span></header>
      <div className="preparation-progress" aria-hidden="true"><i style={{ width: `${percentage}%` }} /></div>
      <div className="preparation-copy" aria-live="polite"><span className="loading-mark" /><div><strong>{progress.label}</strong><p id="preparation-detail">{progress.detail ?? 'Responsiver inspecte le projet sans envoyer ni modifier aucun fichier.'}</p></div></div>
      <footer><span><Icon name="shield" size={14} /> {networkSession ? 'Session réseau isolée' : 'Analyse hors ligne'}</span><span>Sources intactes</span><span>Aucun script de build lancé</span></footer>
    </section>
  </div>
}

function recentDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date inconnue'
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function availabilityLabel(project: RecentProjectSummary): string {
  if (project.availability === 'missing') return 'Chemin introuvable'
  if (project.availability === 'unreadable') return 'Accès indisponible'
  if (project.availability === 'unsupported') return 'Entrée non prise en charge'
  return 'Disponible'
}

function ProjectsView({ project, projectPath, publicUrl, localhostUrl, localhostRoot, recentProjects, recentLoading, forgettingRecentId, busy, onPath, onPublicUrl, onLocalhostUrl, onLocalhostRoot, onChooseLocalhostRoot, onOpenPublic, onOpenLocalhost, onOpenFolder, onOpenFile, onOpenPath, onOpenRecent, onForgetRecent, onDemo, onContinue, onDrop }: {
  project: (ProjectSnapshot & ProjectExtra) | null
  projectPath: string
  publicUrl: string
  localhostUrl: string
  localhostRoot: string
  recentProjects: RecentProjectSummary[]
  recentLoading: boolean
  forgettingRecentId: string | null
  busy: boolean
  onPath: (value: string) => void
  onPublicUrl: (value: string) => void
  onLocalhostUrl: (value: string) => void
  onLocalhostRoot: (value: string) => void
  onChooseLocalhostRoot: () => void
  onOpenPublic: () => void
  onOpenLocalhost: () => void
  onOpenFolder: () => void
  onOpenFile: () => void
  onOpenPath: () => void
  onOpenRecent: (id: string) => void
  onForgetRecent: (id: string) => void
  onDemo: () => void
  onContinue: () => void
  onDrop: (file: File) => void
}): ReactElement {
  const [dragging, setDragging] = useState(false)
  const formerProjects = recentProjects.filter((item) => !item.isActive).slice(0, 5)
  const readiness = project?.previewReadiness
  const blocked = readiness?.status === 'blocked' || readiness?.status === 'needs-build'
  const themeCount = project?.theme.detected === 'dual' ? 2 : project?.theme.detected === 'unknown' ? 0 : 1
  return <div className="projects-page">
    <header className="page-head"><div><span className="overline">Bibliothèque locale</span><h1>Vos projets, prêts à être éprouvés.</h1><p>À chaque ouverture, Responsiver relit les sources, prépare les constats et vérifie qu’un rendu exploitable existe avant d’ouvrir le laboratoire.</p></div><button className="button button--primary" onClick={onOpenFolder} disabled={busy}><Icon name="plus" /> Nouveau projet</button></header>
    <section className={dragging ? 'drop-zone is-dragging' : 'drop-zone'} onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !busy) onDrop(file) }}>
      <div className="drop-mark"><Mark /></div><div><h2>Déposez le projet, Responsiver prépare le reste</h2><p>Site statique, dossier complet ou artefact compilé existant. Rien ne quitte cette machine.</p></div><div className="drop-actions"><button className="button button--primary" onClick={onOpenFolder} disabled={busy}><Icon name="folder" /> Choisir un dossier</button><button className="button button--secondary" onClick={onOpenFile} disabled={busy}><Icon name="file" /> Choisir un fichier</button></div>
    </section>
    <form className="path-bar" onSubmit={(event) => { event.preventDefault(); onOpenPath() }}><label htmlFor="project-path">Chemin local</label><input id="project-path" value={projectPath} onChange={(event) => onPath(event.target.value)} placeholder="/Users/vous/Sites/mon-projet" spellCheck={false} /><button className="button button--secondary" disabled={busy}>Ouvrir</button></form>
    <section className="source-entry-grid" aria-label="Autres sources à auditer">
      <form className="source-entry-card source-entry-card--url" onSubmit={(event) => { event.preventDefault(); onOpenPublic() }}><header><span>URL—01</span><div><strong>Tester une URL publique</strong><small>Navigation réelle · lecture seule</small></div><i /></header><p>Ouvrez un site HTTPS dans une partition éphémère, puis mesurez sa responsivité sur cinq largeurs.</p><label htmlFor="public-url"><span>Adresse HTTPS</span><input id="public-url" type="url" value={publicUrl} onChange={(event) => onPublicUrl(event.target.value)} placeholder="https://rfielbal.fr" spellCheck={false} /></label><footer><span><Icon name="shield" size={14} /> Aucun cookie conservé</span><button className="button button--primary" disabled={busy || !publicUrl.trim()}>Auditer l’URL</button></footer></form>
      <form className="source-entry-card source-entry-card--localhost" onSubmit={(event) => { event.preventDefault(); onOpenLocalhost() }}><header><span>DEV—02</span><div><strong>Connecter un localhost</strong><small>Symfony, Docker, Vite ou autre serveur</small></div><i /></header><p>Responsiver se connecte au serveur déjà lancé. Associez son dossier pour activer l’éditeur sans accéder directement à la base.</p><div className="localhost-fields"><label htmlFor="localhost-url"><span>Adresse locale</span><input id="localhost-url" value={localhostUrl} onChange={(event) => onLocalhostUrl(event.target.value)} placeholder="http://localhost:8080" spellCheck={false} /></label><label htmlFor="localhost-root"><span>Dossier source facultatif</span><span className="localhost-root-field"><input id="localhost-root" value={localhostRoot} onChange={(event) => onLocalhostRoot(event.target.value)} placeholder="/Users/vous/Sites/projet-symfony" spellCheck={false} /><button type="button" onClick={onChooseLocalhostRoot} disabled={busy} aria-label="Choisir le dossier source"><Icon name="folder" size={15} /></button></span></label></div><footer><span><Icon name="shield" size={14} /> Aucune commande Docker lancée</span><button className="button button--secondary" disabled={busy || !localhostUrl.trim()}>Connecter</button></footer></form>
    </section>
    <section className="project-list"><div className="section-heading"><div><span className="overline">Session</span><h2>{project ? 'Projet actif' : 'Commencer sans configuration'}</h2></div><button className="text-button" onClick={onDemo}>Ouvrir la démo locale <Icon name="arrow" size={15} /></button></div>
      {project ? <><article className={blocked ? 'project-row project-row--blocked' : 'project-row'}><div className="project-symbol">{project.name.slice(0, 2).toUpperCase()}</div><div className="project-copy"><strong>{project.name}</strong><span>{project.kind} · {project.files} fichiers · {project.routes.length} page{project.routes.length !== 1 ? 's' : ''}</span>{project.capabilities?.buildRequired && <span className="project-warning">Sources à compiler : Responsiver ne lance aucun script de projet sans votre accord.</span>}<code title={project.root}>{project.root}</code></div><div className="project-metrics"><span><b>{project.issues.length}</b> constat{project.issues.length !== 1 ? 's' : ''}</span><span><b>{themeCount}</b> {themeCount === 0 ? 'à qualifier' : `thème${themeCount > 1 ? 's' : ''}`}</span></div><button className={blocked ? 'button button--secondary' : 'button button--primary'} onClick={onContinue}>{blocked ? 'Voir le diagnostic' : 'Laboratoire'} <Icon name="arrow" /></button></article>
        {blocked && readiness && <div className="readiness-card" role="alert"><div className="readiness-icon"><Icon name="finding" /></div><div><span className="overline">Rendu non exploitable</span><strong>{readiness.summary}</strong><p>Responsiver n’invente pas une interface absente et ne masque plus ce problème derrière une prévisualisation blanche.</p><ul>{readiness.diagnostics.slice(0, 4).map((diagnostic) => <li key={diagnostic.code}><b>{diagnostic.title}</b><span>{diagnostic.detail}</span></li>)}</ul></div></div>}
      </> : <div className="empty-project"><Icon name="shield" /><p>La démo utilise le même runner local que vos projets : navigation, scripts et analyse sont réellement exercés.</p></div>}
    </section>
    <section className="recent-section"><div className="section-heading"><div><span className="overline">Mémoire locale</span><h2>Anciens projets</h2></div><span className="privacy-note"><Icon name="shield" size={13} /> Chemins et métadonnées · aucun code</span></div>
      {recentLoading ? <div className="recent-skeleton" role="status"><span /><span /><span /></div> : formerProjects.length ? <div className="recent-list">{formerProjects.map((item) => {
        const available = item.availability === 'available'
        return <article className={available ? 'recent-row' : 'recent-row is-unavailable'} key={item.id}><div className="recent-monogram">{item.name.slice(0, 2).toUpperCase()}</div><div className="recent-copy"><div><strong>{item.name}</strong><span className={available ? 'availability availability--ready' : 'availability'}><i /> {availabilityLabel(item)}</span></div><span>{item.kind} · {item.routes} page{item.routes !== 1 ? 's' : ''} · {item.issues} constat{item.issues !== 1 ? 's' : ''}</span><code title={item.selectionPath}>{item.selectionPath}</code></div><time dateTime={item.lastOpenedAt}>Ouvert le {recentDate(item.lastOpenedAt)}</time><button className="button button--secondary" onClick={() => onOpenRecent(item.id)} disabled={busy || !available}>Réanalyser <Icon name="arrow" size={15} /></button><button className="recent-forget" onClick={() => onForgetRecent(item.id)} disabled={busy || forgettingRecentId !== null} aria-label={`Retirer ${item.name} de l’historique`} title="Retirer de l’historique"><Icon name="close" size={14} /></button></article>
      })}</div> : <div className="empty-recent"><span>Historique</span><p>Les projets déjà ouverts apparaîtront ici. Responsiver ne mémorise que leur chemin local et relance toujours une analyse complète.</p></div>}
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
    <div className="dimension-fields"><label><span>Largeur</span><input inputMode="numeric" value={width} onChange={(event) => onWidth(event.target.value)} onBlur={(event) => onWidth(String(clampDimension(event.target.value, 240, 2560, 393)))} /><small>px</small></label><b aria-hidden="true">×</b><label><span>Hauteur</span><input inputMode="numeric" value={height} onChange={(event) => onHeight(event.target.value)} onBlur={(event) => onHeight(String(clampDimension(event.target.value, 320, 2000, 852)))} /><small>px</small></label><button className="icon-button rotate-button" onClick={onRotate} aria-label="Intervertir la largeur et la hauteur" title="Intervertir largeur et hauteur"><Icon name="swap" size={16} /></button></div>
  </div>
}

function proposalOutcomeNotice(snapshot: StagingSnapshot | null): string | undefined {
  if (!snapshot || snapshot.changes.length) return undefined
  const reasons = [...new Set((snapshot.outcomes ?? []).map((outcome) => outcome.reason).filter(Boolean))]
  return reasons.length ? reasons.join(' · ') : 'Aucune transformation applicable n’a été produite.'
}

function Inspector({ project, allIssues, activeIssueCount, totalIssueCount, showAllIssues, onShowAllIssues, tab, onTab, selectedIssue, selectedIds, queuedIds, visualEditCount, onPreviewIssue, onPreviewBatch, onToggleIssue, onToggleQueued, runtimeTheme, themeTarget, previewThemeTarget, onPreviewTheme, onRemoveTheme, proposal, proposalContext, previewBusy, staging, runtimeAudit, runtimeRenderStatus, instructions, onRemoveInstruction, messages, draft, onDraft, onSubmit, busy, expressVerification, onApplyExpress, onAcceptProposal, onAcceptAndApply, onRejectProposal, onApplySafe, undoAvailable, onUndo, directApplyAvailable, onReview, onClear, assistantRoute, assistantViewport, assistantScreenshot, workspaceEnabled, onWorkspacePreviewOrigin, onNotice, onOpenCode }: {
  project: ProjectSnapshot & ProjectExtra
  allIssues: ProjectIssue[]
  activeIssueCount: number
  totalIssueCount: number
  showAllIssues: boolean
  onShowAllIssues: (show: boolean) => void
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  selectedIssue: ProjectIssue | null
  selectedIds: string[]
  queuedIds: string[]
  visualEditCount: number
  onPreviewIssue: (issue: ProjectIssue) => void
  onPreviewBatch: (ids: string[]) => void
  onToggleIssue: (id: string) => void
  onToggleQueued: (id: string) => void
  runtimeTheme: RuntimeTheme
  themeTarget: ThemeTarget | null
  previewThemeTarget: ThemeTarget | null
  onPreviewTheme: (target: ThemeTarget) => void
  onRemoveTheme: () => void
  proposal: StagingSnapshot | null
  proposalContext: ProposalContext | null
  previewBusy: boolean
  staging: StagingSnapshot | null
  runtimeAudit: RuntimeAudit | null
  runtimeRenderStatus: RuntimeRenderState | null
  instructions: string[]
  onRemoveInstruction: (instruction: string) => void
  messages: ConversationMessage[]
  draft: string
  onDraft: (value: string) => void
  onSubmit: (event: FormEvent) => void
  busy: boolean
  expressVerification: ExpressVerificationState | null
  onApplyExpress: () => void
  onAcceptProposal: () => void
  onAcceptAndApply: () => void
  onRejectProposal: () => void
  onApplySafe: (ids: string[]) => void
  undoAvailable: boolean
  onUndo: () => void
  directApplyAvailable: boolean
  onReview: () => void
  onClear: () => void
  assistantRoute: string
  assistantViewport: RemoteViewport
  assistantScreenshot: string | null
  workspaceEnabled: boolean
  onWorkspacePreviewOrigin: (origin: string | null) => void
  onNotice: (message: string) => void
  onOpenCode: () => void
}): ReactElement {
  const [findingGroup, setFindingGroup] = useState<FindingGroup>('visual')
  const [showOtherVisualIssues, setShowOtherVisualIssues] = useState(false)
  useEffect(() => {
    setFindingGroup('visual')
    setShowOtherVisualIssues(false)
  }, [project.id])
  const consolidatedIssues = useMemo(() => consolidateProjectIssues(project.issues, allIssues), [allIssues, project.issues])
  const consolidatedAllIssues = useMemo(() => consolidateProjectIssues(allIssues), [allIssues])
  const classifiedIssues = useMemo(() => consolidatedIssues
    .map((issue) => ({ issue, policy: classifyProjectIssue(issue, allIssues) }))
    .sort((left, right) => right.policy.priority - left.policy.priority), [allIssues, consolidatedIssues])
  const allClassifiedIssues = useMemo(() => consolidatedAllIssues.map((issue) => ({ issue, policy: classifyProjectIssue(issue, allIssues) })), [allIssues, consolidatedAllIssues])
  const groupedIssues = {
    visual: classifiedIssues.filter(({ policy }) => policy.group === 'visual'),
    code: classifiedIssues.filter(({ policy }) => policy.group === 'code')
  }
  const groupItems = groupedIssues[findingGroup]
  const visibleItems = findingGroup === 'visual' && !showOtherVisualIssues ? groupItems.slice(0, 5) : groupItems
  const hiddenVisualCount = Math.max(0, groupedIssues.visual.length - 5)
  const activeSelectedIssue = classifiedIssues.find(({ issue }) => issue.id === selectedIssue?.id && classifyProjectIssue(issue, allIssues).group === findingGroup)?.issue ?? groupItems[0]?.issue ?? null
  const selectedPolicy = activeSelectedIssue ? classifyProjectIssue(activeSelectedIssue, allIssues) : null
  const issueExtra = activeSelectedIssue as (ProjectIssue & IssueExtra) | null
  const acceptedCount = selectedIds.length + instructions.length + visualEditCount + (themeTarget ? 1 : 0)
  const queuedSet = new Set(queuedIds)
  const acceptedSet = new Set(selectedIds)
  const selectedInstruction = deterministicInstructionForIssue(activeSelectedIssue)
  const selectedProposal = proposalContext?.kind !== 'batch' && proposalContext?.issueId === activeSelectedIssue?.id ? proposal : null
  const selectedAccepted = activeSelectedIssue ? acceptedSet.has(activeSelectedIssue.id) || Boolean(selectedInstruction && instructions.includes(selectedInstruction)) : false
  const canStage = project.source.kind === 'local-project' && !project.source.readOnly && Boolean(project.source.localRoot) && project.capabilities?.staging !== false
  const linkedWorkspace = project.source.kind === 'linked-localhost' && workspaceEnabled
  const selectedActionable = canStage && selectedPolicy?.action !== 'advisory' && Boolean(issueExtra?.fix && issueExtra.fix.kind !== 'manual' || selectedInstruction)
  const instructionProposal = proposalContext?.kind === 'instruction' ? proposal : null
  const queuedClassified = allClassifiedIssues.filter(({ issue, policy }) => queuedSet.has(issue.id) && policy.action !== 'advisory')
  const expressQueuedIds = queuedClassified.filter(({ issue }) => isExpressEligibleIssue(issue, allIssues)).map(({ issue }) => issue.id)
  const selectedExpressIds = allClassifiedIssues.filter(({ issue }) => selectedIds.includes(issue.id) && isExpressEligibleIssue(issue, allIssues)).map(({ issue }) => issue.id)
  const expressPlanEligible = selectedExpressIds.length > 0 && selectedExpressIds.length === selectedIds.length && !themeTarget && !instructions.length && !visualEditCount
  const queuedBatchIds = queuedClassified.map(({ issue }) => issue.id)
  const batchIssueIds = proposalContext?.kind === 'batch' ? proposalContext.issueIds ?? [] : []
  const batchIssues = batchIssueIds.map((id) => allIssues.find((issue) => issue.id === id)).filter((issue): issue is ProjectIssue => Boolean(issue))
  const batchProposal = proposalContext?.kind === 'batch' ? proposal : null
  const batchInstructionOutcomeByInstruction = new Map<string, NonNullable<StagingSnapshot['outcomes']>[number]>()
  if (batchProposal) {
    const instructionValues = [...new Set(batchIssues.map((issue) => {
      const instruction = deterministicInstructionForIssue(issue)
      const fix = (issue as ProjectIssue & IssueExtra).fix
      return instruction && (!fix || fix.kind === 'manual') ? instruction : null
    }).filter((instruction): instruction is string => Boolean(instruction)))]
    const availableOutcomes = (batchProposal.outcomes ?? []).filter((outcome) => outcome.kind === 'instruction')
    const claimedProposalIds = new Set<string>()
    for (const instruction of instructionValues) {
      const directChangeIds = new Set(batchProposal.changes.filter((change) => change.kind === 'instruction' && change.before === instruction).map((change) => change.id))
      const expectedStatus = batchProposal.recognizedInstructions?.includes(instruction) ? 'applied' : batchProposal.ignoredInstructions?.includes(instruction) ? 'skipped' : 'conflict'
      const outcome = availableOutcomes.find((candidate) => !claimedProposalIds.has(candidate.proposalId) && candidate.changeIds.some((id) => directChangeIds.has(id)))
        ?? availableOutcomes.find((candidate) => !claimedProposalIds.has(candidate.proposalId) && candidate.status === expectedStatus)
        ?? availableOutcomes.find((candidate) => !claimedProposalIds.has(candidate.proposalId))
      if (!outcome) continue
      claimedProposalIds.add(outcome.proposalId)
      batchInstructionOutcomeByInstruction.set(instruction, outcome)
    }
  }
  const batchProposalItems: ProposalItemSummary[] = batchProposal ? batchIssues.map((issue) => {
    const generatedInstruction = deterministicInstructionForIssue(issue)
    const instructionBacked = Boolean(generatedInstruction && (!(issue as ProjectIssue & IssueExtra).fix || (issue as ProjectIssue & IssueExtra).fix?.kind === 'manual'))
    if (instructionBacked && generatedInstruction) {
      const directChanges = batchProposal.changes.filter((change) => change.kind === 'instruction' && change.before === generatedInstruction)
      const outcome = batchInstructionOutcomeByInstruction.get(generatedInstruction)
      const outcomeChanges = outcome ? batchProposal.changes.filter((change) => outcome.changeIds.includes(change.id)) : []
      const recognized = batchProposal.recognizedInstructions?.includes(generatedInstruction)
      const ignored = batchProposal.ignoredInstructions?.includes(generatedInstruction)
      const status = outcome?.status ?? (recognized || directChanges.length ? 'applied' : ignored ? 'skipped' : 'skipped')
      return {
        id: issue.id,
        title: issue.title,
        status,
        reason: outcome?.reason ?? (status === 'applied' ? 'Correction responsive déterministe préparée.' : 'Aucune transformation suffisamment fiable n’a été produite.'),
        changes: directChanges.length ? directChanges : outcomeChanges
      }
    }
    const outcome = batchProposal.outcomes?.find((candidate) => candidate.proposalId === issue.id || candidate.findingIds.includes(issue.id))
    const directChanges = outcome ? batchProposal.changes.filter((change) => outcome.changeIds.includes(change.id)) : []
    return {
      id: issue.id,
      title: issue.title,
      status: outcome?.status ?? (directChanges.length ? 'applied' : 'skipped'),
      reason: outcome?.reason ?? (directChanges.length ? 'Transformation préparée.' : 'Aucune transformation suffisamment fiable n’a été produite.'),
      changes: directChanges
    }
  }) : []
  const batchAppliedIds = new Set(batchProposalItems.filter((item) => item.status === 'applied').map((item) => item.id))
  const batchAccepted = batchAppliedIds.size > 0 && batchIssues.filter((issue) => batchAppliedIds.has(issue.id)).every((issue) => issueIsRetained(issue, selectedIds, instructions))
  const queuedBatchIsDisplayed = Boolean(batchProposal && batchIssueIds.length === queuedBatchIds.length && queuedBatchIds.every((id) => batchIssueIds.includes(id)))
  const batchSelectionStale = Boolean(batchProposal && !queuedBatchIsDisplayed && !batchAccepted)
  const showPlanBar = tab === 'findings' || tab === 'fixes'
  return <aside className="inspector" aria-label="Inspecteur">
    <div className="inspector-tabs" role="tablist" aria-label="Outils d’analyse">{inspectorTabs.map((item) => <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} key={item.id} onClick={() => onTab(item.id)} title={item.label}><Icon name={item.icon} size={16} /><span>{item.label}</span>{item.id === 'findings' && <b>{consolidatedIssues.length}</b>}</button>)}</div>
    <div className="inspector-content">
      {showPlanBar && <section className="change-plan-bar" aria-label="Plan de changements">
        <div className="change-plan-title"><Icon name="changes" size={15} /><span><strong>Plan de changements</strong><small>Sélectionnez, comparez, puis conservez uniquement les corrections utiles.</small></span></div>
        <div className="change-plan-counts"><span><b>{acceptedCount}</b> validé{acceptedCount > 1 ? 's' : ''}</span><span className={queuedClassified.length ? 'is-pending' : ''}><b>{queuedClassified.length}</b> sélectionné{queuedClassified.length > 1 ? 's' : ''}</span>{staging && <span><b>{staging.changes.length}</b> préparé{staging.changes.length > 1 ? 's' : ''}</span>}</div>
        <div className="change-plan-actions">
          {undoAvailable && <button className="text-button" type="button" onClick={onUndo} disabled={busy}><Icon name="back" size={13} /> Annuler la dernière application</button>}
          {expressQueuedIds.length > 0 && acceptedCount === 0 && directApplyAvailable && <button className="button button--quiet button--compact" type="button" onClick={() => onApplySafe(expressQueuedIds)} disabled={busy || previewBusy}><Icon name="shield" size={13} /> Corriger et vérifier ({expressQueuedIds.length})</button>}
          {queuedBatchIds.length > 0 && !queuedBatchIsDisplayed && <button className="button button--primary button--compact" type="button" onClick={() => onPreviewBatch(queuedBatchIds)} disabled={busy || previewBusy}><Icon name="compare" size={13} /> Comparer la sélection ({queuedBatchIds.length})</button>}
          {acceptedCount > 0 && <button className="button button--secondary button--compact" type="button" onClick={() => onTab('fixes')}><Icon name="changes" size={13} /> Réviser les corrections</button>}
        </div>
      </section>}
      {showPlanBar && previewBusy && proposalContext?.kind === 'batch' && <div className="proposal-pending batch-proposal-pending" role="status"><span className="loading-mark" /> Préparation de la comparaison groupée…</div>}
      {showPlanBar && batchProposal && <section className="batch-proposal" aria-label="Comparaison de la sélection"><ProposalDecision title={`${batchIssueIds.length} constat${batchIssueIds.length > 1 ? 's comparés' : ' comparé'}`} accepted={batchAccepted} changeCount={batchProposal.changes.length} items={batchProposalItems} disabled={busy} acceptDisabled={batchSelectionStale} notice={batchSelectionStale ? 'La sélection a changé depuis cette comparaison. Écartez ce résultat ou relancez la comparaison du lot actuel.' : undefined} onAccept={onAcceptProposal} onApply={directApplyAvailable ? onAcceptAndApply : undefined} onReject={onRejectProposal} /></section>}
      {tab === 'findings' && <><div className="inspector-heading"><div><span className="overline">Analyse déterministe</span><h2>Constats</h2></div>{runtimeAudit && <span className="live-chip"><i /> Direct</span>}</div>
        <div className="finding-groups" role="tablist" aria-label="Catégorie de constats"><button type="button" role="tab" aria-selected={findingGroup === 'visual'} aria-controls="finding-list" className={findingGroup === 'visual' ? 'is-active' : ''} onClick={() => setFindingGroup('visual')}><Icon name="compare" size={14} /><span><strong>Rendu & responsive</strong><small>Défauts réellement observés</small></span><b>{groupedIssues.visual.length}</b></button><button type="button" role="tab" aria-selected={findingGroup === 'code'} aria-controls="finding-list" className={findingGroup === 'code' ? 'is-active' : ''} onClick={() => setFindingGroup('code')}><Icon name="code" size={14} /><span><strong>Code & structure</strong><small>Diffs, sémantique et environnement</small></span><b>{groupedIssues.code.length}</b></button></div>
        <div className="issue-scope" role="group" aria-label="Portée des constats"><button className={!showAllIssues ? 'is-active' : ''} onClick={() => onShowAllIssues(false)}>Page active <b>{consolidatedIssues.length}</b></button><button className={showAllIssues ? 'is-active' : ''} onClick={() => onShowAllIssues(true)}>Toutes les pages <b>{consolidatedAllIssues.length}</b></button></div>
        {project.analysis?.truncated && <div className="runtime-alert runtime-alert--errors" role="status"><Icon name="info" size={16} /><div><strong>Analyse partielle signalée</strong><span>Une limite de sécurité sur le nombre de fichiers, de nœuds ou de constats a été atteinte. Les résultats visibles restent valides, mais ne couvrent pas nécessairement toute la page.</span></div></div>}
        {project.previewReadiness?.status === 'degraded' && <div className="runtime-alert"><Icon name="info" size={16} /><div><strong>Prévisualisation disponible avec limites</strong><span>{project.previewReadiness.summary} Les points concernés figurent dans les constats ci-dessous.</span></div></div>}
        {linkedWorkspace && !canStage && <div className="runtime-alert"><Icon name="code" size={16} /><div><strong>Rendu localhost et sources associées</strong><span>L’audit visuel utilise le serveur réel. Les adaptations de framework restent manuelles dans Code tant qu’un correctif ne peut pas être relié sûrement à son fichier auteur.</span></div></div>}
        {project.previewBasePath && <div className="runtime-alert runtime-alert--artifact"><Icon name="info" size={16} /><div><strong>Audit sur une sortie compilée</strong><span>Les corrections ciblent {project.previewBasePath}. Un prochain build peut les écraser : reportez ensuite les changements utiles dans les sources.</span></div></div>}
        {runtimeRenderStatus && runtimeRenderStatus.failureCount > 0 && <div className="runtime-alert runtime-alert--errors" aria-live="polite"><Icon name="finding" size={16} /><div><strong>{runtimeRenderStatus.failureCount} erreur{runtimeRenderStatus.failureCount > 1 ? 's' : ''} observée{runtimeRenderStatus.failureCount > 1 ? 's' : ''} pendant le rendu</strong><span>{runtimeRenderStatus.firstFailure ?? 'Le site reste navigable ; vérifiez les scripts et ressources signalés dans la console du projet.'}</span></div></div>}
        {runtimeAudit && runtimeAudit.overflowCount > 0 && <div className="runtime-alert"><Icon name="ruler" size={16} /><div><strong>{runtimeAudit.overflowCount} débordement{runtimeAudit.overflowCount > 1 ? 's' : ''} visible{runtimeAudit.overflowCount > 1 ? 's' : ''}</strong><span>Mesuré à {runtimeAudit.viewportWidth}px sur la page active.</span></div></div>}
        <div className="issue-list" id="finding-list" role="tabpanel">{visibleItems.length ? visibleItems.map(({ issue, policy }) => {
          const generatedInstruction = deterministicInstructionForIssue(issue)
          const accepted = acceptedSet.has(issue.id) || Boolean(generatedInstruction && instructions.includes(generatedInstruction))
          const queued = queuedSet.has(issue.id)
          const fix = (issue as ProjectIssue & IssueExtra).fix
          const previewable = policy.action !== 'advisory' && Boolean(generatedInstruction || fix && fix.kind !== 'manual')
          const badge = findingPolicyBadge(policy)
          const selectable = previewable && canStage
          return <div key={issue.id} className={`${queued ? 'issue-row is-pending' : 'issue-row'}${accepted ? ' is-accepted' : ''}`}>
            {selectable ? <label className="issue-selector" title={accepted ? 'Retirer ce correctif du plan' : queued ? 'Retirer de la sélection' : 'Sélectionner pour comparaison'}><input type="checkbox" checked={accepted || queued} disabled={busy} onChange={() => accepted ? onToggleIssue(issue.id) : onToggleQueued(issue.id)} aria-label={accepted ? `${issue.title} — retirer du plan` : queued ? `${issue.title} — retirer de la sélection` : `${issue.title} — sélectionner pour comparaison`} /><span aria-hidden="true"><Icon name="check" size={11} /></span></label> : <span className="issue-selector issue-selector--manual" title="Correction manuelle"><Icon name="code" size={13} /><span className="sr-only">Correction manuelle</span></span>}
            <button className={`${activeSelectedIssue?.id === issue.id ? 'issue-item is-active' : 'issue-item'}${accepted ? ' is-accepted' : ''}`} onClick={() => onPreviewIssue(issue)} disabled={busy} aria-label={`${issue.title} — ${previewable ? policy.verification === 'source-diff' ? 'relire le changement de code' : 'prévisualiser l’avant et l’après' : 'localiser le constat'}`}><i className={`severity-dot severity-dot--${issue.severity}`} /><span><strong>{issue.title}</strong><small>{(issue as ProjectIssue & IssueExtra).routePath ?? issue.viewport}</small><span className={`finding-badge finding-badge--${badge.tone}`}>{badge.label}</span></span><em>{accepted ? 'Validé' : queued ? 'Sélectionné' : severityLabel(issue)}</em></button>
          </div>
        }) : <div className="empty-panel"><Icon name="check" /><strong>{findingGroup === 'visual' ? 'Aucun défaut visuel prioritaire' : 'Aucun constat de code'}</strong><span>{findingGroup === 'visual' ? 'Continuez la vérification sur les trois familles d’appareils.' : 'La structure connue ne présente aucun signal à relire.'}</span></div>}</div>
        {findingGroup === 'visual' && hiddenVisualCount > 0 && <button className="show-more-findings" type="button" onClick={() => setShowOtherVisualIssues((current) => !current)} aria-expanded={showOtherVisualIssues}>{showOtherVisualIssues ? 'Revenir aux 5 priorités' : `Afficher les ${hiddenVisualCount} autres constats`}</button>}
        {activeSelectedIssue && <article className="issue-detail"><header><span className={`severity severity--${activeSelectedIssue.severity}`}>{severityLabel(activeSelectedIssue)}</span><span className={`finding-badge finding-badge--${findingPolicyBadge(selectedPolicy!).tone}`}>{findingPolicyBadge(selectedPolicy!).label}</span><code>{activeSelectedIssue.rule}</code></header><h3>{activeSelectedIssue.title}</h3><p>{activeSelectedIssue.description}</p><dl><div><dt>Source</dt><dd>{activeSelectedIssue.source ? <code>{activeSelectedIssue.source.file}:{activeSelectedIssue.source.line}</code> : activeSelectedIssue.evidence?.selector ? <code>{activeSelectedIssue.evidence.selector}</code> : 'Mesure à l’exécution'}</dd></div><div><dt>Proposition</dt><dd>{activeSelectedIssue.proposal}</dd></div>{activeSelectedIssue.confidence && <div><dt>Confiance</dt><dd>{activeSelectedIssue.confidence === 'certain' ? 'Certaine' : activeSelectedIssue.confidence === 'probable' ? 'Probable' : 'À vérifier'}</dd></div>}</dl>{activeSelectedIssue.source && workspaceEnabled && <button className="text-button issue-code-link" onClick={onOpenCode}><Icon name="code" size={14} /> Ouvrir le fichier associé</button>}
          {!selectedActionable ? <div className="manual-review"><Icon name="info" size={15} /><span>Ce point reste consultatif : Responsiver vous mène à sa source sans inventer de transformation automatique.</span></div> : previewBusy && proposalContext?.issueId === activeSelectedIssue.id ? <div className="proposal-pending" role="status"><span className="loading-mark" /> {selectedPolicy?.verification === 'source-diff' ? 'Préparation du diff…' : selectedPolicy?.verification === 'both' ? 'Préparation du rendu et du diff…' : 'Préparation de l’avant / après…'}</div> : selectedProposal ? <ProposalDecision title={selectedPolicy?.verification === 'source-diff' ? 'Changement de code isolé' : selectedPolicy?.verification === 'both' ? 'Correctif visuel et code' : 'Correctif visuel isolé'} accepted={selectedAccepted} changeCount={selectedProposal.changes.length} changes={selectedPolicy?.verification === 'source-diff' || selectedPolicy?.verification === 'both' ? selectedProposal.changes : undefined} notice={proposalOutcomeNotice(selectedProposal)} disabled={busy} onAccept={onAcceptProposal} onApply={directApplyAvailable ? onAcceptAndApply : undefined} onReject={onRejectProposal} /> : <button className="button button--primary button--full" onClick={() => onPreviewIssue(activeSelectedIssue)} disabled={busy}><Icon name={selectedPolicy?.verification === 'source-diff' ? 'code' : 'compare'} />{selectedPolicy?.verification === 'source-diff' ? 'Relire le changement' : selectedPolicy?.verification === 'both' ? 'Comparer le rendu et le diff' : 'Voir l’avant / après'}</button>}
        </article>}
      </>}
      {tab === 'fixes' && <><div className="inspector-heading"><div><span className="overline">Choix explicitement validés</span><h2>Correctifs</h2></div><strong className="count-badge">{acceptedCount}</strong></div>{!canStage && <div className="manual-review"><Icon name="info" size={15} /><span>{linkedWorkspace ? 'Le rendu est bien auditable. Utilisez Code pour modifier les sources associées ; Responsiver ne génère pas de patch de framework sans correspondance source fiable.' : 'Rendez d’abord l’entrée exploitable, puis réanalysez le projet. Aucun correctif ne sera généré sur un layout absent.'}</span></div>}<div className="fix-list">{acceptedCount ? <>
        {allIssues.filter((issue) => selectedIds.includes(issue.id)).map((issue) => { const badge = findingPolicyBadge(classifyProjectIssue(issue, allIssues)); return <article key={issue.id}><span className={`finding-badge finding-badge--${badge.tone}`}>{badge.label}</span><strong>{issue.title}</strong><code>{issue.source?.file ?? issue.rule}</code><button onClick={() => onToggleIssue(issue.id)} disabled={busy} aria-label={`Retirer ${issue.title}`}><Icon name="close" size={14} /></button></article> })}
        {themeTarget && <article><span className="confidence confidence--safe">Thème</span><strong>Variante {themeTarget === 'dark' ? 'sombre' : 'claire'}</strong><code>Palette complémentaire validée</code><button onClick={onRemoveTheme} disabled={busy} aria-label={`Retirer la variante ${themeTarget === 'dark' ? 'sombre' : 'claire'}`}><Icon name="close" size={14} /></button></article>}
        {instructions.map((instruction) => <article key={instruction}><span className="confidence">Instruction</span><strong>{instruction}</strong><code>Règle locale déterministe</code><button onClick={() => onRemoveInstruction(instruction)} disabled={busy} aria-label={`Retirer l’instruction ${instruction}`}><Icon name="close" size={14} /></button></article>)}
        {visualEditCount > 0 && <article><span className="confidence confidence--safe">Atelier</span><strong>{visualEditCount} ajustement{visualEditCount > 1 ? 's visuels' : ' visuel'}</strong><code>Conservé dans le plan de corrections</code></article>}
      </> : <div className="empty-panel"><Icon name="changes" /><strong>Aucun choix validé</strong><span>Prévisualisez un constat, un thème ou une instruction, puis validez sa proposition.</span></div>}</div>
        {queuedClassified.length > 0 && <section className="pending-fixes"><header><span><i /> Sélection à comparer</span><strong>{queuedClassified.length}</strong></header><p>{queuedBatchIsDisplayed ? 'La comparaison est affichée ci-dessus. Validez-la pour conserver ce lot.' : 'Ces constats ne rejoindront le plan qu’après votre validation de la comparaison.'}</p><div>{queuedClassified.slice(0, 4).map(({ issue, policy }) => <button type="button" key={issue.id} onClick={() => onPreviewIssue(issue)}><span>{issue.title}</span><em>{policy.group === 'visual' ? 'Avant/après' : policy.action === 'auto-safe' ? 'Diff sûr' : 'À relire'}</em></button>)}</div>{queuedClassified.length > 4 && <small>+ {queuedClassified.length - 4} autre{queuedClassified.length - 4 > 1 ? 's' : ''}</small>}{!queuedBatchIsDisplayed && <button className="button button--secondary button--full" type="button" onClick={() => onPreviewBatch(queuedBatchIds)} disabled={busy || previewBusy}>Comparer la sélection ({queuedBatchIds.length})</button>}</section>}
        {expressVerification && <section className={`express-verdict is-${expressVerification.result.report.status}`} aria-live="polite"><header><span><Icon name="shield" size={15} /> Correction Express</span><strong>{expressVerification.result.report.status === 'passed' ? 'Vérifiée' : 'À réviser'}</strong></header><h3>{expressVerification.result.report.status === 'passed' ? 'Prêt à appliquer' : expressVerification.result.report.status === 'blocked' ? 'Régression détectée' : 'Preuve incomplète'}</h3><p>{expressVerification.result.report.status === 'passed' ? `${expressVerification.result.report.comparableCells} vues comparées · ${expressVerification.result.report.fixed.length} signal${expressVerification.result.report.fixed.length > 1 ? 's corrigés' : ' corrigé'} · 0 régression.` : expressVerification.result.report.reasons[0] ?? 'La vérification demande une révision manuelle.'}</p>{expressVerification.token ? <button className="button button--primary button--full" type="button" onClick={onApplyExpress} disabled={busy}><Icon name="check" size={14} /> Appliquer la version vérifiée</button> : <button className="button button--secondary button--full" type="button" onClick={onReview} disabled={busy}>Ouvrir la révision</button>}</section>}
        {staging && <div className="staging-summary"><span><i /> Version corrigée prête</span><strong>{staging.changes.length} changement{staging.changes.length > 1 ? 's' : ''} · {staging.changedFiles.length} fichier{staging.changedFiles.length > 1 ? 's' : ''}</strong><button className="text-button" onClick={onClear} disabled={busy}>Supprimer la version préparée</button></div>}
        {expressPlanEligible && !expressVerification && <button className="button button--secondary button--full inspector-action" type="button" onClick={() => onApplySafe(selectedExpressIds)} disabled={busy || previewBusy}><Icon name="shield" size={14} /> Corriger et vérifier</button>}
        <button className="button button--primary button--full inspector-action" onClick={onReview} disabled={busy || previewBusy || !acceptedCount || !canStage}>{busy ? 'Préparation…' : staging ? 'Ouvrir la révision' : 'Préparer et ouvrir la révision'} <Icon name="arrow" /></button>
      </>}
      {tab === 'theme' && <>{!canStage && <div className="manual-review"><Icon name="info" size={15} /><span>La variante de thème sera disponible après qu’un rendu exploitable aura été détecté.</span></div>}<ThemePanel project={project} runtimeTheme={runtimeTheme} acceptedTarget={themeTarget} previewTarget={previewThemeTarget} proposal={proposalContext?.kind === 'theme' ? proposal : null} busy={previewBusy} disabled={busy || !canStage} onPreview={onPreviewTheme} onAccept={onAcceptProposal} onReject={onRejectProposal} onRemoveAccepted={onRemoveTheme} /></>}
      {tab === 'conversation' && <div className="assistant-stack">
        <LocalAssistant key={project.id} project={project} route={assistantRoute} viewport={assistantViewport} screenshotDataUrl={assistantScreenshot} workspaceEnabled={workspaceEnabled} onNotice={onNotice} onPreviewOrigin={onWorkspacePreviewOrigin} />
        <section className="deterministic-assistant"><header><div><span className="overline">Ajustements rapides</span><h3>Sans modèle</h3></div><span className="rule-chip">Hors ligne</span></header>{!canStage && <div className="manual-review"><Icon name="info" size={15} /><span>{linkedWorkspace ? 'Les ajustements automatiques ne ciblent pas encore les templates du framework. Le studio Code reste disponible avec aperçu CSS sur le localhost.' : 'Les ajustements déterministes exigent un projet local avec un rendu exploitable.'}</span></div>}<div className="conversation">{messages.map((message) => <div className={`message message--${message.author}`} key={message.id}><span>{message.author === 'user' ? 'Vous' : 'Responsiver'}</span><p>{message.text}</p></div>)}</div>{previewBusy && proposalContext?.kind === 'instruction' && <div className="proposal-pending" role="status"><span className="loading-mark" /> Interprétation locale…</div>}{instructionProposal && proposalContext?.instruction && <ProposalDecision title="Ajustement prévisualisé" accepted={instructions.includes(proposalContext.instruction)} changeCount={instructionProposal.changes.length} notice={proposalOutcomeNotice(instructionProposal)} disabled={busy || !canStage} onAccept={onAcceptProposal} onReject={onRejectProposal} />}<form className="prompt-form" onSubmit={onSubmit}><label htmlFor="instruction">Nouvel ajustement</label><textarea id="instruction" value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Ex. Réduis les arrondis et utilise #b94d32 comme couleur d’accent." rows={4} disabled={!canStage} /><div><small>Couleur · espacement · rayon · texte · navigation</small><button className="button button--primary" disabled={busy || previewBusy || !draft.trim() || !canStage}>Prévisualiser</button></div></form></section>
      </div>}
    </div>
  </aside>
}

function ProposalDecision({ title, accepted, changeCount, changes, items, disabled = false, acceptDisabled = false, notice, onAccept, onApply, onReject }: { title: string; accepted: boolean; changeCount: number; changes?: StagingChange[]; items?: ProposalItemSummary[]; disabled?: boolean; acceptDisabled?: boolean; notice?: string; onAccept: () => void; onApply?: () => void; onReject: () => void }): ReactElement {
  const firstChange = changes?.[0]
  const applicableCount = items?.filter((item) => item.status === 'applied').length ?? 0
  const applicableSummary = applicableCount === 1 ? '1 correction peut rejoindre le plan.' : `${applicableCount} corrections peuvent rejoindre le plan.`
  return <div className={accepted ? 'proposal-decision is-accepted' : 'proposal-decision'}>
    <header><span><i />{accepted ? 'Correction validée' : 'Comparaison à valider'}</span><b>{changeCount} changement{changeCount > 1 ? 's' : ''}</b></header>
    <strong>{title}</strong>
    <p>{accepted ? 'Les corrections préparées sont conservées dans votre plan.' : items ? `${applicableSummary} Chaque résultat reste vérifiable ci-dessous.` : 'Validez cette correction pour la conserver, ou écartez-la sans modifier le projet.'}</p>
    {notice && <div className="proposal-notice" role="status"><Icon name="info" size={14} /> {notice}</div>}
    {items?.length ? <div className="proposal-batch-items" aria-label="Résultat de chaque constat">{items.map((item) => {
      const itemChange = item.changes[0]
      const statusLabel = item.status === 'applied' ? 'Prêt' : item.status === 'conflict' ? 'Conflit' : 'Écarté'
      return <article className={`proposal-batch-item is-${item.status}`} key={item.id} data-proposal-item={item.id}>
        <header><strong>{item.title}</strong><span>{statusLabel}</span></header>
        <p>{item.reason}</p>
        {itemChange && <div className="proposal-mini-diff" aria-label={`Diff pour ${item.title}`}><code>{itemChange.file}</code><del>{itemChange.before}</del><ins>{itemChange.after}</ins>{item.changes.length > 1 && <small>+ {item.changes.length - 1} changement{item.changes.length > 2 ? 's' : ''} lié{item.changes.length > 2 ? 's' : ''}</small>}</div>}
      </article>
    })}</div> : firstChange && <div className="proposal-mini-diff" aria-label="Diff du changement proposé"><code>{firstChange.file}</code><del>{firstChange.before}</del><ins>{firstChange.after}</ins>{changes && changes.length > 1 && <small>+ {changes.length - 1} autre{changes.length > 2 ? 's' : ''} changement{changes.length > 2 ? 's' : ''} dans la proposition</small>}</div>}
    <div className={onApply ? 'proposal-actions proposal-actions--direct' : 'proposal-actions'}><button className="button button--quiet" onClick={onReject} disabled={disabled}>{accepted ? 'Retirer du plan' : 'Écarter'}</button><button className="button button--secondary" onClick={onAccept} disabled={disabled || acceptDisabled || accepted || !changeCount || Boolean(items && !applicableCount)}><Icon name={accepted ? 'check' : 'plus'} size={15} />{accepted ? 'Correction validée' : items ? 'Valider les corrections prêtes' : 'Valider la correction'}</button>{onApply && <button className="button button--primary" onClick={onApply} disabled={disabled || acceptDisabled || !changeCount || Boolean(items && !applicableCount)}><Icon name="check" size={15} /> Appliquer le plan maintenant</button>}</div>
  </div>
}

function resolvableThemeRoles(variables: Array<{ name: string; value: string; role: string }>): Set<string> {
  const byName = new Map(variables.map((variable) => [variable.name, variable]))
  const resolves = (variable: { name: string; value: string }, visited = new Set<string>()): boolean => {
    if (/^\s*(?:#[\da-f]{3,8}|rgba?\([^)]*\))\s*$/i.test(variable.value)) return true
    const reference = variable.value.match(/var\(\s*(--[\w-]+)/)?.[1]
    if (!reference || visited.has(reference)) return false
    const next = byName.get(reference)
    if (!next) return false
    const nextVisited = new Set(visited)
    nextVisited.add(reference)
    return resolves(next, nextVisited)
  }
  return new Set(variables.filter((variable) => resolves(variable)).map((variable) => variable.role))
}

function ThemePanel({ project, runtimeTheme, acceptedTarget, previewTarget, proposal, busy, disabled, onPreview, onAccept, onReject, onRemoveAccepted }: { project: ProjectSnapshot & ProjectExtra; runtimeTheme: RuntimeTheme; acceptedTarget: ThemeTarget | null; previewTarget: ThemeTarget | null; proposal: StagingSnapshot | null; busy: boolean; disabled: boolean; onPreview: (target: ThemeTarget) => void; onAccept: () => void; onReject: () => void; onRemoveAccepted: () => void }): ReactElement {
  const hasDark = project.theme.hasDark || project.theme.detected === 'dual'
  const hasLight = project.theme.hasLight || project.theme.detected === 'dual'
  const semanticRoles = resolvableThemeRoles(project.theme.variables ?? [])
  const generationReady = project.theme.detected !== 'unknown' && semanticRoles.has('background') && semanticRoles.has('text')
  const recommendation = hasDark && !hasLight ? 'light' : hasLight && !hasDark ? 'dark' : runtimeTheme === 'dark' ? 'light' : 'dark'
  const dual = hasDark && hasLight
  const analyzedTheme: RuntimeTheme = project.theme.detected === 'dark' ? 'dark' : project.theme.detected === 'light' ? 'light' : 'unknown'
  const displayedTheme = runtimeTheme !== 'unknown' ? runtimeTheme : analyzedTheme
  const diagnosis = runtimeTheme !== 'unknown'
    ? `Rendu ${runtimeTheme === 'dark' ? 'sombre' : 'clair'} sur la page active`
    : analyzedTheme !== 'unknown'
      ? `Thème ${analyzedTheme === 'dark' ? 'sombre' : 'clair'} estimé depuis le code`
      : 'Thème non classé'
  const themeBadge = runtimeTheme !== 'unknown'
    ? runtimeTheme === 'dark' ? 'Sombre actif' : 'Clair actif'
    : analyzedTheme === 'dark' ? 'Sombre estimé' : analyzedTheme === 'light' ? 'Clair estimé' : 'À confirmer'
  return <><div className="inspector-heading"><div><span className="overline">Palette complémentaire</span><h2>Thème</h2></div><span className={`theme-chip theme-chip--${displayedTheme}`}>{themeBadge}</span></div>
    <div className="theme-diagnosis"><div className={`theme-swatch theme-swatch--${displayedTheme}`}><span>Aa</span></div><div><strong>{diagnosis}</strong><p>{dual ? 'Les variantes claire et sombre sont déclarées ; le badge décrit celle réellement visible sur cette page.' : generationReady ? `Cliquez sur la variante ${recommendation === 'light' ? 'claire' : 'sombre'} pour la voir immédiatement, avant toute validation.` : 'La génération reste suspendue tant que les rôles fond et texte ne sont pas identifiés avec assez de certitude.'}</p></div></div>
    {!generationReady && !dual && <div className="manual-review"><Icon name="shield" size={15} /><span>Palette automatique indisponible : Responsiver préfère ne rien produire plutôt qu’un thème illisible. Les variantes déjà présentes restent prévisualisables.</span></div>}
    <fieldset className="theme-options"><legend>Prévisualiser une variante</legend><label className={`${previewTarget === 'light' ? 'is-selected' : ''}${hasLight ? ' is-existing' : ''}`}><input type="radio" name="theme-preview" checked={previewTarget === 'light'} onChange={() => onPreview('light')} disabled={busy || disabled || (!hasLight && !generationReady)} /><span className="palette-preview palette-preview--light"><i /><i /><i /></span><span><strong>Clair {hasLight && <em>Déjà présent</em>}</strong><small>{hasLight ? 'Afficher la variante native, sans la dupliquer' : generationReady ? 'Fond minéral, texte graphite' : 'Rôles sémantiques insuffisants'}</small></span></label><label className={`${previewTarget === 'dark' ? 'is-selected' : ''}${hasDark ? ' is-existing' : ''}`}><input type="radio" name="theme-preview" checked={previewTarget === 'dark'} onChange={() => onPreview('dark')} disabled={busy || disabled || (!hasDark && !generationReady)} /><span className="palette-preview palette-preview--dark"><i /><i /><i /></span><span><strong>Sombre {hasDark && <em>Déjà présent</em>}</strong><small>{hasDark ? 'Afficher la variante native, sans la dupliquer' : generationReady ? 'Graphite profond, surfaces étagées' : 'Rôles sémantiques insuffisants'}</small></span></label></fieldset>
    {busy && <div className="proposal-pending" role="status"><span className="loading-mark" /> Génération locale de la palette…</div>}
    {proposal && previewTarget && <ProposalDecision title={`Variante ${previewTarget === 'dark' ? 'sombre' : 'claire'}`} accepted={acceptedTarget === previewTarget} changeCount={proposal.changes.length} notice={proposalOutcomeNotice(proposal)} disabled={disabled} onAccept={onAccept} onReject={onReject} />}
    {!proposal && previewTarget && (previewTarget === 'dark' ? hasDark : hasLight) && <div className="native-theme-preview"><Icon name="check" size={15} /><span><strong>Aperçu natif {previewTarget === 'dark' ? 'sombre' : 'clair'}</strong><small>Cette variante existe déjà : elle est simulée dans la source et ne demande aucune validation.</small></span></div>}
    {acceptedTarget && (!proposal || previewTarget !== acceptedTarget) && <div className="accepted-theme"><Icon name="check" size={15} /><span><strong>Variante {acceptedTarget === 'dark' ? 'sombre' : 'claire'} validée</strong><small>Elle sera incluse dans la prochaine version corrigée.</small></span><button className="text-button" onClick={onRemoveAccepted} disabled={disabled}>Retirer</button></div>}
    <div className="theme-note"><Icon name="info" size={15} /><p>Les rôles sémantiques et contrastes sont recalculés localement. Aucune inversion globale des couleurs.</p></div>
  </>
}

function ReviewView({ project, staging, sourceOrigin, path, device, acceptedCount, canApply, onBuild, onApply, onClear, onCopy, busy }: {
  project: ProjectSnapshot & ProjectExtra
  staging: StagingSnapshot | null
  sourceOrigin: string | null
  path: string
  device: Device
  acceptedCount: number
  canApply: boolean
  onBuild: () => void
  onApply: () => void
  onClear: () => void
  onCopy: () => void
  busy: boolean
}): ReactElement {
  return <div className="standard-page"><header className="page-head"><div><span className="overline">Validation avant écriture ou export</span><h1>Révision</h1><p>Comparez la version actuelle et la version corrigée. Les fichiers du projet restent intacts tant que vous ne choisissez pas « Appliquer au projet ».</p></div>{staging && <div className="review-actions"><button className="button button--quiet" onClick={onClear} disabled={busy}>Supprimer la version préparée</button><button className="button button--secondary" onClick={onCopy} disabled={busy}><Icon name="copy" /> Copier le patch</button>{canApply && <button className="button button--primary" onClick={onApply} disabled={busy}><Icon name="check" /> Appliquer au projet</button>}</div>}</header>
    {!staging ? <section className="review-empty"><Icon name="changes" size={28} /><h2>Aucune version corrigée à réviser</h2><p>Validez des propositions dans le laboratoire, puis préparez leur aperçu combiné.</p><button className="button button--primary" onClick={onBuild} disabled={busy || !acceptedCount}>Préparer et réviser {acceptedCount} choix validé{acceptedCount > 1 ? 's' : ''}</button></section> : <>
      {project.previewBasePath && <div className="artifact-warning"><Icon name="info" size={16} /><div><strong>Correctifs appliqués à la sortie compilée {project.previewBasePath}</strong><span>Cette livraison est exploitable telle quelle, mais un prochain build peut la remplacer. Reportez le correctif validé dans les sources pour le rendre durable.</span></div></div>}
      <section className="review-summary"><div><span>Modifications</span><strong>{staging.changes.length}</strong></div><div><span>Fichiers touchés</span><strong>{staging.changedFiles.length}</strong></div><div><span>Thème généré</span><strong>{staging.themeTarget ? staging.themeTarget === 'dark' ? 'Sombre' : 'Clair' : 'Non'}</strong></div><div><span>Sources modifiées</span><strong>0</strong></div></section>
      <section className="visual-comparison"><div><span>Version actuelle</span><PreviewFrame compact project={project} origin={sourceOrigin} device={device} path={path} /></div><div><span>Version corrigée</span><PreviewFrame compact project={project} origin={staging.previewOrigin} device={device} path={path} /></div></section>
      <section className="diff-panel"><header><div><span className="overline">Patch unifié</span><strong>{staging.changedFiles.join(' · ') || 'responsiver-theme.css'}</strong></div><button className="icon-button" onClick={onCopy} aria-label="Copier le patch"><Icon name="copy" size={15} /></button></header><pre>{staging.patch || staging.generatedCss || 'Aucun contenu textuel.'}</pre></section>
    </>}
  </div>
}

function RemoteReportView({ project, auditedRouteCount, busy, onCopy, onExport, onLab }: {
  project: ProjectSnapshot & ProjectExtra
  auditedRouteCount: number
  busy: boolean
  onCopy: () => void
  onExport: () => void
  onLab: () => void
}): ReactElement {
  const rules = new Map<string, number>()
  for (const issue of project.issues) rules.set(issue.rule, (rules.get(issue.rule) ?? 0) + 1)
  const leadingRules = [...rules.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6)
  return <div className="standard-page remote-report-page">
    <header className="page-head"><div><span className="overline">Audit URL · lecture seule</span><h1>Rapport exploitable</h1><p>Les constats des routes visitées sont réunis avec leur viewport, leur preuve DOM et une solution à vérifier. Aucun code du site distant n’est modifié.</p></div><span className="export-readiness is-ready"><i /> Rapport prêt</span></header>
    {project.analysis.truncated && <div className="artifact-warning"><Icon name="info" size={16} /><div><strong>Couverture partielle, résultats conservés</strong><span>Au moins une route a atteint un plafond de sécurité. Les constats exportés restent valides, mais le rapport ne prétend pas couvrir chaque nœud de la page.</span></div></div>}
    <section className="remote-report-ledger"><header><div><span className="overline">Périmètre observé</span><h2>{project.name}</h2></div><code>{project.source.url}</code></header><div><span><b>{auditedRouteCount}</b> route{auditedRouteCount > 1 ? 's' : ''}</span><span><b>{project.issues.length}</b> constat{project.issues.length > 1 ? 's' : ''}</span><span><b>{rules.size}</b> famille{rules.size > 1 ? 's' : ''} de règle</span><span><b>0</b> écriture distante</span></div></section>
    <div className="remote-report-grid"><section><header><span className="overline">Répartition</span><h2>Signaux principaux</h2></header>{leadingRules.length ? <ol>{leadingRules.map(([rule, count]) => <li key={rule}><code>{rule}</code><span>{count}</span></li>)}</ol> : <div className="empty-panel"><Icon name="check" /><strong>Aucun motif connu détecté</strong><span>Le rapport documente tout de même les routes et dimensions auditées.</span></div>}</section><section><header><span className="overline">Livraison</span><h2>Deux formats lisibles</h2></header><p>Copiez une synthèse Markdown pour votre ticket, ou exportez le rapport JSON complet afin de conserver les preuves et solutions route par route.</p><div><button className="button button--secondary" onClick={onCopy} disabled={busy}><Icon name="copy" /> Copier la synthèse</button><button className="button button--primary" onClick={onExport} disabled={busy}><Icon name="export" /> Exporter le JSON</button></div></section></div>
    <footer className="export-foot"><div><Icon name="shield" /><span><strong>Session éphémère</strong><small>Le rapport indique explicitement le mode réseau utilisé ; aucune donnée de session n’est conservée.</small></span></div><button className="text-button" onClick={onLab}>Revenir au laboratoire <Icon name="arrow" size={15} /></button></footer>
  </div>
}

function ExportView({ project, staging, selectedCount, busy, onCopy, onExport, onReview, reviewLabel = 'Réviser la version corrigée' }: {
  project: ProjectSnapshot & ProjectExtra
  staging: StagingSnapshot | null
  selectedCount: number
  busy: boolean
  onCopy: () => void
  onExport: (kind: 'patch' | 'changed' | 'copy' | 'report') => void
  onReview: () => void
  reviewLabel?: string
}): ReactElement {
  return <div className="standard-page"><header className="page-head"><div><span className="overline">Sortie maîtrisée</span><h1>Exporter</h1><p>Choisissez le niveau de livraison. Responsiver n’écrit jamais silencieusement dans le projet d’origine.</p></div><span className={staging ? 'export-readiness is-ready' : 'export-readiness'}><i />{staging ? 'Version corrigée prête' : 'Version corrigée requise'}</span></header>
    {project.previewBasePath && <div className="artifact-warning"><Icon name="info" size={16} /><div><strong>Livraison issue de {project.previewBasePath}</strong><span>Elle corrige l’artefact compilé actuel. Conservez le patch et reportez-le dans les sources avant de relancer votre build.</span></div></div>}
    <section className="export-ledger"><header><div><span className="overline">Contenu de livraison</span><h2>{project.name}</h2></div><button className="text-button" onClick={onReview}>{reviewLabel} <Icon name="arrow" size={15} /></button></header><div><span><b>{staging?.changes.length ?? 0}</b> modifications</span><span><b>{staging?.changedFiles.length ?? 0}</b> fichiers</span><span><b>{selectedCount}</b> règles retenues</span><span><b>{staging?.themeTarget ? '1' : '0'}</b> variante de thème</span></div></section>
    <section className="export-grid"><article><div className="export-icon"><Icon name="copy" /></div><span className="overline">Presse-papiers</span><h2>Copier le patch</h2><p>Pour relire ou appliquer le diff avec votre outil habituel.</p><button className="button button--secondary button--full" onClick={onCopy} disabled={!staging || busy}>Copier</button></article><article><div className="export-icon"><Icon name="file" /></div><span className="overline">Livraison minimale</span><h2>Fichiers modifiés</h2><p>Un dossier ne contenant que les fichiers réellement transformés.</p><button className="button button--secondary button--full" onClick={() => onExport('changed')} disabled={!staging || busy}>Choisir la destination</button></article><article><div className="export-icon"><Icon name="projects" /></div><span className="overline">Version complète</span><h2>Copie du projet</h2><p>Le projet entier avec les corrections appliquées, sans altérer l’original.</p><button className="button button--primary button--full" onClick={() => onExport('copy')} disabled={!staging || busy}>Exporter une copie</button></article></section>
    <footer className="export-foot"><div><Icon name="shield" /><span><strong>Traçabilité locale</strong><small>Le patch, la liste des règles et le rapport restent lisibles.</small></span></div><div><button className="text-button" onClick={() => onExport('report')} disabled={busy}>Exporter le rapport d’analyse</button><button className="text-button" onClick={() => onExport('patch')} disabled={!staging || busy}>Enregistrer le fichier .patch</button></div></footer>
  </div>
}
