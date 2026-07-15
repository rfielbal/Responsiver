import { app, BrowserWindow, clipboard, dialog, ipcMain, session as electronSession, type IpcMainInvokeEvent } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExportResult, LocalAiRequest, LocalAiResponse, LocalAiStatus, MatrixRunProgress, MatrixRunRequest, MatrixRunResult, ProjectIssue, ProjectPreparationProgress, ProjectSnapshot, RecentProjectSummary, RegressionFinding, RegressionReport, RemoteAuditResult, RemoteFocusResult, RemoteInspectorRequest, RemoteInspectorSelection, RemoteInspectorState, RemoteOpenRequest, RemotePageState, RemoteSourceAssociationRequest, RemoteViewBounds, RemoteViewport, RemoteVisualStyleRequest, RemoteVisualStyleResult, RemoteZoomGesture, StagingApplyResult, StagingRequest, StagingSnapshot, StagingUndoResult, StagingVerificationRequest, StagingVerificationResult, WorkspaceApplyResult, WorkspaceDiff, WorkspaceFileSnapshot, WorkspaceFileSummary, WorkspaceSnapshot } from '../shared/contracts'
import { analyzeProject, createDemoProject } from './project-analyzer'
import { startProjectServer, type ProjectServer } from './project-server'
import { buildProjectStaging, type ProjectStaging } from './project-transformer'
import { createRecentProjectsStore, type RecentProjectsStore } from './recent-projects'
import { assertPrivateExportDirectory, reservePrivateExportDirectory } from './secure-export'
import { REMOTE_INSPECTOR_LIMITS, RemoteBrowserSession } from './remote-session'
import { createWorkspaceEditor, type WorkspaceEditor } from './workspace-editor'
import { probeLocalAi, sendLocalAiRequest } from './local-ai'
import { resolveExtensionInbox, startExtensionInboxWatcher, type ExtensionOpenUrlRequest } from './extension-inbox'
import { applyProjectStagingToSource, undoProjectStagingSource, type StagingSourceUndoSnapshot } from './staging-source-apply'
import { compileVisualEditCss, validateVisualEditOperation } from '../shared/visual-editor'
import { CANONICAL_MATRIX_DEVICES, canonicalMatrixDevice } from '../shared/device-profiles'
import { compareMatrixSnapshots } from '../shared/regression-matrix'
import { classifyProjectIssue, isExpressEligibleIssue } from '../shared/finding-policy'
import { runProjectMatrix } from './matrix-runner'

interface StagingVerification {
  token: string
  stagingDigest: string
  sourceTreeDigest: string
  report: RegressionReport
  expiresAt: number
  used: boolean
}

interface ActiveProjectSession {
  root: string
  selectionPath: string | null
  recentId: string | null
  project: ProjectSnapshot
  sourceServer: ProjectServer | null
  proposalServer: ProjectServer | null
  stagedServer: ProjectServer | null
  workspaceServer: ProjectServer | null
  staging: ProjectStaging | null
  stagingUndo: StagingSourceUndoSnapshot | null
  remoteBrowser: RemoteBrowserSession | null
  workspace: WorkspaceEditor | null
  verification?: StagingVerification | null
  remoteRouteTruncation?: Map<string, boolean>
}

interface NormalizedProjectSelection {
  root: string
  selectionPath: string
  preferredEntryPath: string | null
}

let mainWindow: BrowserWindow | undefined
let activeSession: ActiveProjectSession | null = null
let recentProjectsStore: RecentProjectsStore | null = null
let sessionQueue: Promise<void> = Promise.resolve()
let workspaceQueue: Promise<void> = Promise.resolve()
let extensionInboxWatcher: ReturnType<typeof startExtensionInboxWatcher> | null = null
const knownPreviewOrigins = new Set<string>()
const maxClipboardLength = 10 * 1024 * 1024
const ignoredCopyDirectories = new Set(['.git', 'node_modules'])
const sourceTreeFingerprintLimits = Object.freeze({
  maxEntries: 50_000,
  maxContentBytes: 24 * 1024 * 1024,
  maxContentBytesPerFile: 2 * 1024 * 1024
})

const userDataOverride = process.env.RESPONSIVER_USER_DATA_DIR
if (userDataOverride && userDataOverride.length <= 4_096 && !userDataOverride.includes('\0') && isAbsolute(userDataOverride)) {
  app.setPath('userData', resolve(userDataOverride))
}

function queueSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionQueue.then(operation, operation)
  sessionQueue = result.then(() => undefined, () => undefined)
  return result
}

function queueWorkspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = workspaceQueue.then(operation, operation)
  workspaceQueue = result.then(() => undefined, () => undefined)
  return result
}

function notifyProjectPreparation(progress: ProjectPreparationProgress): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('project:preparation', progress)
}

function recentStore(): RecentProjectsStore {
  if (!recentProjectsStore) {
    recentProjectsStore = createRecentProjectsStore(join(app.getPath('userData'), 'recent-projects.v1.json'))
  }
  return recentProjectsStore
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
    closePreviewServer(session.stagedServer),
    closePreviewServer(session.workspaceServer),
    session.remoteBrowser?.close()
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
  if (selectedStat.isDirectory()) return { root: selected, selectionPath: selected, preferredEntryPath: null }
  if (!selectedStat.isFile() || !['.html', '.htm'].includes(extname(selected).toLowerCase())) {
    throw new Error('Responsiver accepte un dossier de projet ou un fichier HTML comme point d’entrée.')
  }
  const root = await realpath(dirname(selected))
  return { root, selectionPath: selected, preferredEntryPath: relativeWebPath(root, selected) }
}

async function prepareLocalProject(value: unknown): Promise<ProjectSnapshot> {
  notifyProjectPreparation({
    phase: 'selection',
    step: 1,
    total: 6,
    label: 'Validation du projet',
    detail: 'Responsiver vérifie le chemin local et les droits de lecture.'
  })
  return openLocalProject(await normalizeProjectSelection(value))
}

async function createLocalSession(selection: NormalizedProjectSelection): Promise<ActiveProjectSession> {
  const project = await analyzeProject(selection.root, {
    preferredEntryPath: selection.preferredEntryPath,
    onProgress: (progress) => {
      if (progress.phase === 'ready' || progress.phase === 'blocked') return
      notifyProjectPreparation(progress)
    }
  })
  notifyProjectPreparation({
    phase: 'preview',
    step: 5,
    total: 6,
    label: project.capabilities.interactive ? 'Démarrage du runner local' : 'Diagnostic du rendu finalisé',
    detail: project.capabilities.interactive
      ? project.previewBasePath
        ? `L’artefact ${project.previewBasePath} est monté sans exécuter sa chaîne de build.`
        : 'Responsiver prépare une origine locale isolée pour la prévisualisation.'
      : project.previewReadiness.summary
  })
  const sourceServer = project.entryPath && (project.previewReadiness.status === 'ready' || project.previewReadiness.status === 'degraded')
    ? await startProjectServer(selection.root, { mode: 'source', previewBasePath: project.previewBasePath ?? undefined })
    : null
  if (sourceServer) knownPreviewOrigins.add(sourceServer.origin)
  return {
    root: selection.root,
    selectionPath: selection.selectionPath,
    recentId: null,
    project: { ...project, previewOrigin: sourceServer?.origin ?? null },
    sourceServer,
    proposalServer: null,
    stagedServer: null,
    workspaceServer: null,
    staging: null,
    stagingUndo: null,
    remoteBrowser: null,
    workspace: null
  }
}

