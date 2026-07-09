import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { analyzeProject, createDemoProject, type ProjectSnapshot } from './project-analyzer'

let mainWindow: BrowserWindow | undefined

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html')
  const packagedRendererUrl = pathToFileURL(rendererFile).toString()
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    title: 'Responsiver',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const expectedUrl = process.env.ELECTRON_RENDERER_URL
    const isAllowed = expectedUrl ? url.startsWith(expectedUrl) : url === packagedRendererUrl
    if (!isAllowed) event.preventDefault()
  })
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(rendererFile)
  }
}

function isExportPayload(value: unknown): value is { project: ProjectSnapshot; acceptedRuleIds: string[] } {
  if (!value || typeof value !== 'object') return false
  const payload = value as { project?: unknown; acceptedRuleIds?: unknown }
  return Boolean(payload.project) && Array.isArray(payload.acceptedRuleIds)
}

app.whenReady().then(() => {
  app.setName('Responsiver')

  ipcMain.handle('project:choose', async (): Promise<ProjectSnapshot | null> => {
    const selection = await dialog.showOpenDialog({
      title: 'Choisir un projet web local',
      properties: ['openDirectory']
    })

    if (selection.canceled || selection.filePaths.length === 0) return null
    return analyzeProject(selection.filePaths[0])
  })

  ipcMain.handle('project:demo', (): ProjectSnapshot => createDemoProject())

  ipcMain.handle('project:export-report', async (_event, payload: unknown): Promise<string | null> => {
    if (!isExportPayload(payload)) throw new Error('Le rapport demandé est invalide.')

    const target = await dialog.showSaveDialog({
      title: 'Exporter le rapport Responsiver',
      defaultPath: `${payload.project.name.toLowerCase().replace(/\s+/g, '-')}-responsiver.json`,
      filters: [{ name: 'Rapport JSON', extensions: ['json'] }]
    })
    if (target.canceled || !target.filePath) return null

    const report = {
      generatedAt: new Date().toISOString(),
      application: 'Responsiver 0.1.0',
      localOnly: true,
      project: payload.project,
      acceptedRuleIds: payload.acceptedRuleIds
    }
    await writeFile(target.filePath, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 })
    return target.filePath
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
