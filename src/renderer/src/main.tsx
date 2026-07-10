import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { browserDemoProject } from './browser-demo'
import './styles.css'

if (!window.responsiver) {
  window.responsiver = {
    chooseProject: async () => null,
    chooseProjectFile: async () => null,
    openProjectPath: async () => { throw new Error('L’ouverture par chemin est disponible uniquement dans Electron.') },
    openDemoProject: async () => browserDemoProject,
    previewStaging: async () => { throw new Error('La prévisualisation des corrections est disponible uniquement dans Electron.') },
    clearPreviewStaging: async (_expectedOrigin: string) => undefined,
    buildStaging: async () => { throw new Error('Le staging est disponible uniquement dans Electron.') },
    clearStaging: async () => undefined,
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