async function openLocalProject(selection: NormalizedProjectSelection, remember = true): Promise<ProjectSnapshot> {
  const next = await createLocalSession(selection)
  if (!mainWindow) {
    await disposeSession(next)
    throw new Error('La fenêtre Responsiver a été fermée pendant l’ouverture du projet.')
  }
  await replaceActiveSession(next)
  if (remember) {
    await recentStore().upsert(selection.selectionPath, next.project).then((memorizedId) => {
      // L’identifiant actif atteste que l’écriture atomique de la nouvelle
      // entrée a abouti. Il reste nul si l’historique est indisponible.
      next.recentId = memorizedId
    }).catch((error) => {
      console.warn('Historique local indisponible :', error instanceof Error ? error.message : 'erreur inconnue')
    })
  }
  const blocked = next.project.previewReadiness.status === 'blocked' || next.project.previewReadiness.status === 'needs-build'
  notifyProjectPreparation({
    phase: blocked ? 'blocked' : 'ready',
    step: 6,
    total: 6,
    label: blocked ? 'Diagnostic terminé' : 'Laboratoire prêt',
    detail: blocked
      ? next.project.previewReadiness.summary
      : `${next.project.issues.length} constat${next.project.issues.length > 1 ? 's' : ''} préparé${next.project.issues.length > 1 ? 's' : ''} · runner local actif.`
  })
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
  if (demoRoot) return openLocalProject({ root: demoRoot, selectionPath: demoRoot, preferredEntryPath: '/index.html' }, false)
  if (!mainWindow) throw new Error('La fenêtre Responsiver a été fermée pendant l’ouverture de la démonstration.')
  const project = createDemoProject()
  await replaceActiveSession({ root: '', selectionPath: null, recentId: null, project, sourceServer: null, proposalServer: null, stagedServer: null, workspaceServer: null, staging: null, stagingUndo: null, remoteBrowser: null, workspace: null })
  return project
}

function notifyRemoteState(state: RemotePageState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('remote:state', state)
}

async function normalizeLinkedRoot(value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 4_096 || value.includes('\0')) throw new Error('Le dossier associé au localhost est invalide.')
  const root = await realpath(value).catch(() => null)
  if (!root || !(await stat(root).catch(() => null))?.isDirectory()) throw new Error('Le dossier associé au localhost est introuvable.')
  return root
}

async function enrichLinkedSourceProfile(project: ProjectSnapshot, root: string | null): Promise<ProjectSnapshot> {
  if (!root) return project
  const local = await analyzeProject(root).catch(() => null)
  if (!local) return project
  const framework = local.capabilities.framework ?? project.capabilities.framework
  return {
    ...project,
    files: local.files,
    kind: framework && !project.kind.includes(framework) ? `${project.kind} · ${framework}` : project.kind,
    capabilities: {
      ...project.capabilities,
      framework,
      packageManager: local.capabilities.packageManager,
      buildRequired: local.capabilities.buildRequired
    }
  }
}

function validRemoteOpenRequest(value: unknown): value is RemoteOpenRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<RemoteOpenRequest>
  return typeof request.url === 'string' && request.url.length > 0 && request.url.length <= 4_096 &&
    (request.mode === 'public' || request.mode === 'localhost') &&
    (request.linkedRoot === undefined || request.linkedRoot === null || typeof request.linkedRoot === 'string')
}

async function openRemoteProject(value: unknown): Promise<ProjectSnapshot> {
  if (!validRemoteOpenRequest(value)) throw new Error('La demande d’ouverture URL est invalide.')
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('La fenêtre Responsiver est indisponible.')
  notifyProjectPreparation({ phase: 'selection', step: 1, total: 4, label: 'Validation de l’URL', detail: value.mode === 'public' ? 'Vérification HTTPS et résolution publique avant toute navigation.' : 'Vérification de la boucle locale et du dossier éventuellement associé.' })
  const linkedRoot = value.mode === 'localhost' ? await normalizeLinkedRoot(value.linkedRoot) : null
  notifyProjectPreparation({ phase: 'preview', step: 2, total: 4, label: 'Création de la session isolée', detail: 'Chromium prépare une partition éphémère sans accès Node, fichier ou IPC.' })
  let createdBrowser: RemoteBrowserSession | null = null
  const remoteBrowser = await RemoteBrowserSession.create({
    owner: mainWindow,
    request: value,
    linkedRoot,
    onState: notifyRemoteState,
    onBlockedNavigation: (url, detail) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('remote:blocked-navigation', { url, detail })
    },
    onInspectorSelection: (selection) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const session = activeSession
      if (!createdBrowser || session?.remoteBrowser !== createdBrowser) return
      const payload: RemoteInspectorSelection = { ...selection, projectId: session.project.id }
      mainWindow.webContents.send('remote:inspector-selection', payload)
    },
    onInspectorShortcut: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const session = activeSession
      if (!createdBrowser || session?.remoteBrowser !== createdBrowser) return
      mainWindow.webContents.send('remote:inspector-shortcut', session.project.id)
    },
    onInspectorCanceled: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const session = activeSession
      if (!createdBrowser || session?.remoteBrowser !== createdBrowser) return
      mainWindow.webContents.send('remote:inspector-canceled', session.project.id)
    },
    onInspectorReady: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const session = activeSession
      if (!createdBrowser || session?.remoteBrowser !== createdBrowser) return
      mainWindow.webContents.send('remote:inspector-ready', session.project.id)
    },
    onZoomGesture: (gesture) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const session = activeSession
      if (!createdBrowser || session?.remoteBrowser !== createdBrowser) return
      const payload: RemoteZoomGesture = { ...gesture, projectId: session.project.id }
      mainWindow.webContents.send('remote:zoom-gesture', payload)
    }
  })
  createdBrowser = remoteBrowser
  const project = await enrichLinkedSourceProfile(remoteBrowser.projectSnapshot(), linkedRoot)
  const next: ActiveProjectSession = {
    root: linkedRoot ?? '',
    selectionPath: linkedRoot,
    recentId: null,
    project,
    sourceServer: null,
    proposalServer: null,
    stagedServer: null,
    workspaceServer: null,
    staging: null,
    stagingUndo: null,
    remoteBrowser,
    workspace: null,
    remoteRouteTruncation: new Map()
  }
  await replaceActiveSession(next)
  notifyProjectPreparation({ phase: 'responsive', step: 3, total: 4, label: 'Rendu distant prêt', detail: 'La page est navigable. L’audit visuel se lancera dans les viewports sélectionnés.' })
  notifyProjectPreparation({ phase: 'ready', step: 4, total: 4, label: 'Laboratoire prêt', detail: linkedRoot ? 'Le localhost est associé à ses sources locales modifiables.' : 'La page est ouverte en lecture seule dans une session éphémère.' })
  return project
}

function currentRemoteSession(): { session: ActiveProjectSession; browser: RemoteBrowserSession } {
  const session = currentSession()
  if (!session.remoteBrowser) throw new Error('Aucune session URL n’est active.')
  return { session, browser: session.remoteBrowser }
}

function validRemoteInspectorRequest(value: unknown): value is RemoteInspectorRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<RemoteInspectorRequest>
  return typeof request.projectId === 'string' && request.projectId.length > 0 && request.projectId.length <= 300
}

