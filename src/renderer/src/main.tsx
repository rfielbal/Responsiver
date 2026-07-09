import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { browserDemoProject } from './browser-demo'
import './styles.css'

if (!window.responsiver) {
  window.responsiver = {
    chooseProject: async () => null,
    openProjectPath: async () => { throw new Error('L’ouverture par chemin est disponible uniquement dans Electron.') },
    openDemoProject: async () => browserDemoProject,
    exportReport: async () => 'Rapport de démonstration disponible uniquement dans Electron.'
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
