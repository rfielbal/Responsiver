export type Severity = 'bloquant' | 'attention' | 'information'
export type Coverage = 'standard' | 'heuristique' | 'manuel'
export type ThemeMode = 'dark' | 'light'
export type ThemeDetection = ThemeMode | 'dual' | 'unknown'
export type PreviewReadinessStatus = 'ready' | 'degraded' | 'blocked' | 'needs-build'
export type PreviewStrategy = 'static' | 'artifact' | 'source' | 'unsupported'
export type RecentProjectAvailability = 'available' | 'missing' | 'unreadable' | 'unsupported'
export type AuditSourceKind = 'local-project' | 'remote-url' | 'linked-localhost'
export type RemoteAuditMode = 'public' | 'localhost'
export type FindingConfidence = 'certain' | 'probable' | 'review'

export interface AuditSource {
  kind: AuditSourceKind
  readOnly: boolean
  url: string | null
  localRoot: string | null
  network: 'local-only' | 'public' | 'localhost'
}

export interface SourceLocation {
  file: string
  line: number
}

export interface ProjectFix {
  kind: 'html-insert' | 'css-replace' | 'css-media-override' | 'manual'
  file: string
  confidence: 'safe' | 'review'
  selector?: string
  property?: string
  before?: string
  after?: string
  breakpoint?: number
}

export interface ProjectIssue {
  id: string
  title: string
  description: string
  severity: Severity
  coverage: Coverage
  viewport: string
  routePath?: string
  source?: SourceLocation
  rule: string
  proposal: string
  fix?: ProjectFix
  confidence?: FindingConfidence
  evidence?: FindingEvidence
}

export interface FindingEvidence {
  selector: string | null
  route: string
  viewport: { width: number; height: number }
  rectangle?: { x: number; y: number; width: number; height: number } | null
  measurements?: Record<string, string | number | boolean | null>
  screenshotDataUrl?: string | null
}

export interface ProjectRoute {
  path: string
  label: string
  /** Chemin physique relatif à la racine du projet, distinct de l’URL d’un artefact monté. */
  sourcePath?: string
  title?: string
  theme?: ThemeDetection
}

export interface ThemeVariable {
  name: string
  value: string
  role: 'background' | 'surface' | 'text' | 'muted' | 'border' | 'accent' | 'unknown'
}

export interface ThemeProfile {
  detected: ThemeDetection
  hasDark: boolean
  hasLight: boolean
  evidence: string[]
  variables: ThemeVariable[]
}

export interface ProjectCapabilities {
  interactive: boolean
  staging: boolean
  framework: string | null
  packageManager: string | null
  buildRequired: boolean
  previewStrategy: PreviewStrategy
}

export interface PreviewDiagnostic {
  code: string
  severity: 'blocking' | 'warning' | 'info'
  title: string
  detail: string
  file?: string
}

export interface PreviewReadiness {
  status: PreviewReadinessStatus
  strategy: PreviewStrategy
  summary: string
  diagnostics: PreviewDiagnostic[]
}

export interface ProjectSnapshot {
  id: string
  name: string
  root: string
  kind: string
  files: number
  analyzedAt: string
  source: AuditSource
  issues: ProjectIssue[]
  previewHtml: string | null
  previewOrigin: string | null
  previewBasePath: string | null
  previewReadiness: PreviewReadiness
  entryPath: string | null
  routes: ProjectRoute[]
  theme: ThemeProfile
  capabilities: ProjectCapabilities
  analysis: {
    truncated: boolean
    scannedFiles: number
    scannedStyles: number
  }
}

export interface RemoteOpenRequest {
  url: string
  mode: RemoteAuditMode
  linkedRoot?: string | null
}

export interface RemoteSourceAssociationRequest {
  /** Identifiant anti-course de la session affichée par le renderer. */
  projectId: string
  /** Racine locale explicitement choisie par l’utilisateur. */
  root: string
}

export interface RemoteViewport {
  width: number
  height: number
  deviceScaleFactor?: number
  mobile?: boolean
  touch?: boolean
}

export interface RemoteViewBounds {
  x: number
  y: number
  width: number
  height: number
  scale: number
  visible: boolean
  viewport: RemoteViewport
}