function validRemoteVisualStyleRequest(value: unknown): value is RemoteVisualStyleRequest {
  if (!validRemoteInspectorRequest(value)) return false
  const request = value as Partial<RemoteVisualStyleRequest>
  if (!Object.keys(value as object).every((key) => key === 'projectId' || key === 'visualEdits' || key === 'route')) return false
  if (!Array.isArray(request.visualEdits) || request.visualEdits.length > 500) return false
  if (typeof request.route !== 'string' || !request.route.startsWith('/') || request.route.length > 2_048 || request.route.includes('\0')) return false
  const compiled = compileVisualEditCss(request.visualEdits, request.route)
  return compiled.invalid.length === 0 && compiled.conflicts.length === 0 &&
    Buffer.byteLength(compiled.css, 'utf8') <= REMOTE_INSPECTOR_LIMITS.maxCssBytes
}

function remoteSessionForRequest(value: unknown): { session: ActiveProjectSession; browser: RemoteBrowserSession } {
  if (!validRemoteInspectorRequest(value)) throw new Error('La demande d’inspection distante est invalide.')
  const current = currentRemoteSession()
  assertExpectedProject(current.session, value.projectId)
  return current
}

function validRemoteSourceAssociationRequest(value: unknown): value is RemoteSourceAssociationRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<RemoteSourceAssociationRequest>
  return typeof request.projectId === 'string' && request.projectId.length > 0 && request.projectId.length <= 300 &&
    typeof request.root === 'string' && request.root.trim().length > 0 && request.root.length <= 4_096 && !request.root.includes('\0')
}

async function associateRemoteSource(value: unknown): Promise<ProjectSnapshot> {
  if (!validRemoteSourceAssociationRequest(value)) throw new Error('La demande d’association des sources est invalide.')
  const { session, browser } = currentRemoteSession()
  assertExpectedProject(session, value.projectId)
  if (browser.mode !== 'localhost') throw new Error('Seule une session localhost peut être associée à un dossier source local.')
  const root = await normalizeLinkedRoot(value.root)
  if (!root) throw new Error('Choisissez un dossier source local existant.')
  if (activeSession !== session) throw new Error('La session a changé pendant la validation du dossier source.')
  if (session.root === root && !session.project.source.readOnly) return session.project
  if (session.workspace?.getSnapshot().dirtyCount) {
    throw new Error('Des changements temporaires sont encore ouverts. Appliquez-les ou écartez-les avant de remplacer le dossier source.')
  }
  // L’association ne redémarre ni ne recharge le site. Elle remplace uniquement
  // l’autorité locale utilisée par l’éditeur et efface un éventuel overlay CSS.
  await Promise.all([browser.setWorkspaceCss(''), browser.clearVisualStyle()])
  if (activeSession !== session) throw new Error('La session a changé pendant l’association du dossier source.')
  const previousWorkspaceServer = session.workspaceServer
  browser.associateLinkedRoot(root)
  const sourceProfile = await enrichLinkedSourceProfile(browser.projectSnapshot(session.project.issues), root)
  if (activeSession !== session) throw new Error('La session a changé pendant l’analyse du dossier source.')
  session.root = root
  session.selectionPath = root
  session.workspace = null
  session.workspaceServer = null
  const previous = session.project
  const linked = sourceProfile
  session.project = {
    ...linked,
    routes: previous.routes,
    theme: previous.theme,
    analysis: previous.analysis
  }
  await closePreviewServer(previousWorkspaceServer)
  mainWindow?.webContents.send('workspace:preview-origin', null)
  return session.project
}

async function runRemoteAudit(value: unknown): Promise<RemoteAuditResult> {
  if (!Array.isArray(value) || value.length > 8) throw new Error('La matrice de viewports est invalide.')
  const viewports: RemoteViewport[] = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Un viewport est invalide.')
    const viewport = entry as Partial<RemoteViewport>
    if (typeof viewport.width !== 'number' || typeof viewport.height !== 'number') throw new Error('Les dimensions du viewport sont invalides.')
    return viewport as RemoteViewport
  })
  const { session, browser } = currentRemoteSession()
  const result = await browser.audit(viewports)
  if (activeSession !== session) throw new Error('La session a changé pendant l’audit distant.')
  const currentState = browser.getState()
  const currentUrl = new URL(currentState.url)
  session.remoteRouteTruncation ??= new Map()
  session.remoteRouteTruncation.set(result.path, result.truncated)
  const previous = session.project
  const base = browser.projectSnapshot()
  const route = { path: currentState.path, label: currentUrl.pathname === '/' ? currentUrl.hostname : currentUrl.pathname, title: currentState.title, theme: 'unknown' as const }
  session.project = {
    ...base,
    files: previous.files,
    kind: previous.kind,
    capabilities: previous.capabilities,
    issues: [
      ...previous.issues.filter((issue) => (issue.routePath ?? issue.evidence?.route) !== result.path),
      ...result.findings
    ],
    routes: previous.routes.some((entry) => entry.path === result.path)
      ? previous.routes.map((entry) => entry.path === result.path ? route : entry)
      : [...previous.routes, route],
    analysis: { truncated: [...session.remoteRouteTruncation.values()].some(Boolean), scannedFiles: 0, scannedStyles: 0 }
  }
  return result
}

function assertExpectedProject(session: ActiveProjectSession, expectedProjectId: unknown): void {
  if (typeof expectedProjectId !== 'string' || expectedProjectId.length > 300 || expectedProjectId !== session.project.id) {
    throw new Error('La session projet a changé. Rechargez l’espace code avant de continuer.')
  }
}

async function workspaceForSession(expectedProjectId: unknown): Promise<{ session: ActiveProjectSession; workspace: WorkspaceEditor }> {
  const session = currentEditableSession()
  assertExpectedProject(session, expectedProjectId)
  if (!session.workspace) session.workspace = await createWorkspaceEditor(session.root)
  if (activeSession !== session) throw new Error('La session projet a changé pendant l’ouverture de l’espace code.')
  return { session, workspace: session.workspace }
}

async function refreshWorkspacePreview(session: ActiveProjectSession): Promise<string | null> {
  const workspace = session.workspace
  if (!workspace) return null
  const overrides = workspace.getOverrides()
  if (session.remoteBrowser) {
    const css = [...overrides.entries()]
      .filter(([path]) => path.toLowerCase().endsWith('.css'))
      .map(([path, body]) => `/* ${path} — aperçu Responsiver */\n${body.toString('utf8')}`)
      .join('\n\n')
    await session.remoteBrowser.setWorkspaceCss(css)
    return null
  }
  const previous = session.workspaceServer
  if (overrides.size === 0 || !session.project.entryPath) {
    session.workspaceServer = null
    await closePreviewServer(previous)
    mainWindow?.webContents.send('workspace:preview-origin', null)
    return null
  }
  const server = await startProjectServer(session.root, { mode: 'proposal', overrides, previewBasePath: session.project.previewBasePath ?? undefined })
  knownPreviewOrigins.add(server.origin)
  session.workspaceServer = server
  await closePreviewServer(previous)
  mainWindow?.webContents.send('workspace:preview-origin', server.origin)
  return server.origin
}

function validWorkspacePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_000 && !value.includes('\0')
}

async function workspaceFile(expectedProjectId: unknown, value: unknown): Promise<WorkspaceFileSnapshot> {
  if (!validWorkspacePath(value)) throw new Error('Le fichier demandé est invalide.')
  const { session, workspace } = await workspaceForSession(expectedProjectId)
  const file = await workspace.readFile(value)
  if (activeSession !== session) throw new Error('La session projet a changé pendant la lecture du fichier.')
  return { ...file, diff: await workspace.getDiff(value), previewOrigin: session.workspaceServer?.origin ?? null }
}

