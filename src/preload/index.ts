import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ExportResult, ProjectPreparationProgress, ProjectSnapshot, RecentProjectSummary, StagingRequest, StagingSnapshot } from '../shared/contracts'

function reportRuleIds(projectOrRuleIds?: ProjectSnapshot | string[], acceptedRuleIds?: string[]): string[] {
  return Array.isArray(projectOrRuleIds) ? projectOrRuleIds : acceptedRuleIds ?? []
}

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('responsiver', {
    chooseProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose'),
    chooseProjectFile: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose-file'),
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
