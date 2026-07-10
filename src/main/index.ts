import { app, BrowserWindow, clipboard, dialog, ipcMain, session as electronSession, type IpcMainInvokeEvent } from 'electron'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, cp, lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExportResult, ProjectSnapshot, StagingRequest, StagingSnapshot } from '../shared/contracts'
import { analyzeProject, createDemoProject } from './project-analyzer'
import { startProjectServer, type ProjectServer } from './project-server'
import { buildProjectStaging, type ProjectStaging } from './project-transformer'

interface ActiveProjectSession {
  root: string
  project: ProjectSnapshot
  sourceServer: ProjectServer | null
  proposalServer: ProjectServer | null
  stagedServer: ProjectServer | null
  staging: ProjectStaging | null
}

interface NormalizedProjectSelection {
  root: string
  preferredEntryPath: string | null
}

let mainWindow: BrowserWindow | undefined
let activeSession: ActiveProjectSession | null = null
let sessionQueue: Promise<void> = Promise.resolve()
const knownPreviewOrigins = new Set<string>()
const maxClipboardLength = 10 * 1024 * 1024
const ignoredCopyDirectories = new Set(['.git', 'node_modules'])

function queueSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionQueue.then(operation, operation)
  sessionQueue = result.then(() => undefined, () => undefined)
  return result
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function isLoopbackPreviewOrigin(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const origin = new URL(value)
    return origin.protocol === 'http:' && origin.hostname === '127.0.0.1'
  } catch {
    return false
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

async function clearPreviewStorage(origin: string): Promise<void> {
  if (!app.isReady()) return
  await electronSession.defaultSession.clearStorageData({
    origin,
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
  }).catch(() => undefined)
}

async function closePreviewServer(server: ProjectServer | null): Promise<void> {
  if (!server) return
  knownPreviewOrigins.delete(server.origin)
  await server.close().catch(() => undefined)
  await clearPreviewStorage(server.origin)
}

async function disposeSession(session: ActiveProjectSession | null): Promise<void> {
  if (!session) return
  await Promise.all([
    closePreviewServer(session.sourceServer),
    closePreviewServer(session.proposalServer),
    closePreviewServer(session.stagedServer)
  ])
}

async function replaceActiveSession(next: ActiveProjectSession): Promise<void> {
  const previous = activeSession
  activeSession = next
  await disposeSession(previous)
}

function relativeWebPath(root: string, file: string): string {
  return `/${relative(root, file).split(sep).join('/')}`
}

async function normalizeProjectSelection(value: unknown): Promise<NormalizedProjectSelection> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096 || value.includes('\0')) {
    throw new Error('Le chemin du projet est invalide.')
  }
  const selected = await realpath(value.trim()).catch(() => null)
  const selectedStat = selected ? await stat(selected).catch(() => null) : null
  if (!selected || !selectedStat) throw new Error('Choisissez un fichier ou un dossier local existant.')
  if (selectedStat.isDirectory()) return { root: selected, preferredEntryPath: null }
  if (!selectedStat.isFile() || !['.html', '.htm'].includes(extname(selected).toLowerCase())) {
    throw new Error('Responsiver accepte un dossier de projet ou un fichier HTML comme point d’entrée.')
  }
  const root = await realpath(dirname(selected))
  return { root, preferredEntryPath: relativeWebPath(root, selected) }
}

async function createLocalSession(selection: NormalizedProjectSelection): Promise<ActiveProjectSession> {
  const analyzed = await analyzeProject(selection.root)
  const project: ProjectSnapshot = selection.preferredEntryPath
    ? { ...analyzed, entryPath: selection.preferredEntryPath }
    : analyzed
  const sourceServer = project.entryPath
    ? await startProjectServer(selection.root, { mode: 'source' })
    : null
  if (sourceServer) knownPreviewOrigins.add(sourceServer.origin)
  return {
    root: selection.root,
    project: { ...project, previewOrigin: sourceServer?.origin ?? null },
    sourceServer,
    proposalServer: null,
    stagedServer: null,
    staging: null
  }
}