async function replaceWorkspaceFile(expectedProjectId: unknown, value: unknown): Promise<WorkspaceFileSnapshot> {
  if (!value || typeof value !== 'object') throw new Error('La modification de fichier est invalide.')
  const request = value as { path?: unknown; content?: unknown; expectedVersion?: unknown }
  if (!validWorkspacePath(request.path) || typeof request.content !== 'string' || request.content.length > 4 * 1024 * 1024 || (request.expectedVersion !== undefined && (!Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 1))) {
    throw new Error('La modification de fichier est invalide ou trop volumineuse.')
  }
  const { session, workspace } = await workspaceForSession(expectedProjectId)
  session.verification = null
  const file = await workspace.replaceFile(request.path, request.content, request.expectedVersion as number | undefined)
  if (activeSession !== session) throw new Error('La session projet a changé pendant la préparation du fichier.')
  const previewOrigin = await refreshWorkspacePreview(session)
  return { ...file, diff: await workspace.getDiff(request.path), previewOrigin }
}

function validStagingRequest(value: unknown): value is StagingRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<StagingRequest>
  return Array.isArray(request.issueIds) && request.issueIds.length <= 500 && request.issueIds.every((id) => typeof id === 'string' && id.length <= 256) &&
    (request.themeTarget === null || request.themeTarget === 'dark' || request.themeTarget === 'light') &&
    Array.isArray(request.instructions) && request.instructions.length <= 100 && request.instructions.every((instruction) => typeof instruction === 'string' && instruction.length <= 2_000) &&
    (request.visualEdits === undefined || (Array.isArray(request.visualEdits) && request.visualEdits.length <= 500 && request.visualEdits.every((operation) => validateVisualEditOperation(operation).valid)))
}

function currentSession(): ActiveProjectSession {
  if (!activeSession) throw new Error('Ouvrez d’abord un projet ou une URL dans Responsiver.')
  return activeSession
}

function currentEditableSession(): ActiveProjectSession {
  const session = currentSession()
  if (!session.root || session.project.source.readOnly) throw new Error('Cette session est disponible en lecture seule.')
  return session
}

async function buildStaging(value: unknown): Promise<StagingSnapshot> {
  if (!validStagingRequest(value)) throw new Error('La demande de staging est invalide.')
  const session = currentEditableSession()
  session.verification = null
  if (!session.project.capabilities.staging) throw new Error('Ce projet ne possède pas encore de rendu exploitable à corriger.')
  const staging = await buildProjectStaging(session.root, session.project, value)
  const conflicts = staging.snapshot.outcomes?.filter((outcome) => outcome.status === 'conflict') ?? []
  if (conflicts.length) {
    throw new Error(`${conflicts.length} proposition${conflicts.length > 1 ? 's sont incompatibles' : ' est incompatible'} avec une autre sur la même cible. Retirez l’une des corrections concernées avant de construire le staging.`)
  }
  if (activeSession !== session || !mainWindow) throw new Error('La session projet a changé pendant la construction du staging.')
  const stagedServer = !session.remoteBrowser && session.project.entryPath
    ? await startProjectServer(session.root, { mode: 'staged', overrides: staging.overrides, previewBasePath: session.project.previewBasePath ?? undefined })
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
  const session = currentEditableSession()
  if (!session.project.capabilities.staging) throw new Error('Ce projet ne possède pas encore de rendu exploitable à prévisualiser.')
  const proposal = await buildProjectStaging(session.root, session.project, value)
  if (activeSession !== session || !mainWindow) throw new Error('La session projet a changé pendant la préparation de la prévisualisation.')
  const proposalServer = !session.remoteBrowser && session.project.entryPath
    ? await startProjectServer(session.root, { mode: 'proposal', overrides: proposal.overrides, previewBasePath: session.project.previewBasePath ?? undefined })
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
  activeSession.verification = null
  activeSession.stagedServer = null
  await closePreviewServer(server)
}

async function projectSourceTreeDigest(rootValue: string): Promise<string> {
  const root = await realpath(rootValue)
  const hash = createHash('sha256')
  const pending = [root]
  let entryCount = 0
  let contentBytes = 0

  while (pending.length) {
    const directory = pending.pop()!
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

    for (const entry of entries) {
      if (ignoredCopyDirectories.has(entry.name.toLowerCase())) continue
      entryCount += 1
      if (entryCount > sourceTreeFingerprintLimits.maxEntries) {
        throw new Error(`Le projet dépasse ${sourceTreeFingerprintLimits.maxEntries.toLocaleString('fr-FR')} entrées : Correction Express ne peut pas certifier tout l’arbre source de façon bornée.`)
      }

      const absolutePath = join(directory, entry.name)
      const relativePath = relative(root, absolutePath).split(sep).join('/')
      const metadata = await lstat(absolutePath)
      const metadataToken = `${metadata.mode}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`

      if (metadata.isSymbolicLink()) {
        hash.update(`L\0${relativePath}\0${metadataToken}\0`)
        continue
      }
      if (metadata.isDirectory()) {
        hash.update(`D\0${relativePath}\0${metadataToken}\0`)
        pending.push(absolutePath)
        continue
      }
      if (!metadata.isFile()) {
        hash.update(`O\0${relativePath}\0${metadataToken}\0`)
        continue
      }

      hash.update(`F\0${relativePath}\0${metadataToken}\0`)
      const canHashContent = metadata.size <= sourceTreeFingerprintLimits.maxContentBytesPerFile &&
        contentBytes + metadata.size <= sourceTreeFingerprintLimits.maxContentBytes
      if (!canHashContent) {
        hash.update('M\0')
        continue
      }
      const content = await readFile(absolutePath)
      const metadataAfterRead = await lstat(absolutePath)
      if (!metadataAfterRead.isFile() || metadataAfterRead.size !== metadata.size || metadataAfterRead.mtimeMs !== metadata.mtimeMs || metadataAfterRead.ctimeMs !== metadata.ctimeMs) {
        throw new Error(`Le fichier ${relativePath} a changé pendant le calcul de l’empreinte source.`)
      }
      contentBytes += content.length
      hash.update(`C\0${content.length}\0`)
      hash.update(content)
      hash.update('\0')
    }
  }

  hash.update(`SUMMARY\0${entryCount}\0${contentBytes}\0`)
  return hash.digest('hex')
}

function projectStagingDigest(staging: ProjectStaging): string {
  const hash = createHash('sha256')
  for (const [path, body] of [...staging.overrides.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path)
    hash.update('\0')
    hash.update(body)
    hash.update('\0')
  }
  for (const [path, digest] of Object.entries(staging.snapshot.sourceHashes ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path)
    hash.update('\0')
    hash.update(digest)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function validMatrixRunRequest(value: unknown): value is MatrixRunRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<MatrixRunRequest>
  return typeof request.projectId === 'string' && request.projectId.length > 0 && request.projectId.length <= 256 &&
    (request.mode === 'source' || request.mode === 'compare') &&
    (request.routes === undefined || Array.isArray(request.routes) && request.routes.length <= 30 && request.routes.every((route) => typeof route === 'string' && route.length > 0 && route.length <= 2_048)) &&
    (request.deviceIds === undefined || Array.isArray(request.deviceIds) && request.deviceIds.length <= 3 && request.deviceIds.every((id) => id === 'mobile' || id === 'tablet' || id === 'desktop')) &&
    (request.states === undefined || Array.isArray(request.states) && request.states.length <= 3 && request.states.every((state) => state === 'initial' || state === 'navigation-open' || state === 'keyboard-focus'))
}

function validStagingVerificationRequest(value: unknown): value is StagingVerificationRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<StagingVerificationRequest>
  return typeof request.projectId === 'string' && request.projectId.length > 0 && request.projectId.length <= 256 &&
    Array.isArray(request.issueIds) && request.issueIds.length > 0 && request.issueIds.length <= 6 &&
    new Set(request.issueIds).size === request.issueIds.length &&
    request.issueIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)
}

