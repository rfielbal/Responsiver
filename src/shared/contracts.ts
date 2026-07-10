export type Severity = 'bloquant' | 'attention' | 'information'
export type Coverage = 'standard' | 'heuristique' | 'manuel'
export type ThemeMode = 'dark' | 'light'
export type ThemeDetection = ThemeMode | 'dual' | 'unknown'

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
}

export interface ProjectRoute {
  path: string
  label: string
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
}

export interface ProjectSnapshot {
  id: string
  name: string
  root: string
  kind: string
  files: number
  analyzedAt: string
  issues: ProjectIssue[]
  previewHtml: string | null
  previewOrigin: string | null
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
  createdAt: string
}

export interface RuntimeOverflow {
  selector: string
  tag: string
  label: string
  left: number
  right: number
  width: number
}

export interface RuntimeAudit {
  path: string
  viewportWidth: number
  viewportHeight: number
  documentWidth: number
  overflowCount: number
  overflows: RuntimeOverflow[]
}

export interface ExportResult {
  path: string
  files: number
}