async function openLocalProject(selection: NormalizedProjectSelection): Promise<ProjectSnapshot> {
  const next = await createLocalSession(selection)
  if (!mainWindow) {
    await disposeSession(next)
    throw new Error('La fenêtre Responsiver a été fermée pendant l’ouverture du projet.')
  }
  await replaceActiveSession(next)
  return next.project
}

async function resolveDemoRoot(): Promise<string | null> {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'demo', 'atelier')]
    : [join(app.getAppPath(), 'demo', 'atelier'), join(process.cwd(), 'demo', 'atelier')]
  for (const candidate of candidates) {
    const root = await realpath(candidate).catch(() => null)
    if (root && (await stat(root).catch(() => null))?.isDirectory()) return root
  }
  return null
}

async function openDemoProject(): Promise<ProjectSnapshot> {
  const demoRoot = await resolveDemoRoot()
  if (demoRoot) return openLocalProject({ root: demoRoot, preferredEntryPath: '/index.html' })
  if (!mainWindow) throw new Error('La fenêtre Responsiver a été fermée pendant l’ouverture de la démonstration.')
  const project = createDemoProject()
  await replaceActiveSession({ root: '', project, sourceServer: null, proposalServer: null, stagedServer: null, staging: null })
  return project
}

function validStagingRequest(value: unknown): value is StagingRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<StagingRequest>
  return Array.isArray(request.issueIds) && request.issueIds.length <= 500 && request.issueIds.every((id) => typeof id === 'string' && id.length <= 256) &&
    (request.themeTarget === null || request.themeTarget === 'dark' || request.themeTarget === 'light') &&
    Array.isArray(request.instructions) && request.instructions.length <= 100 && request.instructions.every((instruction) => typeof instruction === 'string' && instruction.length <= 2_000)
}

function currentSession(): ActiveProjectSession {
  if (!activeSession || !activeSession.root) throw new Error('Ouvrez d’abord un projet local dans Responsiver.')
  return activeSession
}

async function buildStaging(value: unknown): Promise<StagingSnapshot> {
  if (!validStagingRequest(value)) throw new Error('La demande de staging est invalide.')
  const session = currentSession()
  const staging = await buildProjectStaging(session.root, session.project, value)
  if (activeSession !== session || !mainWindow) throw new Error('La session projet a changé pendant la construction du staging.')
  const stagedServer = session.project.entryPath
    ? await startProjectServer(session.root, { mode: 'staged', overrides: staging.overrides })
    : null
  if (activeSession !== session || !mainWindow) {
    await closePreviewServer(stagedServer)
    throw new Error('La session projet a changé pendant le démarrage du staging.')
  }
  if (stagedServer) knownPreviewOrigins.add(stagedServer.origin)
  const previousServer = session.stagedServer
  const proposalServer = session.proposalServer
  session.staging = staging
  session.stagedServer = stagedServer
  session.proposalServer = null
  await Promise.all([
    closePreviewServer(previousServer),
    closePreviewServer(proposalServer)
  ])
  return { ...staging.snapshot, previewOrigin: stagedServer?.origin ?? null }
}

async function previewStaging(value: unknown): Promise<StagingSnapshot> {
  if (!validStagingRequest(value)) throw new Error('La demande de prévisualisation est invalide.')
  const session = currentSession()
  const proposal = await buildProjectStaging(session.root, session.project, value)
  if (activeSession !== session || !mainWindow) throw new Error('La session projet a changé pendant la préparation de la prévisualisation.')
  const proposalServer = session.project.entryPath
    ? await startProjectServer(session.root, { mode: 'proposal', overrides: proposal.overrides })
    : null
  if (activeSession !== session || !mainWindow) {
    await closePreviewServer(proposalServer)
    throw new Error('La session projet a changé pendant le démarrage de la prévisualisation.')
  }
  if (proposalServer) knownPreviewOrigins.add(proposalServer.origin)
  const previousServer = session.proposalServer
  session.proposalServer = proposalServer
  await closePreviewServer(previousServer)
  return { ...proposal.snapshot, previewOrigin: proposalServer?.origin ?? null }
}

async function clearPreviewStaging(expectedOrigin: unknown): Promise<void> {
  if (!activeSession) return
  const server = activeSession.proposalServer
  if (!server) return
  if (typeof expectedOrigin !== 'string' || server.origin !== expectedOrigin) return
  activeSession.proposalServer = null
  await closePreviewServer(server)
}