function selectedMatrixRoutes(session: ActiveProjectSession, requested: readonly string[] | undefined, limit: number): string[] {
  const known = session.project.routes.map((route) => route.path)
  const selected = requested?.length ? [...new Set(requested)] : known
  const invalid = selected.find((route) => !known.includes(route))
  if (invalid) throw new Error(`La route ${invalid} n’appartient plus au projet analysé.`)
  const fallback = session.project.entryPath ?? known[0]
  const result = selected.slice(0, limit)
  if (!result.length && fallback) result.push(fallback)
  if (!result.length) throw new Error('Aucune route exploitable ne peut être vérifiée.')
  return result
}

async function runSessionMatrix(session: ActiveProjectSession, request: MatrixRunRequest, routeLimit = 12): Promise<MatrixRunResult> {
  if (request.projectId !== session.project.id) throw new Error('La matrice demandée ne correspond plus au projet actif.')
  if (session.project.source.kind !== 'local-project' || !session.sourceServer) {
    throw new Error('La matrice reproductible est disponible pour les projets locaux servis par Responsiver. Les URL restent auditables dans le Laboratoire.')
  }
  if (session.project.previewBasePath || session.project.capabilities.previewStrategy === 'artifact') {
    throw new Error('Cette sortie compilée peut être auditée, mais pas certifiée comme source durable.')
  }
  const compare = request.mode === 'compare'
  if (compare && (!session.staging || !session.stagedServer)) throw new Error('Préparez une version corrigée avant de lancer la comparaison.')
  const routes = selectedMatrixRoutes(session, request.routes, routeLimit)
  const devices = request.deviceIds?.length
    ? request.deviceIds.map((id) => canonicalMatrixDevice(id)).filter((device): device is NonNullable<typeof device> => Boolean(device))
    : [...CANONICAL_MATRIX_DEVICES]
  const states = [...new Set(request.states?.length ? request.states : ['initial', 'navigation-open'] as const)]
  if (routes.length * devices.length * states.length > 120) throw new Error('Cette matrice dépasse 120 cellules. Réduisez les routes, formats ou états.')
  const runId = randomUUID()
  const progress = (update: Omit<MatrixRunProgress, 'runId'>): void => {
    if (activeSession !== session) throw new Error('La session projet a changé pendant la matrice.')
    mainWindow?.webContents.send('matrix:progress', { runId, ...update } satisfies MatrixRunProgress)
  }
  const source = await runProjectMatrix({
    projectId: session.project.id,
    role: 'source',
    origin: session.sourceServer.origin,
    routes,
    devices,
    states,
    onProgress: progress
  })
  if (activeSession !== session) throw new Error('La session projet a changé pendant la matrice.')
  let candidate = null
  let report = null
  if (compare) {
    candidate = await runProjectMatrix({
      projectId: session.project.id,
      role: 'candidate',
      origin: session.stagedServer!.origin,
      routes,
      devices,
      states,
      onProgress: progress
    })
    if (activeSession !== session) throw new Error('La session projet a changé pendant la comparaison.')
    progress({ phase: 'comparison', completed: 0, total: 1, current: null })
    report = compareMatrixSnapshots(source, candidate)
    progress({ phase: 'comparison', completed: 1, total: 1, current: null })
  }
  return { runId, source, candidate, report }
}

const expressRuntimeProofRules: Readonly<Record<string, readonly RegressionFinding['rule'][]>> = Object.freeze({
  'html.viewport-meta': ['responsive.missing-viewport'],
  'css.fixed-width': ['layout.viewport-overflow', 'layout.clipped-content', 'layout.useful-area-overflow'],
  'css.min-width-mobile': ['layout.viewport-overflow', 'layout.navigation-wrap', 'layout.clipped-content', 'layout.useful-area-overflow'],
  'css.nowrap': ['layout.navigation-wrap', 'layout.truncated-text', 'layout.clipped-content']
})

function comparableMatrixRoute(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const parsed = new URL(value, 'http://responsiver.local')
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return value.trim()
  }
}

function findingMatchesExpressSelector(finding: RegressionFinding, target: string | null | undefined): boolean {
  const normalizedTarget = (target ?? '').trim().replace(/\s+/g, ' ')
  if (!normalizedTarget) return true
  const normalizedFinding = finding.selector.trim().replace(/\s+/g, ' ')
  if (normalizedFinding === normalizedTarget) return true
  if (/^[.#][\w-]+$/.test(normalizedTarget)) {
    const escaped = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`${escaped}(?![\\w-])`).test(normalizedFinding)
  }
  return normalizedFinding.endsWith(normalizedTarget)
}

function expressIssueHasRuntimeProof(issue: ProjectIssue, report: RegressionReport): boolean {
  const expectedRules = expressRuntimeProofRules[issue.rule]
  if (!expectedRules?.length) return true
  const route = comparableMatrixRoute(issue.routePath ?? issue.evidence?.route)
  return report.fixed.some((finding) =>
    expectedRules.includes(finding.rule) &&
    (!route || comparableMatrixRoute(finding.route) === route) &&
    findingMatchesExpressSelector(finding, issue.fix?.selector)
  )
}

function requireExpressRuntimeProof(report: RegressionReport, issues: readonly ProjectIssue[]): RegressionReport {
  if (report.status !== 'passed') return report
  const unproven = issues.filter((issue) =>
    classifyProjectIssue(issue, issues).action !== 'auto-safe' && !expressIssueHasRuntimeProof(issue, report)
  )
  if (!unproven.length) return report
  const labels = unproven.slice(0, 3).map((issue) => issue.title).join(', ')
  return {
    ...report,
    status: 'inconclusive',
    reasons: [...report.reasons, `Le défaut ciblé n’a pas pu être prouvé comme corrigé dans la matrice : ${labels}.`]
  }
}

function targetsSharedStylesheet(issue: ProjectIssue, allIssues: readonly ProjectIssue[]): boolean {
  const file = issue.fix?.file.trim().replaceAll('\\', '/')
  if (!file || !/\.css$/i.test(file)) return false
  const affectedRoutes = issue.evidence?.measurements?.affectedRoutes
  if (typeof affectedRoutes === 'number' && affectedRoutes > 1) return true
  if (/même règle partagée par\s+\d+\s+pages?/i.test(issue.description)) return true
  const routesForFile = new Set(allIssues
    .filter((candidate) => candidate.fix?.file.trim().replaceAll('\\', '/') === file)
    .map((candidate) => candidate.routePath ?? candidate.evidence?.route)
    .filter((route): route is string => Boolean(route)))
  return routesForFile.size > 1
}

function sourceTreeChangedReport(report: RegressionReport, reason: string): RegressionReport {
  return {
    ...report,
    status: 'inconclusive',
    reasons: [...report.reasons, reason]
  }
}

