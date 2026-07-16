/// <reference types="vite/client" />

import type {
  ExportResult,
  InterfaceCaptureRegion,
  LocalAiRequest,
  LocalAiResponse,
  LocalAiStatus,
  MatrixRunProgress,
  MatrixRunRequest,
  MatrixRunResult,
  ProjectPreparationProgress,
  ProjectIssue as SharedProjectIssue,
  ProjectSnapshot as SharedProjectSnapshot,
  RecentProjectSummary,
  RemoteAuditResult,
  RemoteFocusResult,
  RemoteInspectorRequest,
  RemoteInspectorSelection,
  RemoteInspectorState,
  RemoteOpenRequest,
  RemotePageState,
  RemoteScrollApplyRequest,
  RemoteScrollSnapshot,
  RemoteSourceAssociationRequest,
  RemoteViewBounds,
  RemoteViewReleaseRequest,
  RemoteViewport,
  RemoteVisualStyleRequest,
  RemoteVisualStyleResult,
  RemoteZoomGesture,
  StagingApplyResult,
  StagingRequest,
  StagingSnapshot,
  StagingUndoResult,
  StagingVerificationRequest,
  StagingVerificationResult,
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
    releaseRemoteView: (request: RemoteViewReleaseRequest) => Promise<void>
    navigateRemote: (action: 'back' | 'forward' | 'reload' | 'url', value?: string, request?: RemoteInspectorRequest) => Promise<RemotePageState>
    getRemoteState: (request?: RemoteInspectorRequest) => Promise<RemotePageState>
    readRemoteScroll: (request: RemoteInspectorRequest) => Promise<RemoteScrollSnapshot>
    applyRemoteScroll: (request: RemoteScrollApplyRequest) => Promise<RemoteScrollSnapshot>
    auditRemote: (viewports: RemoteViewport[], request?: RemoteInspectorRequest) => Promise<RemoteAuditResult>
    focusRemoteFinding: (selector: string, request?: RemoteInspectorRequest) => Promise<RemoteFocusResult>
    startRemoteInspector: (request: RemoteInspectorRequest) => Promise<RemoteInspectorState>
    stopRemoteInspector: (request: RemoteInspectorRequest) => Promise<RemoteInspectorState>
    previewRemoteVisualStyle: (request: RemoteVisualStyleRequest) => Promise<RemoteVisualStyleResult>
    clearRemoteVisualStyle: (request: RemoteInspectorRequest) => Promise<RemoteVisualStyleResult>
    onRemoteInspectorSelection: (listener: (selection: RemoteInspectorSelection) => void) => () => void
    onRemoteInspectorShortcut: (listener: (projectId: string, viewId?: string) => void) => () => void
    onRemoteInspectorCanceled: (listener: (projectId: string, viewId?: string) => void) => () => void
    onRemoteInspectorReady: (listener: (projectId: string, viewId?: string) => void) => () => void
    onRemoteEscape: (listener: (projectId: string, viewId?: string) => void) => () => void
    onRemoteZoomGesture: (listener: (gesture: RemoteZoomGesture) => void) => () => void
    onRemoteState: (listener: (state: RemotePageState) => void) => () => void
    onRemoteBlockedNavigation: (listener: (payload: { url: string; detail: string; viewId?: string }) => void) => () => void
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
    runMatrix: (request: MatrixRunRequest) => Promise<MatrixRunResult>
    onMatrixProgress: (listener: (progress: MatrixRunProgress) => void) => () => void
    verifyStaging: (request: StagingVerificationRequest) => Promise<StagingVerificationResult>
    applyVerifiedStaging: (token: string) => Promise<StagingApplyResult>
    undoLastStagingApply: () => Promise<StagingUndoResult>
    exportPatch: () => Promise<string | null>
    exportChangedFiles: () => Promise<ExportResult | null>
    exportProjectCopy: () => Promise<ExportResult | null>
    exportReport: (projectOrRuleIds?: ProjectSnapshot | string[], acceptedRuleIds?: string[]) => Promise<string | null>
    captureInterfaceRegion: (region: InterfaceCaptureRegion, suggestedName?: string) => Promise<string | null>
    copyText: (text: string) => Promise<void>
    getPathForFile: (file: File) => string
  }

  interface Window {
    responsiver: ResponsiverApi
  }
}

export {}
