import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportResult, ProjectSnapshot, StagingRequest, StagingSnapshot } from '../shared/contracts'

function reportRuleIds(projectOrRuleIds?: ProjectSnapshot | string[], acceptedRuleIds?: string[]): string[] {
  return Array.isArray(projectOrRuleIds) ? projectOrRuleIds : acceptedRuleIds ?? []
}

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('responsiver', {
    chooseProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose'),
    chooseProjectFile: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose-file'),
    openProjectPath: (path: string): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:open-path', path),
    openDemoProject: (): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:demo'),
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