async function verifyCurrentStaging(value: unknown): Promise<StagingVerificationResult> {
  if (!validStagingVerificationRequest(value)) throw new Error('La demande de vérification Express est invalide.')
  const session = assertLocalStagingSession()
  if (value.projectId !== session.project.id) throw new Error('Le projet actif a changé avant la vérification Express.')
  const staging = session.staging
  if (!staging || !session.stagedServer || !session.sourceServer) throw new Error('Préparez exactement les corrections à vérifier avant de lancer Correction Express.')
  const issues = value.issueIds.map((id) => session.project.issues.find((issue) => issue.id === id))
  if (issues.some((issue) => !issue)) throw new Error('Un constat sélectionné n’existe plus dans la dernière analyse.')
  if (issues.some((issue) => !isExpressEligibleIssue(issue!, session.project.issues))) {
    throw new Error('Correction Express est réservée aux corrections déterministes reliées à leur source. Ouvrez la Révision pour les changements libres ou ambigus.')
  }
  if (staging.snapshot.themeTarget || staging.snapshot.instructions.length || (staging.snapshot.visualEdits?.length ?? 0)) {
    throw new Error('Le staging Express contient un thème, une instruction ou un geste visuel supplémentaire. Ouvrez la Révision pour ce plan mixte.')
  }
  const requestedFindingIds = new Set(value.issueIds)
  const appliedOutcomes = (staging.snapshot.outcomes ?? []).filter((outcome) => outcome.status === 'applied')
  const appliedFindingIds = new Set(appliedOutcomes.flatMap((outcome) => outcome.findingIds))
  if (appliedOutcomes.some((outcome) => outcome.kind !== 'issue' || outcome.findingIds.some((id) => !requestedFindingIds.has(id)))) {
    throw new Error('Le staging contient une proposition supplémentaire qui n’a pas été demandée pour Correction Express.')
  }
  const missingOutcome = value.issueIds.find((id) => !appliedFindingIds.has(id))
  if (missingOutcome) throw new Error('Le staging ne contient pas exactement tous les correctifs sélectionnés. Reconstruisez-le.')
  const issueRoutes = issues.map((issue) => issue!.routePath ?? issue!.evidence?.route).filter((route): route is string => Boolean(route))
  const touchesSharedStylesheet = issues.some((issue) => targetsSharedStylesheet(issue!, session.project.issues))
  if (touchesSharedStylesheet && session.project.routes.length > 12) {
    throw new Error(`Cette feuille CSS est partagée par ${session.project.routes.length} routes. Correction Express s’arrête à 12 routes : lancez une matrice complète puis appliquez depuis la Révision.`)
  }
  const routes = touchesSharedStylesheet
    ? session.project.routes.map((route) => route.path)
    : [...new Set(issueRoutes)].slice(0, 2)
  const sourceTreeBefore = await projectSourceTreeDigest(session.root)
  const matrix = await runSessionMatrix(session, {
    projectId: session.project.id,
    mode: 'compare',
    routes: routes.length ? routes : undefined,
    deviceIds: ['mobile', 'tablet', 'desktop'],
    states: ['initial', 'navigation-open']
  }, touchesSharedStylesheet ? 12 : 2)
  let report = requireExpressRuntimeProof(matrix.report!, issues as ProjectIssue[])
  try {
    const sourceTreeAfter = await projectSourceTreeDigest(session.root)
    if (sourceTreeAfter !== sourceTreeBefore) {
      report = sourceTreeChangedReport(report, 'L’arbre source a changé pendant la matrice. Relancez Correction Express sur la version actuelle du projet.')
    }
  } catch {
    report = sourceTreeChangedReport(report, 'L’arbre source n’a pas pu être relu de façon stable après la matrice. Aucune certification ne peut être émise.')
  }
  const verifiedMatrix: MatrixRunResult = report === matrix.report ? matrix : { ...matrix, report }
  const expiresAt = Date.now() + 10 * 60_000
  const token = report.status === 'passed' ? randomUUID() : null
  session.verification = token ? {
    token,
    stagingDigest: projectStagingDigest(staging),
    sourceTreeDigest: sourceTreeBefore,
    report,
    expiresAt,
    used: false
  } : null
  return {
    report,
    verificationToken: token,
    expiresAt: token ? new Date(expiresAt).toISOString() : null,
    matrix: verifiedMatrix
  }
}

async function applyVerifiedStaging(token: unknown): Promise<StagingApplyResult> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 256) throw new Error('Le jeton de vérification est invalide.')
  const session = assertLocalStagingSession()
  const verification = session.verification
  const staging = session.staging
  if (!verification || !staging || verification.token !== token || verification.used || verification.report.status !== 'passed') {
    throw new Error('Cette version n’est pas couverte par une vérification anti-régression valide.')
  }
  if (verification.expiresAt < Date.now()) {
    session.verification = null
    throw new Error('La vérification a expiré. Relancez Correction Express avant d’appliquer.')
  }
  if (verification.stagingDigest !== projectStagingDigest(staging)) {
    session.verification = null
    throw new Error('La version préparée a changé depuis la vérification. Aucune écriture n’a été effectuée.')
  }
  let currentSourceTreeDigest: string
  try {
    currentSourceTreeDigest = await projectSourceTreeDigest(session.root)
  } catch {
    session.verification = null
    throw new Error('L’arbre source ne peut plus être contrôlé de façon stable. Relancez Correction Express avant toute écriture.')
  }
  if (verification.sourceTreeDigest !== currentSourceTreeDigest) {
    session.verification = null
    throw new Error('Le projet source a changé depuis la vérification. Aucune écriture n’a été effectuée.')
  }
  verification.used = true
  try {
    return await applyStagingToSource()
  } catch (error) {
    session.verification = null
    throw error
  }
}

function assertLocalStagingSession(): ActiveProjectSession {
  const session = currentEditableSession()
  if (session.project.source.kind !== 'local-project') {
    throw new Error('L’application directe des corrections est réservée aux projets locaux ouverts depuis leur dossier source.')
  }
  if (session.project.previewBasePath || session.project.capabilities.previewStrategy === 'artifact') {
    throw new Error('Cette prévisualisation cible une sortie compilée. Exportez le staging ou reportez le correctif dans les sources auteur afin qu’un prochain build ne l’efface pas.')
  }
  if (session.workspace?.getSnapshot().dirtyCount) {
    throw new Error('Des changements sont encore ouverts dans l’éditeur. Appliquez-les ou écartez-les avant de modifier les sources depuis le staging.')
  }
  return session
}

async function invalidateSourceMutationPreviews(session: ActiveProjectSession, paths: string[]): Promise<void> {
  const servers = [session.stagedServer, session.proposalServer, session.workspaceServer]
  session.staging = null
  session.stagedServer = null
  session.proposalServer = null
  session.workspaceServer = null
  session.workspace = null
  session.verification = null
  await Promise.all(servers.map((server) => closePreviewServer(server)))
  mainWindow?.webContents.send('workspace:preview-origin', null)
  // Le renderer peut recharger le rendu source et réanalyser les chemins
  // concernés sans recevoir le contenu ni les sauvegardes d’annulation.
  mainWindow?.webContents.send('workspace:applied', paths)
}

async function applyStagingToSource(): Promise<StagingApplyResult> {
  const session = assertLocalStagingSession()
  const staging = session.staging
  if (!staging) throw new Error('Préparez d’abord une version corrigée avant de l’appliquer aux sources.')
  const operation = await applyProjectStagingToSource(session.root, staging)
  if (activeSession !== session) throw new Error('La session projet a changé pendant l’application des corrections.')
  session.stagingUndo = operation.undo
  await invalidateSourceMutationPreviews(session, operation.result.paths)
  return operation.result
}

