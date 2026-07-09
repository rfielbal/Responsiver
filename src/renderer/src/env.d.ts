/// <reference types="vite/client" />

interface ProjectIssue {
  id: string
  title: string
  description: string
  severity: 'bloquant' | 'attention' | 'information'
  coverage: 'standard' | 'heuristique' | 'manuel'
  viewport: string
  source?: { file: string; line: number }
  rule: string
  proposal: string
}

interface ProjectSnapshot {
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
  routes: Array<{ path: string; label: string }>
  theme: { detected: 'dark' | 'light' | 'dual' | 'unknown'; hasDark: boolean; hasLight: boolean }
}

interface Window {
  responsiver: {
    chooseProject: () => Promise<ProjectSnapshot | null>
    openProjectPath: (path: string) => Promise<ProjectSnapshot>
    openDemoProject: () => Promise<ProjectSnapshot>
    exportReport: (project: ProjectSnapshot, acceptedRuleIds: string[]) => Promise<string | null>
  }
}
