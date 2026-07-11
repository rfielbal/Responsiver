/// <reference types="vite/client" />

import type {
  ExportResult,
  LocalAiRequest,
  LocalAiResponse,
  LocalAiStatus,
  ProjectPreparationProgress,
  ProjectIssue as SharedProjectIssue,
  ProjectSnapshot as SharedProjectSnapshot,
  RecentProjectSummary,
  RemoteAuditResult,
  RemoteFocusResult,
  RemoteOpenRequest,
  RemotePageState,
  RemoteSourceAssociationRequest,
  RemoteViewBounds,
  RemoteViewport,
  StagingApplyResult,
  StagingRequest,
  StagingSnapshot,
  StagingUndoResult,
  WorkspaceApplyResult,
  WorkspaceDiff,
  WorkspaceFileSnapshot,
  WorkspaceFileSummary,
  WorkspaceSnapshot
} from '../../shared/contracts'

declare global {
  type ProjectIssue = SharedProjectIssue
  type ProjectSnapshot = SharedProjectSnapshot

  interface ResponsiverApi {
    chooseProject: () => Promise<ProjectSnapshot | null>
    chooseProjectFile: () => Promise<ProjectSnapshot | null>
    chooseLinkedRoot: () => Promise<string | null>
    openProjectPath: (path: string) => Promise<ProjectSnapshot>
    openDemoProject: () => Promise<ProjectSnapshot>
    listRecentProjects: () => Promise<RecentProjectSummary[]>
    openRecentProject: (id: string) => Promise<ProjectSnapshot>
    reanalyzeCurrentProject: () => Promise<ProjectSnapshot>
    forgetRecentProject: (id: string) => Promise<RecentProjectSummary[]>
    onProjectPreparation: (listener: (progress: ProjectPreparationProgress) => void) => () => void
    openRemoteUrl: (request: RemoteOpenRequest) => Promise<ProjectSnapshot>
    associateRemoteRoot: (request: RemoteSourceAssociationRequest) => Promise<ProjectSnapshot>
    setRemoteBounds: (bounds: RemoteViewBounds) => Promise<void>
    navigateRemote: (action: 'back' | 'forward' | 'reload' | 'url', value?: string) => Promise<RemotePageState>
    getRemoteState: () => Promise<RemotePageState>
    auditRemote: (viewports: RemoteViewport[]) => Promise<RemoteAuditResult>
    focusRemoteFinding: (selector: string) => Promise<RemoteFocusResult>
    onRemoteState: (listener: (state: RemotePageState) => void) => () => void
    onRemoteBlockedNavigation: (listener: (payload: { url: string; detail: string }) => void) => () => void
    onExtensionOpenProject: (listener: (payload: { project: ProjectSnapshot; viewport: RemoteViewport }) => void) => () => void
    listWorkspaceFiles: (projectId: string) => Promise<WorkspaceFileSummary[]>
    readWorkspaceFile: (projectId: string, path: string) => Promise<WorkspaceFileSnapshot>
    replaceWorkspaceFile: (projectId: string, path: string, content: string, expectedVersion?: number) => Promise<WorkspaceFileSnapshot>
    discardWorkspaceFile: (projectId: string, path: string, expectedVersion?: number) => Promise<WorkspaceFileSnapshot>
    getWorkspaceSnapshot: (projectId: string) => Promise<WorkspaceSnapshot>
    getWorkspaceDiff: (projectId: string, path: string) => Promise<WorkspaceDiff>
    applyWorkspaceFile: (projectId: string, path: string, expectedVersion?: number) => Promise<WorkspaceApplyResult>
    applyAllWorkspaceFiles: (projectId: string) => Promise<WorkspaceApplyResult[]>
    onWorkspaceApplied: (listener: (paths: string[]) => void) => () => void
    onWorkspacePreviewOrigin: (listener: (origin: string | null) => void) => () => void
    probeLocalAi: (provider: LocalAiRequest['provider'], endpoint: string) => Promise<LocalAiStatus>
    sendLocalAi: (request: LocalAiRequest) => Promise<LocalAiResponse>
    previewStaging: (request: StagingRequest) => Promise<StagingSnapshot>
    clearPreviewStaging: (expectedOrigin: string) => Promise<void>
    buildStaging: (request: StagingRequest) => Promise<StagingSnapshot>
    clearStaging: () => Promise<void>
    applyStagingToSource: () => Promise<StagingApplyResult>
    undoLastStagingApply: () => Promise<StagingUndoResult>
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