async function undoLastStagingApply(): Promise<StagingUndoResult> {
  const session = assertLocalStagingSession()
  const undo = session.stagingUndo
  if (!undo) throw new Error('Aucune application récente de staging ne peut être annulée dans cette session.')
  const result = await undoProjectStagingSource(undo)
  if (activeSession !== session) throw new Error('La session projet a changé pendant l’annulation des corrections.')
  session.stagingUndo = null
  await invalidateSourceMutationPreviews(session, result.paths)
  return result
}

async function reanalyzeCurrentProject(): Promise<ProjectSnapshot> {
  const session = currentEditableSession()
  if (session.project.source.kind !== 'local-project') throw new Error('La réanalyse directe est réservée aux projets locaux.')
  const selection = await normalizeProjectSelection(session.selectionPath ?? session.root)
  const undo = session.stagingUndo
  const recentId = session.recentId
  const next = await createLocalSession(selection)
  next.stagingUndo = undo
  next.recentId = recentId
  if (!mainWindow) {
    await disposeSession(next)
    throw new Error('La fenêtre Responsiver a été fermée pendant la réanalyse.')
  }
  await replaceActiveSession(next)
  if (recentId) {
    await recentStore().upsert(selection.selectionPath, next.project).then((memorizedId) => {
      next.recentId = memorizedId
    }).catch(() => undefined)
  }
  return next.project
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
    await assertPrivateExportDirectory(destination, dirname(destination))
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
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return normalized.slice(0, 120).replace(/-$/g, '') || 'projet'
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
  const [realParent, realSource] = await Promise.all([realpath(parent), realpath(sourceRoot)])
  const normalizedSource = normalize(realSource.endsWith(sep) ? realSource : `${realSource}${sep}`)
  if (realParent === realSource || realParent.startsWith(normalizedSource)) {
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
  const destination = await reservePrivateExportDirectory(parent, `${slug(session.project.name)}-responsiver-modifications`)
  await assertPrivateExportDirectory(destination, parent)
  const files = await materializeOverrides(session.root, destination, session.staging.overrides)
  await assertPrivateExportDirectory(destination, parent)
  await assertNoSymlinkInPath(destination, join(destination, 'responsiver.patch'))
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
  const destination = await reservePrivateExportDirectory(parent, `${slug(session.project.name)}-responsiver`)
  await assertPrivateExportDirectory(destination, parent)
  await cp(session.root, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    filter: (source) => shouldCopyProjectPath(session.root, source)
  })
  await assertPrivateExportDirectory(destination, parent)
  await materializeOverrides(session.root, destination, session.staging.overrides)
  await assertPrivateExportDirectory(destination, parent)
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
    localOnly: session.project.source.network === 'local-only',
    networkMode: session.project.source.network,
    auditSummary: session.remoteBrowser ? {
      auditedRoutes: session.remoteRouteTruncation?.size ?? 0,
      truncatedRoutes: [...(session.remoteRouteTruncation?.values() ?? [])].filter(Boolean).length
    } : null,
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
    autoHideMenuBar: process.platform !== 'darwin',
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

async function waitForRenderer(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoadingMainFrame()) return
  await new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()))
}

function extensionMode(url: string): 'public' | 'localhost' {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    ? 'localhost'
    : 'public'
}