export interface RemotePageState {
  url: string
  title: string
  path: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface RemoteAuditResult {
  url: string
  path: string
  generatedAt: string
  viewports: RemoteViewport[]
  findings: ProjectIssue[]
  screenshotDataUrl: string | null
  /** Vrai dès qu'un viewport ou la consolidation finale a atteint une limite. */
  truncated: boolean
  /** Nombre total de nœuds effectivement inspectés sur tous les viewports. */
  scannedNodes: number
  /** Budget de nœuds par viewport. */
  maxNodes: number
  /** Budget de constats bruts par viewport. */
  maxFindings: number
  /** Budget de constats consolidés renvoyés à l'interface. */
  maxTotalFindings: number
}

export interface RemoteFocusResult {
  found: boolean
  selector: string | null
  /** Route réellement affichée au moment de la recherche, query et hash inclus. */
  path: string
}

export interface WorkspaceFileSummary {
  path: string
  size: number
  modifiedAt: string
  dirty: boolean
  version: number | null
}

export interface WorkspaceFileSnapshot {
  path: string
  content: string
  sourceHash: string
  currentHash: string
  size: number
  dirty: boolean
  version: number
  diff?: WorkspaceDiff
  previewOrigin?: string | null
}

export interface WorkspaceDiff {
  path: string
  text: string
  additions: number
  deletions: number
  truncated: boolean
}

export interface WorkspaceDocumentSnapshot {
  path: string
  version: number
  dirty: boolean
  sourceHash: string
  currentHash: string
  sourceBytes: number
  currentBytes: number
  additions: number
  deletions: number
}

export interface WorkspaceSnapshot {
  root: string
  dirtyCount: number
  overlayBytes: number
  documents: WorkspaceDocumentSnapshot[]
}

export interface WorkspaceApplyResult {
  path: string
  hash: string
  bytes: number
  version: number
}

export type LocalAiStatusCode =
  | 'ready'
  | 'no-model'
  | 'engine-unreachable'
  | 'timeout'
  | 'endpoint-not-found'
  | 'access-denied'
  | 'engine-error'
  | 'invalid-response'

export interface LocalAiStatus {
  available: boolean
  provider: 'ollama' | 'llama.cpp' | null
  endpoint: string
  models: string[]
  code: LocalAiStatusCode
  detail: string
  action: string | null
}

export interface LocalAiRequest {
  provider: 'ollama' | 'llama.cpp'
  endpoint: string
  model: string
  prompt: string
  context: {
    projectName: string
    sourceKind: AuditSourceKind
    route: string
    viewport?: RemoteViewport
    findings: Array<Pick<ProjectIssue, 'id' | 'title' | 'description' | 'rule' | 'proposal' | 'source'>>
    files?: Array<{ path: string; content: string }>
    screenshotDataUrl?: string | null
  }
}

export interface LocalAiResponse {
  text: string
  model: string
  provider: 'ollama' | 'llama.cpp'
  proposedFiles: Array<{ path: string; content: string; explanation: string }>
}

export interface ProjectPreparationProgress {
  phase: 'selection' | 'inventory' | 'routes' | 'responsive' | 'preview' | 'ready' | 'blocked'
  step: number
  total: number
  label: string
  detail?: string
}

export interface RecentProjectSummary {
  id: string
  name: string
  selectionPath: string
  root: string
  entryPath: string | null
  kind: string
  files: number
  routes: number
  issues: number
  analyzedAt: string
  lastOpenedAt: string
  availability: RecentProjectAvailability
  isActive: boolean
}

export interface StagingRequest {
  issueIds: string[]
  themeTarget: ThemeMode | null
  instructions: string[]
}

export interface StagingChange {
  id: string
  title: string
  file: string
  kind: 'html' | 'css' | 'theme' | 'instruction'
  before: string
  after: string
  confidence: 'safe' | 'review'
}

export interface StagingOutcome {
  proposalId: string
  findingIds: string[]
  kind: 'issue' | 'theme' | 'instruction'
  status: 'applied' | 'skipped' | 'conflict'
  changeIds: string[]
  reason: string
}

export interface StagingSnapshot {
  previewOrigin: string | null
  changes: StagingChange[]
  patch: string
  generatedCss: string
  generatedFile?: string | null
  themeTarget: ThemeMode | null
  instructions: string[]
  recognizedInstructions?: string[]
  ignoredInstructions?: string[]
  changedFiles: string[]
  sourceHashes?: Record<string, string>
  outcomes?: StagingOutcome[]
  createdAt: string
}

export interface StagingApplyResult {
  paths: string[]
  appliedAt: string
  undoAvailable: boolean
}

export interface StagingUndoResult {
  paths: string[]
  undoneAt: string
}

export interface RuntimeOverflow {
  selector: string
  tag: string
  label: string
  left: number
  right: number
  width: number
}

export type RuntimeAuditRule =
  | 'layout.viewport-overflow'
  | 'layout.clipped-content'
  | 'layout.truncated-text'
  | 'layout.navigation-wrap'
  | 'layout.element-overlap'
  | 'layout.density-hierarchy'
  | 'layout.useful-area-overflow'
  | 'typography.disproportionate'
  | 'interaction.small-target'
  | 'layout.fixed-obstruction'
  | 'media.image-error'
  | 'media.image-distortion'
  | 'accessibility.low-contrast'

export interface RuntimeAuditRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RuntimeAuditViewport {
  width: number
  height: number
  mobile: boolean
}

export interface RuntimeAuditFinding {
  id: string
  rule: RuntimeAuditRule
  severity: 'warning' | 'error'
  title: string
  description: string
  proposal: string
  confidence: number
  selector: string
  tag: string
  label: string
  rect: RuntimeAuditRect
  route: string
  viewport: RuntimeAuditViewport
}

export interface RuntimeAuditLimits {
  maxNodes: number
  maxFindings: number
  maxFindingsPerRule: number
  maxLegacyOverflows: number
  maxContrastChecks: number
}

export interface RuntimeAudit {
  version: 2
  path: string
  route: string
  viewportWidth: number
  viewportHeight: number
  viewport: RuntimeAuditViewport
  documentWidth: number
  overflowCount: number
  overflows: RuntimeOverflow[]
  findingCount: number
  findings: RuntimeAuditFinding[]
  inspectedNodes: number
  truncated: boolean
  limits: RuntimeAuditLimits
}

export interface ExportResult {
  path: string
  files: number
}
