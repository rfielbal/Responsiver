import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { realpath, stat, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { analyzeProject, createDemoProject, type ProjectSnapshot } from './project-analyzer'
import { startProjectServer, type ProjectServer } from './project-server'

let mainWindow: BrowserWindow | undefined
let activePreviewServer: ProjectServer | undefined
const knownPreviewOrigins = new Set<string>()

async function closeActivePreviewServer(): Promise<void> {
  if (!activePreviewServer) return
  await activePreviewServer.close()
  activePreviewServer = undefined
}

async function openLocalProject(root: string): Promise<ProjectSnapshot> {
  await closeActivePreviewServer()
  const project = await analyzeProject(root)
  if (!project.entryPath) return project
  activePreviewServer = await startProjectServer(root)
  knownPreviewOrigins.add(activePreviewServer.origin)
  return { ...project, previewOrigin: activePreviewServer.origin }
}

async function normalizeProjectRoot(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) {
    throw new Error('Le chemin du projet est invalide.')
  }

  const root = await realpath(value.trim()).catch(() => null)
  if (!root || !(await stat(root).catch(() => null))?.isDirectory()) {
    throw new Error('Choisissez un dossier local existant.')
  }
  return root
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function isAllowedGoogleFont(request: URL, resourceType: string): boolean {
  return request.protocol === 'https:' && (
    (request.hostname === 'fonts.googleapis.com' && resourceType === 'stylesheet') ||
    (request.hostname === 'fonts.gstatic.com' && resourceType === 'font')
  )
}

function requireTrustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Cette action doit venir de la fenêtre principale de Responsiver.')
  }
  return mainWindow
}

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html')
  const packagedRendererUrl = pathToFileURL(rendererFile).toString()
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    title: 'Responsiver',
    backgroundColor: '#f2f0ea',
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
    const isAllowed = expectedUrl ? originOf(url) === originOf(expectedUrl) : url === packagedRendererUrl
    if (!isAllowed) event.preventDefault()
  })
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    const initiatorOrigin = details.initiator?.origin ?? details.frame?.origin
    const destinationOrigin = originOf(details.url)
    if (initiatorOrigin && knownPreviewOrigins.has(initiatorOrigin) && destinationOrigin !== initiatorOrigin) details.preventDefault()
  })

  const session = mainWindow.webContents.session
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.webRequest.onBeforeRequest((details, callback) => {
    try {
      const request = new URL(details.url)
      const initiatingOrigin = details.frame?.origin ?? originOf(details.referrer)
      if (!initiatingOrigin || !knownPreviewOrigins.has(initiatingOrigin)) {
        callback({})
        return
      }

      const isInlineResource = request.protocol === 'about:' || request.protocol === 'blob:' || request.protocol === 'data:'
      const isSamePreviewOrigin = request.origin === initiatingOrigin
      callback({ cancel: !(isInlineResource || isSamePreviewOrigin || isAllowedGoogleFont(request, details.resourceType)) })
    } catch {
      callback({ cancel: true })
    }
  })

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

  ipcMain.handle('project:choose', async (event): Promise<ProjectSnapshot | null> => {
    const owner = requireTrustedWindow(event)
    const options = {
      title: 'Choisir un projet web local',
      message: 'Choisissez le dossier racine du projet à prévisualiser.',
      buttonLabel: 'Ouvrir ce dossier',
      properties: ['openDirectory'] as Array<'openDirectory'>
    }
    const selection = await dialog.showOpenDialog(owner, options)

    if (selection.canceled || selection.filePaths.length === 0) return null
    return openLocalProject(await normalizeProjectRoot(selection.filePaths[0]))
  })

  ipcMain.handle('project:open-path', async (event, path: unknown): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return openLocalProject(await normalizeProjectRoot(path))
  })

  ipcMain.handle('project:demo', (event): ProjectSnapshot => {
    requireTrustedWindow(event)
    return createDemoProject()
  })

  ipcMain.handle('project:export-report', async (event, payload: unknown): Promise<string | null> => {
    const owner = requireTrustedWindow(event)
    if (!isExportPayload(payload)) throw new Error('Le rapport demandé est invalide.')

    const target = await dialog.showSaveDialog(owner, {
      title: 'Exporter le rapport Responsiver',
      defaultPath: `${payload.project.name.toLowerCase().replace(/\s+/g, '-')}-responsiver.json`,
      filters: [{ name: 'Rapport JSON', extensions: ['json'] }]
    })
    if (target.canceled || !target.filePath) return null

    const report = {
      generatedAt: new Date().toISOString(),
      application: 'Responsiver 0.2.0',
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

app.on('before-quit', () => {
  void closeActivePreviewServer()
})