async function openExtensionRequest(request: ExtensionOpenUrlRequest): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  const window = mainWindow
  if (!window) throw new Error('La fenêtre Responsiver est indisponible.')
  await waitForRenderer(window)
  const project = await queueSessionOperation(() => openRemoteProject({ url: request.url, mode: extensionMode(request.url), linkedRoot: null }))
  window.webContents.send('extension:open-project', {
    project,
    viewport: {
      width: request.viewport.width,
      height: request.viewport.height,
      deviceScaleFactor: request.viewport.devicePixelRatio,
      mobile: request.viewport.width < 700,
      touch: request.viewport.width < 1_100
    }
  })
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
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
    return queueSessionOperation(() => prepareLocalProject(selection.filePaths[0]))
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
    return queueSessionOperation(() => prepareLocalProject(selection.filePaths[0]))
  })
  ipcMain.handle('project:choose-linked-root', async (event): Promise<string | null> => {
    const owner = requireTrustedWindow(event)
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Associer les sources du serveur localhost',
      message: 'Choisissez la racine locale du projet servi par votre serveur déjà lancé.',
      buttonLabel: 'Associer ce dossier',
      properties: ['openDirectory']
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    return realpath(selection.filePaths[0])
  })

  ipcMain.handle('project:open-path', async (event, path: unknown): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => prepareLocalProject(path))
  })
  ipcMain.handle('project:reanalyze', async (event): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => queueWorkspaceOperation(reanalyzeCurrentProject))
  })
  ipcMain.handle('project:demo', async (event): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(openDemoProject)
  })
  ipcMain.handle('project:recent:list', async (event): Promise<RecentProjectSummary[]> => {
    requireTrustedWindow(event)
    return recentStore().list(activeSession?.recentId)
  })
  ipcMain.handle('project:recent:open', async (event, id: unknown): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    if (typeof id !== 'string' || !/^recent-[a-f\d]{20}$/.test(id)) throw new Error('Le projet récent demandé est invalide.')
    return queueSessionOperation(async () => {
      const recent = await recentStore().get(id)
      if (!recent) throw new Error('Ce projet n’existe plus dans l’historique local.')
      if (recent.availability === 'unreadable') throw new Error('Ce projet récent est temporairement indisponible à cet emplacement.')
      if (recent.availability === 'missing') throw new Error('Le chemin de ce projet récent est introuvable.')
      if (recent.availability === 'unsupported') throw new Error('L’entrée de ce projet récent n’est plus prise en charge.')
      const project = await prepareLocalProject(recent.selectionPath)
      // Une résolution iCloud, un déplacement ou un renommage produit une
      // nouvelle identité canonique lors de l’analyse. L’ancienne référence
      // n’est remplacée qu’après cette réouverture réussie ; une indisponibilité
      // temporaire ne supprime donc jamais l’historique.
      const memorizedId = activeSession?.recentId
      if (memorizedId && memorizedId !== id) {
        await recentStore().forget(id).catch(() => undefined)
      }
      return project
    })
  })
  ipcMain.handle('project:recent:forget', async (event, id: unknown): Promise<RecentProjectSummary[]> => {
    requireTrustedWindow(event)
    if (typeof id !== 'string' || !/^recent-[a-f\d]{20}$/.test(id)) throw new Error('Le projet récent demandé est invalide.')
    return queueSessionOperation(async () => {
      await recentStore().forget(id)
      return recentStore().list(activeSession?.recentId)
    })
  })
  ipcMain.handle('remote:open', async (event, request: unknown): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => openRemoteProject(request))
  })
  ipcMain.handle('remote:associate-root', async (event, request: unknown): Promise<ProjectSnapshot> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => queueWorkspaceOperation(() => associateRemoteSource(request)))
  })
  ipcMain.handle('remote:set-bounds', async (event, bounds: unknown): Promise<void> => {
    requireTrustedWindow(event)
    if (!bounds || typeof bounds !== 'object') throw new Error('Les limites de la preview distante sont invalides.')
    await remoteSessionForRequest(bounds).browser.setViewBounds(bounds as RemoteViewBounds)
  })
  ipcMain.handle('remote:navigate', async (event, action: unknown, value: unknown): Promise<RemotePageState> => {
    requireTrustedWindow(event)
    if (action !== 'back' && action !== 'forward' && action !== 'reload' && action !== 'url') throw new Error('L’action de navigation est invalide.')
    if (action === 'url' && (typeof value !== 'string' || value.length > 4_096)) throw new Error('L’URL de navigation est invalide.')
    return currentRemoteSession().browser.navigate(action, typeof value === 'string' ? value : undefined)
  })
  ipcMain.handle('remote:state', (event): RemotePageState => {
    requireTrustedWindow(event)
    return currentRemoteSession().browser.getState()
  })
  ipcMain.handle('remote:audit', async (event, viewports: unknown): Promise<RemoteAuditResult> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => queueWorkspaceOperation(() => runRemoteAudit(viewports)))
  })
  ipcMain.handle('remote:focus', async (event, selector: unknown): Promise<RemoteFocusResult> => {
    requireTrustedWindow(event)
    return currentRemoteSession().browser.focusSelector(selector)
  })
  ipcMain.handle('remote:inspector-start', async (event, request: unknown): Promise<RemoteInspectorState> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => remoteSessionForRequest(request).browser.startInspector())
  })
  ipcMain.handle('remote:inspector-stop', async (event, request: unknown): Promise<RemoteInspectorState> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => remoteSessionForRequest(request).browser.stopInspector())
  })
  ipcMain.handle('remote:visual-style-preview', async (event, request: unknown): Promise<RemoteVisualStyleResult> => {
    requireTrustedWindow(event)
    if (!validRemoteVisualStyleRequest(request)) throw new Error('La demande de prévisualisation visuelle est invalide.')
    return queueSessionOperation(() => remoteSessionForRequest(request).browser.previewVisualStyle(request.visualEdits, request.route))
  })
  ipcMain.handle('remote:visual-style-clear', async (event, request: unknown): Promise<RemoteVisualStyleResult> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => remoteSessionForRequest(request).browser.clearVisualStyle())
  })
  ipcMain.handle('workspace:list', async (event, projectId: unknown): Promise<WorkspaceFileSummary[]> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(async () => (await workspaceForSession(projectId)).workspace.listFiles())
  })
  ipcMain.handle('workspace:read', async (event, projectId: unknown, path: unknown): Promise<WorkspaceFileSnapshot> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(() => workspaceFile(projectId, path))
  })
  ipcMain.handle('workspace:replace', async (event, projectId: unknown, request: unknown): Promise<WorkspaceFileSnapshot> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(() => replaceWorkspaceFile(projectId, request))
  })
  ipcMain.handle('workspace:discard', async (event, projectId: unknown, path: unknown, expectedVersion: unknown): Promise<WorkspaceFileSnapshot> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(async () => {
      if (!validWorkspacePath(path) || (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1))) throw new Error('La demande d’annulation est invalide.')
      const { session, workspace } = await workspaceForSession(projectId)
      const file = await workspace.discard(path, expectedVersion as number | undefined)
      if (activeSession !== session) throw new Error('La session projet a changé pendant l’annulation du fichier.')
      const previewOrigin = await refreshWorkspacePreview(session)
      return { ...file, diff: await workspace.getDiff(path), previewOrigin }
    })
  })
  ipcMain.handle('workspace:snapshot', async (event, projectId: unknown): Promise<WorkspaceSnapshot> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(async () => (await workspaceForSession(projectId)).workspace.getSnapshot())
  })
  ipcMain.handle('workspace:diff', async (event, projectId: unknown, path: unknown): Promise<WorkspaceDiff> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(async () => {
      if (!validWorkspacePath(path)) throw new Error('Le fichier demandé est invalide.')
      return (await workspaceForSession(projectId)).workspace.getDiff(path)
    })
  })
  ipcMain.handle('workspace:apply-file', async (event, projectId: unknown, path: unknown, expectedVersion: unknown): Promise<WorkspaceApplyResult> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(async () => {
      if (!validWorkspacePath(path) || (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1))) throw new Error('La demande d’application est invalide.')
      const { session, workspace } = await workspaceForSession(projectId)
      const result = await workspace.applyFile(path, expectedVersion as number | undefined)
      if (activeSession !== session) throw new Error('La session projet a changé pendant l’application du fichier.')
      await refreshWorkspacePreview(session)
      if (session.remoteBrowser) session.remoteBrowser.navigate('reload').catch(() => undefined)
      mainWindow?.webContents.send('workspace:applied', [result.path])
      return result
    })
  })
  ipcMain.handle('workspace:apply-all', async (event, projectId: unknown): Promise<WorkspaceApplyResult[]> => {
    requireTrustedWindow(event)
    return queueWorkspaceOperation(async () => {
      const { session, workspace } = await workspaceForSession(projectId)
      const results = await workspace.applyAll()
      if (activeSession !== session) throw new Error('La session projet a changé pendant l’application des fichiers.')
      await refreshWorkspacePreview(session)
      if (session.remoteBrowser) session.remoteBrowser.navigate('reload').catch(() => undefined)
      mainWindow?.webContents.send('workspace:applied', results.map((result) => result.path))
      return results
    })
  })
  ipcMain.handle('ai:local-probe', async (event, provider: unknown, endpoint: unknown): Promise<LocalAiStatus> => {
    requireTrustedWindow(event)
    return probeLocalAi(provider, endpoint)
  })
  ipcMain.handle('ai:local-send', async (event, request: unknown): Promise<LocalAiResponse> => {
    requireTrustedWindow(event)
    return sendLocalAiRequest(request as LocalAiRequest)
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
  ipcMain.handle('staging:apply-source', async (event): Promise<StagingApplyResult> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => queueWorkspaceOperation(applyStagingToSource))
  })
  ipcMain.handle('matrix:run', async (event, request: unknown): Promise<MatrixRunResult> => {
    requireTrustedWindow(event)
    if (!validMatrixRunRequest(request)) throw new Error('Le plan de matrice est invalide.')
    return queueSessionOperation(() => runSessionMatrix(currentEditableSession(), request))
  })
  ipcMain.handle('staging:verify', async (event, request: unknown): Promise<StagingVerificationResult> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => verifyCurrentStaging(request))
  })
  ipcMain.handle('staging:apply-verified', async (event, token: unknown): Promise<StagingApplyResult> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => queueWorkspaceOperation(() => applyVerifiedStaging(token)))
  })
  ipcMain.handle('staging:undo-source', async (event): Promise<StagingUndoResult> => {
    requireTrustedWindow(event)
    return queueSessionOperation(() => queueWorkspaceOperation(undoLastStagingApply))
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

const ownsInstanceLock = app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()

app.on('second-instance', () => {
  const window = mainWindow
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  void extensionInboxWatcher?.poll()
})

app.whenReady().then(async () => {
  if (!ownsInstanceLock) return
  app.setName('Responsiver')
  registerIpcHandlers()
  createWindow()
  extensionInboxWatcher = startExtensionInboxWatcher(resolveExtensionInbox(app.getPath('userData')), openExtensionRequest)
  await extensionInboxWatcher.poll().catch(() => 0)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    void extensionInboxWatcher?.poll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  extensionInboxWatcher?.close()
  extensionInboxWatcher = null
  const session = activeSession
  activeSession = null
  void disposeSession(session)
})
