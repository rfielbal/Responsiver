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
}

interface Window {
  responsiver: {
    chooseProject: () => Promise<ProjectSnapshot | null>
    openDemoProject: () => Promise<ProjectSnapshot>
    exportReport: (project: ProjectSnapshot, acceptedRuleIds: string[]) => Promise<string | null>
  }
}