async function clearStaging(): Promise<void> {
  if (!activeSession) return
  const server = activeSession.stagedServer
  activeSession.staging = null
  activeSession.stagedServer = null
  await closePreviewServer(server)
}

function safeOverrideDestination(root: string, relativePath: string): string | null {
  const normalizedRelative = normalize(relativePath.replaceAll('\\', sep))
  if (!normalizedRelative || normalizedRelative === '..' || normalizedRelative.startsWith(`..${sep}`)) return null
  const target = resolve(root, normalizedRelative)
  const normalizedRoot = normalize(root.endsWith(sep) ? root : `${root}${sep}`)
  return target.startsWith(normalizedRoot) ? target : null
}

async function assertNoSymlinkInPath(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root)
  let cursor = resolve(target)
  while (cursor !== resolvedRoot) {
    if (cursor === dirname(cursor) || !cursor.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error('Chemin d’export hors du dossier autorisé.')
    }
    const entry = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (entry?.isSymbolicLink()) throw new Error('Un lien symbolique empêche cet export sécurisé.')
    cursor = dirname(cursor)
  }
}

async function materializeOverrides(sourceRoot: string, destination: string, overrides: ReadonlyMap<string, Buffer>): Promise<number> {
  let written = 0
  for (const [relativePath, body] of overrides) {
    const target = safeOverrideDestination(destination, relativePath)
    if (!target) throw new Error(`Chemin de correction invalide : ${relativePath}`)
    await assertNoSymlinkInPath(destination, target)
    await mkdir(dirname(target), { recursive: true })
    const source = safeOverrideDestination(sourceRoot, relativePath)
    if (source) await assertNoSymlinkInPath(sourceRoot, source)
    const sourceMode = source ? (await stat(source).catch(() => null))?.mode : undefined
    await writeFile(target, body, { mode: sourceMode === undefined ? 0o644 : sourceMode & 0o777 })
    written += 1
  }
  return written
}

async function assertStagingSourcesUnchanged(session: ActiveProjectSession): Promise<void> {
  const hashes = session.staging?.snapshot.sourceHashes
  if (!hashes) return
  for (const [relativePath, expected] of Object.entries(hashes)) {
    const source = safeOverrideDestination(session.root, relativePath)
    if (!source) throw new Error(`Chemin source de staging invalide : ${relativePath}`)
    await assertNoSymlinkInPath(session.root, source)
    const current = await readFile(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (expected === 'nouveau-fichier') {
      if (current !== null) throw new Error(`Le fichier ${relativePath} a été créé depuis la construction du staging. Reconstruisez-le avant l’export.`)
      continue
    }
    if (!current || createHash('sha256').update(current).digest('hex') !== expected) {
      throw new Error(`Le fichier ${relativePath} a changé depuis la construction du staging. Reconstruisez-le avant l’export.`)
    }
  }
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'projet'
}

async function uniqueDestination(parent: string, baseName: string): Promise<string> {
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidate = join(parent, suffix === 0 ? baseName : `${baseName}-${suffix + 1}`)
    if (!(await access(candidate, fsConstants.F_OK).then(() => true, () => false))) return candidate
  }
  throw new Error('Impossible de réserver un dossier d’export unique.')
}

