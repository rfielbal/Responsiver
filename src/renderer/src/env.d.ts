/// <reference types="vite/client" />

import type {
  ExportResult,
  ProjectPreparationProgress,
  ProjectIssue as SharedProjectIssue,
  ProjectSnapshot as SharedProjectSnapshot,
  RecentProjectSummary,
  StagingRequest,
  StagingSnapshot
} from '../../shared/contracts'

declare global {
  type ProjectIssue = SharedProjectIssue
  type ProjectSnapshot = SharedProjectSnapshot

  interface ResponsiverApi {
    chooseProject: () => Promise<ProjectSnapshot | null>
    chooseProjectFile: () => Promise<ProjectSnapshot | null>
    openProjectPath: (path: string) => Promise<ProjectSnapshot>
    openDemoProject: () => Promise<ProjectSnapshot>
    listRecentProjects: () => Promise<RecentProjectSummary[]>
    openRecentProject: (id: string) => Promise<ProjectSnapshot>
    forgetRecentProject: (id: string) => Promise<RecentProjectSummary[]>
    onProjectPreparation: (listener: (progress: ProjectPreparationProgress) => void) => () => void
    previewStaging: (request: StagingRequest) => Promise<StagingSnapshot>
    clearPreviewStaging: (expectedOrigin: string) => Promise<void>
    buildStaging: (request: StagingRequest) => Promise<StagingSnapshot>
    clearStaging: () => Promise<void>
    exportPatch: () => Promise<string | null>
    exportChangedFiles: () => Promise<ExportResult | null>
    exportProjectCopy: () => Promise<ExportResult | null>
    exportReport: (projectOrRuleIds?: ProjectSnapshot | string[], acceptedRuleIds?: string[]) => Promise<string | null>
    copyText: (text: string) => Promise<void>
    getPathForFile: (file: File) => string
  }

  interface Window {
    responsiver: ResponsiverApi
  }
}

export {}
