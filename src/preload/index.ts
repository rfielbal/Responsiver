import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ExportResult, LocalAiRequest, LocalAiResponse, LocalAiStatus, ProjectPreparationProgress, ProjectSnapshot, RecentProjectSummary, RemoteAuditResult, RemoteFocusResult, RemoteOpenRequest, RemotePageState, RemoteSourceAssociationRequest, RemoteViewBounds, RemoteViewport, StagingRequest, StagingSnapshot, WorkspaceApplyResult, WorkspaceDiff, WorkspaceFileSnapshot, WorkspaceFileSummary, WorkspaceSnapshot } from '../shared/contracts'

function reportRuleIds(projectOrRuleIds?: ProjectSnapshot | string[], acceptedRuleIds?: string[]): string[] {
  return Array.isArray(projectOrRuleIds) ? projectOrRuleIds : acceptedRuleIds ?? []
}

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('responsiver', {
    chooseProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose'),
    chooseProjectFile: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose-file'),
    chooseLinkedRoot: (): Promise<string | null> => ipcRenderer.invoke('project:choose-linked-root'),
    openProjectPath: (path: string): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:open-path', path),
    openDemoProject: (): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:demo'),
    listRecentProjects: (): Promise<RecentProjectSummary[]> => ipcRenderer.invoke('project:recent:list'),
    openRecentProject: (id: string): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:recent:open', id),
    forgetRecentProject: (id: string): Promise<RecentProjectSummary[]> => ipcRenderer.invoke('project:recent:forget', id),
    onProjectPreparation: (listener: (progress: ProjectPreparationProgress) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, progress: ProjectPreparationProgress): void => listener(progress)
      ipcRenderer.on('project:preparation', handler)
      return () => ipcRenderer.removeListener('project:preparation', handler)
    },
    openRemoteUrl: (request: RemoteOpenRequest): Promise<ProjectSnapshot> => ipcRenderer.invoke('remote:open', request),
    associateRemoteRoot: (request: RemoteSourceAssociationRequest): Promise<ProjectSnapshot> => ipcRenderer.invoke('remote:associate-root', request),
    setRemoteBounds: (bounds: RemoteViewBounds): Promise<void> => ipcRenderer.invoke('remote:set-bounds', bounds),
    navigateRemote: (action: 'back' | 'forward' | 'reload' | 'url', value?: string): Promise<RemotePageState> => ipcRenderer.invoke('remote:navigate', action, value),
    getRemoteState: (): Promise<RemotePageState> => ipcRenderer.invoke('remote:state'),
    auditRemote: (viewports: RemoteViewport[]): Promise<RemoteAuditResult> => ipcRenderer.invoke('remote:audit', viewports),
    focusRemoteFinding: (selector: string): Promise<RemoteFocusResult> => ipcRenderer.invoke('remote:focus', selector),
    onRemoteState: (listener: (state: RemotePageState) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, state: RemotePageState): void => listener(state)
      ipcRenderer.on('remote:state', handler)
      return () => ipcRenderer.removeListener('remote:state', handler)
    },
    onRemoteBlockedNavigation: (listener: (payload: { url: string; detail: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: { url: string; detail: string }): void => listener(payload)
      ipcRenderer.on('remote:blocked-navigation', handler)
      return () => ipcRenderer.removeListener('remote:blocked-navigation', handler)
    },
    onExtensionOpenProject: (listener: (payload: { project: ProjectSnapshot; viewport: RemoteViewport }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: { project: ProjectSnapshot; viewport: RemoteViewport }): void => listener(payload)
      ipcRenderer.on('extension:open-project', handler)
      return () => ipcRenderer.removeListener('extension:open-project', handler)
    },
    listWorkspaceFiles: (projectId: string): Promise<WorkspaceFileSummary[]> => ipcRenderer.invoke('workspace:list', projectId),
    readWorkspaceFile: (projectId: string, path: string): Promise<WorkspaceFileSnapshot> => ipcRenderer.invoke('workspace:read', projectId, path),
    replaceWorkspaceFile: (projectId: string, path: string, content: string, expectedVersion?: number): Promise<WorkspaceFileSnapshot> => ipcRenderer.invoke('workspace:replace', projectId, { path, content, expectedVersion }),
    discardWorkspaceFile: (projectId: string, path: string, expectedVersion?: number): Promise<WorkspaceFileSnapshot> => ipcRenderer.invoke('workspace:discard', projectId, path, expectedVersion),
    getWorkspaceSnapshot: (projectId: string): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('workspace:snapshot', projectId),
    getWorkspaceDiff: (projectId: string, path: string): Promise<WorkspaceDiff> => ipcRenderer.invoke('workspace:diff', projectId, path),
    applyWorkspaceFile: (projectId: string, path: string, expectedVersion?: number): Promise<WorkspaceApplyResult> => ipcRenderer.invoke('workspace:apply-file', projectId, path, expectedVersion),
    applyAllWorkspaceFiles: (projectId: string): Promise<WorkspaceApplyResult[]> => ipcRenderer.invoke('workspace:apply-all', projectId),
    onWorkspaceApplied: (listener: (paths: string[]) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, paths: string[]): void => listener(paths)
      ipcRenderer.on('workspace:applied', handler)
      return () => ipcRenderer.removeListener('workspace:applied', handler)
    },
    onWorkspacePreviewOrigin: (listener: (origin: string | null) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, origin: string | null): void => listener(origin)
      ipcRenderer.on('workspace:preview-origin', handler)
      return () => ipcRenderer.removeListener('workspace:preview-origin', handler)
    },
    probeLocalAi: (provider: LocalAiRequest['provider'], endpoint: string): Promise<LocalAiStatus> => ipcRenderer.invoke('ai:local-probe', provider, endpoint),
    sendLocalAi: (request: LocalAiRequest): Promise<LocalAiResponse> => ipcRenderer.invoke('ai:local-send', request),
    previewStaging: (request: StagingRequest): Promise<StagingSnapshot> => ipcRenderer.invoke('staging:preview', request),
    clearPreviewStaging: (expectedOrigin: string): Promise<void> => ipcRenderer.invoke('staging:clear-preview', expectedOrigin),
    buildStaging: (request: StagingRequest): Promise<StagingSnapshot> => ipcRenderer.invoke('staging:build', request),
    clearStaging: (): Promise<void> => ipcRenderer.invoke('staging:clear'),
    exportPatch: (): Promise<string | null> => ipcRenderer.invoke('staging:export-patch'),
    exportChangedFiles: (): Promise<ExportResult | null> => ipcRenderer.invoke('staging:export-changed'),
    exportProjectCopy: (): Promise<ExportResult | null> => ipcRenderer.invoke('staging:export-copy'),
    exportReport: (projectOrRuleIds?: ProjectSnapshot | string[], acceptedRuleIds?: string[]): Promise<string | null> =>
      ipcRenderer.invoke('project:export-report', reportRuleIds(projectOrRuleIds, acceptedRuleIds)),
    copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  })
}