async function chooseExportParent(owner: BrowserWindow, title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog(owner, {
    title,
    buttonLabel: 'Choisir ce dossier',
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
}

async function assertExportParentOutsideSource(parent: string, sourceRoot: string): Promise<void> {
  const realParent = await realpath(parent)
  const normalizedSource = normalize(sourceRoot.endsWith(sep) ? sourceRoot : `${sourceRoot}${sep}`)
  if (realParent === sourceRoot || realParent.startsWith(normalizedSource)) {
    throw new Error('Choisissez un dossier situé hors du projet source pour préserver son intégrité.')
  }
}

async function exportPatch(owner: BrowserWindow): Promise<string | null> {
  const session = currentSession()
  const staging = session.staging
  if (!staging) throw new Error('Préparez d’abord une version corrigée.')
  await assertStagingSourcesUnchanged(session)
  const result = await dialog.showSaveDialog(owner, {
    title: 'Exporter le patch Responsiver',
    defaultPath: `${slug(session.project.name)}-responsiver.patch`,
    filters: [{ name: 'Patch unifié', extensions: ['patch', 'diff'] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, staging.snapshot.patch, { encoding: 'utf8', mode: 0o600 })
  return result.filePath
}

async function exportChangedFiles(owner: BrowserWindow): Promise<ExportResult | null> {
  const session = currentSession()
  if (!session.staging) throw new Error('Préparez d’abord une version corrigée.')
  await assertStagingSourcesUnchanged(session)
  const parent = await chooseExportParent(owner, 'Exporter uniquement les fichiers modifiés')
  if (!parent) return null
  await assertExportParentOutsideSource(parent, session.root)
  const destination = await uniqueDestination(parent, `${slug(session.project.name)}-responsiver-modifications`)
  await mkdir(destination, { recursive: true })
  const files = await materializeOverrides(session.root, destination, session.staging.overrides)
  await writeFile(join(destination, 'responsiver.patch'), session.staging.snapshot.patch, { encoding: 'utf8', mode: 0o600 })
  return { path: destination, files }
}

function shouldCopyProjectPath(sourceRoot: string, source: string): boolean {
  const pathFromRoot = relative(sourceRoot, source)
  if (!pathFromRoot) return true
  return !pathFromRoot.split(sep).some((part) => ignoredCopyDirectories.has(part))
}

async function exportProjectCopy(owner: BrowserWindow): Promise<ExportResult | null> {
  const session = currentSession()
  if (!session.staging) throw new Error('Préparez d’abord une version corrigée.')
  await assertStagingSourcesUnchanged(session)
  const parent = await chooseExportParent(owner, 'Exporter une copie complète du projet corrigé')
  if (!parent) return null
  await assertExportParentOutsideSource(parent, session.root)
  const destination = await uniqueDestination(parent, `${slug(session.project.name)}-responsiver`)
  await cp(session.root, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    filter: (source) => shouldCopyProjectPath(session.root, source)
  })
  await materializeOverrides(session.root, destination, session.staging.overrides)
  return { path: destination, files: session.project.files }
}

function acceptedRuleIdsFromPayload(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').slice(0, 500)
  if (value && typeof value === 'object') {
    const ids = (value as { acceptedRuleIds?: unknown }).acceptedRuleIds
    if (Array.isArray(ids)) return ids.filter((item): item is string => typeof item === 'string').slice(0, 500)
  }
  return []
}

async function exportReport(owner: BrowserWindow, value: unknown): Promise<string | null> {
  const session = currentSession()
  const acceptedRuleIds = acceptedRuleIdsFromPayload(value)
  const result = await dialog.showSaveDialog(owner, {
    title: 'Exporter le rapport Responsiver',
    defaultPath: `${slug(session.project.name)}-responsiver.json`,
    filters: [{ name: 'Rapport JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return null
  const { previewOrigin: _previewOrigin, root: _root, id: _id, ...portableProject } = session.project
  const staging = session.staging
    ? { ...session.staging.snapshot, previewOrigin: null }
    : null
  const report = {
    generatedAt: new Date().toISOString(),
    application: `Responsiver ${app.getVersion()}`,
    localOnly: true,
    project: portableProject,
    projectId: createHash('sha256').update(`${session.project.name}\u001f${session.project.analyzedAt}`).digest('hex').slice(0, 12),
    acceptedRuleIds,
    staging
  }
  await writeFile(result.filePath, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 })
  return result.filePath
}

function configureWindowSecurity(window: BrowserWindow, packagedRendererUrl: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const expectedUrl = process.env.ELECTRON_RENDERER_URL
    const isAllowed = expectedUrl ? originOf(url) === originOf(expectedUrl) : url === packagedRendererUrl
    if (!isAllowed) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (details) => {
    const initiatorOrigin = details.initiator?.origin ?? details.frame?.origin
    const destinationOrigin = originOf(details.url)
    if (isLoopbackPreviewOrigin(initiatorOrigin) && destinationOrigin !== initiatorOrigin) details.preventDefault()
    else if (isLoopbackPreviewOrigin(destinationOrigin) && destinationOrigin && !knownPreviewOrigins.has(destinationOrigin)) details.preventDefault()
  })

  const electronSession = window.webContents.session
  electronSession.setPermissionCheckHandler(() => false)
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  electronSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const request = new URL(details.url)
      const initiatingOrigin = details.frame?.origin ?? originOf(details.referrer)
      if (!isLoopbackPreviewOrigin(initiatingOrigin)) {
        const targetsPreviewFrame = details.resourceType === 'subFrame' && isLoopbackPreviewOrigin(request.origin)
        callback({ cancel: targetsPreviewFrame && !knownPreviewOrigins.has(request.origin) })
        return
      }
      const isInlineResource = request.protocol === 'about:' || request.protocol === 'blob:' || request.protocol === 'data:'
      const isSamePreviewOrigin = request.origin === initiatingOrigin
      callback({ cancel: !(isInlineResource || isSamePreviewOrigin || isAllowedGoogleFont(request, details.resourceType)) })
    } catch {
      callback({ cancel: true })
    }
  })
}

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html')
  const packagedRendererUrl = pathToFileURL(rendererFile).toString()
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 920,
    minHeight: 680,
    title: 'Responsiver',
    backgroundColor: '#eceae4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  configureWindowSecurity(mainWindow, packagedRendererUrl)
  const window = mainWindow
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
    const projectSession = activeSession
    activeSession = null
    void disposeSession(projectSession)
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(rendererFile)
}

function registerIpcHandlers(): void {
  ipcMain.handle('project:choose', async (event): Promise<ProjectSnapshot | null> => {
    const owner = requireTrustedWindow(event)
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Choisir un projet web local',
      message: 'Choisissez le dossier racine du projet à analyser.',
      buttonLabel: 'Ouvrir ce dossier',
      properties: ['openDirectory']
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    return queueSessionOperation(async () => openLocalProject(await normalizeProjectSelection(selection.filePaths[0])))
  })

  ipcMain.handle('project:choose-file', async (event): Promise<ProjectSnapshot | null> => {
    const owner = requireTrustedWindow(event)
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Choisir une page HTML comme point d’entrée',
      buttonLabel: 'Ouvrir cette page',
      properties: ['openFile'],
      filters: [{ name: 'Pages web', extensions: ['html', 'htm'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    return queueSessionOperation(async () => openLocalProject(await normalizeProjectSelection(selection.filePaths[0])))
  })

  ipcMain.handle('project:open-path', async (event, path: unknown): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(async () => openLocalProject(await normalizeProjectSelection(path)))
  })
  ipcMain.handle('project:demo', async (event): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(openDemoProject)
  })
  ipcMain.handle('staging:build', async (event, request: unknown): Promise<StagingSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => buildStaging(request))
  })
  ipcMain.handle('staging:preview', async (event, request: unknown): Promise<StagingSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => previewStaging(request))
  })
  ipcMain.handle('staging:clear-preview', async (event, expectedOrigin: unknown): Promise<void> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => clearPreviewStaging(expectedOrigin))
  })
  ipcMain.handle('staging:clear', async (event): Promise<void> => {
    requireTrustedWindow(event)
    return queueSessionOperation(clearStaging)
  })
  ipcMain.handle('staging:export-patch', (event): Promise<string | null> => exportPatch(requireTrustedWindow(event)))
  ipcMain.handle('staging:export-changed', (event): Promise<ExportResult | null> => exportChangedFiles(requireTrustedWindow(event)))
  ipcMain.handle('staging:export-copy', (event): Promise<ExportResult | null> => exportProjectCopy(requireTrustedWindow(event)))
  ipcMain.handle('project:export-report', (event, payload: unknown): Promise<string | null> => exportReport(requireTrustedWindow(event), payload))
  ipcMain.handle('clipboard:write', (event, value: unknown): void => {
    requireTrustedWindow(event)
    if (typeof value !== 'string' || value.length > maxClipboardLength) throw new Error('Le texte à copier est invalide ou trop volumineux.')
    clipboard.writeText(value)
  })
}

app.whenReady().then(() => {
  app.setName('Responsiver')
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  const session = activeSession
  activeSession = null
  void disposeSession(session)
})
