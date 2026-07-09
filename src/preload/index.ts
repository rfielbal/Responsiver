import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectSnapshot } from '../main/project-analyzer'

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('responsiver', {
    chooseProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose'),
    openProjectPath: (path: string): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:open-path', path),
    openDemoProject: (): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:demo'),
    exportReport: (project: ProjectSnapshot, acceptedRuleIds: string[]): Promise<string | null> =>
      ipcRenderer.invoke('project:export-report', { project, acceptedRuleIds })
  })
}
