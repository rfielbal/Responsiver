import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { browserDemoProject } from './browser-demo'
import './styles.css'

if (!window.responsiver) {
  window.responsiver = {
    chooseProject: async () => null,
    openDemoProject: async () => browserDemoProject,
    exportReport: async () => 'Rapport de démonstration disponible uniquement dans Electron.'
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
