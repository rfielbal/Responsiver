/// <reference types="vite/client" />

import type {
  ExportResult,
  ProjectIssue as SharedProjectIssue,
  ProjectSnapshot as SharedProjectSnapshot,
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
