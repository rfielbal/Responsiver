import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectSnapshot } from '../main/project-analyzer'

contextBridge.exposeInMainWorld('responsiver', {
  chooseProject: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke('project:choose'),
  openDemoProject: (): Promise<ProjectSnapshot> => ipcRenderer.invoke('project:demo'),
  exportReport: (project: ProjectSnapshot, acceptedRuleIds: string[]): Promise<string | null> =>
    ipcRenderer.invoke('project:export-report', { project, acceptedRuleIds })
})
