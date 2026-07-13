import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { browserDemoProject } from './browser-demo'
import './styles.css'

if (!window.responsiver) {
  window.responsiver = {
    chooseProject: async () => null,
    chooseProjectFile: async () => null,
    chooseLinkedRoot: async () => null,
    openProjectPath: async () => { throw new Error('L’ouverture par chemin est disponible uniquement dans Electron.') },
    openDemoProject: async () => browserDemoProject,
    listRecentProjects: async () => [],
    openRecentProject: async () => { throw new Error('L’historique local est disponible uniquement dans Electron.') },
    reanalyzeCurrentProject: async () => { throw new Error('La réanalyse locale est disponible uniquement dans Electron.') },
    forgetRecentProject: async () => [],
    onProjectPreparation: () => () => undefined,
    openRemoteUrl: async () => { throw new Error('Le mode URL est disponible uniquement dans Electron.') },
    associateRemoteRoot: async () => { throw new Error('L’association de sources localhost est disponible uniquement dans Electron.') },
    setRemoteBounds: async () => undefined,
    navigateRemote: async () => { throw new Error('La navigation distante est disponible uniquement dans Electron.') },
    getRemoteState: async () => { throw new Error('La navigation distante est disponible uniquement dans Electron.') },
    auditRemote: async () => { throw new Error('L’audit URL est disponible uniquement dans Electron.') },
    focusRemoteFinding: async () => ({ found: false, selector: null, path: '/' }),
    startRemoteInspector: async () => { throw new Error('L’inspecteur distant est disponible uniquement dans Electron.') },
    stopRemoteInspector: async () => ({ active: false, editable: false, path: '/' }),
    previewRemoteVisualStyle: async () => { throw new Error('La prévisualisation CSS distante est disponible uniquement dans Electron.') },
    clearRemoteVisualStyle: async () => ({ applied: false, bytes: 0, path: '/' }),
    onRemoteInspectorSelection: () => () => undefined,
    onRemoteInspectorShortcut: () => () => undefined,
    onRemoteInspectorCanceled: () => () => undefined,
    onRemoteInspectorReady: () => () => undefined,
    onRemoteZoomGesture: () => () => undefined,
    onRemoteState: () => () => undefined,
    onRemoteBlockedNavigation: () => () => undefined,
    onExtensionOpenProject: () => () => undefined,
    listWorkspaceFiles: async () => [],
    readWorkspaceFile: async () => { throw new Error('L’éditeur local est disponible uniquement dans Electron.') },
    replaceWorkspaceFile: async () => { throw new Error('L’éditeur local est disponible uniquement dans Electron.') },
    discardWorkspaceFile: async () => { throw new Error('L’éditeur local est disponible uniquement dans Electron.') },
    getWorkspaceSnapshot: async () => ({ root: '', dirtyCount: 0, overlayBytes: 0, documents: [] }),
    getWorkspaceDiff: async () => ({ path: '', text: '', additions: 0, deletions: 0, truncated: false }),
    applyWorkspaceFile: async () => { throw new Error('L’éditeur local est disponible uniquement dans Electron.') },
    applyAllWorkspaceFiles: async () => [],
    onWorkspaceApplied: () => () => undefined,
    onWorkspacePreviewOrigin: () => () => undefined,
    probeLocalAi: async (_provider, endpoint) => ({ available: false, provider: null, endpoint, models: [], code: 'engine-unreachable', detail: 'Le moteur local nécessite l’application Electron.', action: 'Lancez Responsiver dans son application desktop.' }),
    sendLocalAi: async () => { throw new Error('L’IA locale est disponible uniquement dans Electron.') },
    previewStaging: async () => { throw new Error('La prévisualisation des corrections est disponible uniquement dans Electron.') },
    clearPreviewStaging: async (_expectedOrigin: string) => undefined,
    buildStaging: async () => { throw new Error('Le staging est disponible uniquement dans Electron.') },
    clearStaging: async () => undefined,
    applyStagingToSource: async () => { throw new Error('L’application aux sources est disponible uniquement dans Electron.') },
    undoLastStagingApply: async () => { throw new Error('L’annulation sur les sources est disponible uniquement dans Electron.') },
    exportPatch: async () => null,
    exportChangedFiles: async () => null,
    exportProjectCopy: async () => null,
    exportReport: async () => 'Rapport de démonstration disponible uniquement dans Electron.',
    copyText: async (text) => navigator.clipboard.writeText(text),
    getPathForFile: () => ''
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
