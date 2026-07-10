import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants, type Dirent } from 'node:fs'
import { access, chmod, lstat, mkdir, open, readdir, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  ProjectSnapshot,
  RecentProjectAvailability,
  RecentProjectSummary
} from '../shared/contracts'

const documentVersion = 1
const defaultMaxEntries = 6
const defaultMaxBytes = 64 * 1024
const maxPathLength = 4_096
const maxLabelLength = 256
const maxCount = 100_000_000
const storedKeys = new Set([
  'id',
  'name',
  'selectionPath',
  'root',
  'entryPath',
  'kind',
  'files',
  'routes',
  'issues',
  'analyzedAt',
  'lastOpenedAt'
])

interface StoredRecentProject {
  id: string
  name: string
  selectionPath: string
  root: string
  entryPath: string | null
  kind: string
  files: number
  routes: number
  issues: number
  analyzedAt: string
  lastOpenedAt: string
}

interface RecentProjectsDocument {
  version: typeof documentVersion
  entries: StoredRecentProject[]
}

export interface RecentProjectsStoreOptions {
  maxEntries?: number
  maxBytes?: number
  now?: () => Date
  /** Racines interchangeables d’un même espace iCloud. Principalement injectable pour les tests. */
  iCloudRoots?: string[]
}

interface NormalizedRecentProjectsStoreOptions {
  maxEntries: number
  maxBytes: number
  now: () => Date
  iCloudRoots: string[]
}

interface PathProbe {
  path: string
  availability: RecentProjectAvailability
  kind: 'directory' | 'html' | 'unsupported' | null
  existed: boolean
}

interface StoredSelectionResolution {
  path: string
  availability: RecentProjectAvailability
}

const ignoredRecoveryDirectories = new Set([
  '.git', '.next', '.nuxt', '.output', '.svelte-kit', 'build', 'coverage', 'dist',
  'node_modules', 'out', 'release', 'target', 'vendor'
])
const maxRecoveryEntries = 500
const maxRecoveryDepth = 3

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && !value.includes('\0') && value.length <= maximum && (allowEmpty || value.length > 0)
}

function isIsoDate(value: unknown): value is string {
  if (!isBoundedString(value, 64)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maxCount
}

function isEntryPath(value: unknown): value is string | null {
  if (value === null) return true
  if (!isBoundedString(value, maxPathLength)) return false
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false
  return !value.split('/').some((segment) => segment === '..')
}

export function recentProjectId(root: string, entryPath: string | null): string {
  return `recent-${createHash('sha256').update(root).update('\0').update(entryPath ?? '').digest('hex').slice(0, 20)}`
}

function isStoredProject(value: unknown): value is StoredRecentProject {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== storedKeys.size || keys.some((key) => !storedKeys.has(key))) return false
  if (!isBoundedString(value.root, maxPathLength) || !isAbsolute(value.root)) return false
  if (!isBoundedString(value.selectionPath, maxPathLength) || !isAbsolute(value.selectionPath)) return false
  if (!isEntryPath(value.entryPath)) return false
  return value.id === recentProjectId(value.root, value.entryPath) &&
    isBoundedString(value.name, maxLabelLength) &&
    isBoundedString(value.kind, maxLabelLength) &&
    isCount(value.files) &&
    isCount(value.routes) &&
    isCount(value.issues) &&
    isIsoDate(value.analyzedAt) &&
    isIsoDate(value.lastOpenedAt)
}

function parseDocument(source: string, maxEntries: number): RecentProjectsDocument | null {
  try {
    const value: unknown = JSON.parse(source)
    if (!isPlainObject(value) || Object.keys(value).length !== 2 || value.version !== documentVersion || !Array.isArray(value.entries)) return null
    if (!Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'entries') || value.entries.length > maxEntries) return null
    if (!value.entries.every(isStoredProject)) return null
    if (new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length) return null
    return { version: documentVersion, entries: value.entries }
  } catch {
    return null
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function defaultICloudRoots(): string[] {
  const home = homedir()
  return [
    join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
    join(home, 'Library', 'CloudStorage', 'iCloud Drive'),
    join(home, 'Library', 'CloudStorage', 'iCloudDrive')
  ]
}

function normalizedRoots(values: string[]): string[] {
  return [...new Set(values
    .filter((value) => isBoundedString(value, maxPathLength) && isAbsolute(value))
    .map((value) => resolve(value)))]
}

function iCloudSuffix(value: string, roots: string[]): string | null {
  const absolute = resolve(value)
  for (const root of roots) {
    if (isInside(root, absolute)) return relative(root, absolute)
  }

  // Ces formes sont les deux emplacements locaux employés par macOS. Extraire
  // uniquement ce qui suit leur racine permet aussi de restaurer un historique
  // créé avant une migration de compte, sans parcourir le disque.
  const portable = absolute.replaceAll('\\', '/')
  const markers = [
    '/Library/Mobile Documents/com~apple~CloudDocs',
    '/Library/CloudStorage/iCloud Drive',
    '/Library/CloudStorage/iCloudDrive'
  ]
  for (const marker of markers) {
    const markerIndex = portable.indexOf(marker)
    if (markerIndex === -1) continue
    const homePrefix = portable.slice(0, markerIndex)
    if (!/^\/Users\/[^/]+$/.test(homePrefix)) continue
    return portable.slice(markerIndex + marker.length).replace(/^\/+/, '').split('/').join(sep)
  }
  return null
}

function pathVariants(value: string, iCloudRoots: string[]): string[] {
  const absolute = resolve(value)
  const variants = [absolute, absolute.normalize('NFC'), absolute.normalize('NFD')]
  const suffix = iCloudSuffix(absolute, iCloudRoots)
  if (suffix !== null) {
    for (const root of iCloudRoots) variants.push(resolve(root, suffix))
  }
  return [...new Set(variants)]
}

function isPotentiallyTemporaryLocation(value: string, iCloudRoots: string[]): boolean {
  const absolute = resolve(value)
  if (iCloudSuffix(absolute, iCloudRoots) !== null) return true
  const portable = absolute.replaceAll('\\', '/')
  return portable.startsWith('/Volumes/') || portable.includes('/Library/CloudStorage/')
}

function missingAvailability(value: string, error: unknown, iCloudRoots: string[]): RecentProjectAvailability {
  const code = errorCode(error)
  if ((code === 'ENOENT' || code === 'ENOTDIR') && !isPotentiallyTemporaryLocation(value, iCloudRoots)) return 'missing'
  return 'unreadable'
}

async function probePath(value: string, iCloudRoots: string[]): Promise<PathProbe> {
  const requestedPath = resolve(value)
  let canonical: string
  try {
    canonical = await realpath(requestedPath)
  } catch (error) {
    const existsAsLink = await lstat(requestedPath).then(() => true, () => false)
    return {
      path: requestedPath,
      availability: missingAvailability(requestedPath, error, iCloudRoots),
      kind: null,
      existed: existsAsLink || !['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')
    }
  }

  let details
  try {
    details = await stat(canonical)
  } catch (error) {
    return { path: requestedPath, availability: missingAvailability(requestedPath, error, iCloudRoots), kind: null, existed: false }
  }

  const kind = details.isDirectory()
    ? 'directory'
    : details.isFile() && ['.html', '.htm'].includes(extname(canonical).toLowerCase())
      ? 'html'
      : 'unsupported'
  if (kind === 'unsupported') return { path: requestedPath, availability: 'unsupported', kind, existed: true }

  try {
    await access(canonical, kind === 'directory' ? fsConstants.R_OK | fsConstants.X_OK : fsConstants.R_OK)
    return { path: requestedPath, availability: 'available', kind, existed: true }
  } catch {
    return { path: requestedPath, availability: 'unreadable', kind, existed: true }
  }
}

function htmlSelection(entry: StoredRecentProject): boolean {
  return ['.html', '.htm'].includes(extname(entry.selectionPath).toLowerCase())
}

function relativeHtmlHints(entry: StoredRecentProject): string[] {
  const hints: string[] = []
  const selectedRelative = relative(entry.root, entry.selectionPath)
  if (selectedRelative && isInside(entry.root, entry.selectionPath) && ['.html', '.htm'].includes(extname(selectedRelative).toLowerCase())) {
    hints.push(selectedRelative)
  }
  if (entry.entryPath) {
    const entryRelative = entry.entryPath.replace(/^\/+/, '').split('/').join(sep)
    if (entryRelative && !entryRelative.split(sep).includes('..')) hints.push(entryRelative)
  }
  return [...new Set(hints)]
}

async function collectHtmlFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  let visited = 0
  let truncated = false

  async function visit(folder: string, depth: number): Promise<void> {
    if (truncated || depth > maxRecoveryDepth) return
    let entries: Dirent[]
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'fr'))
    for (const entry of entries) {
      visited += 1
      if (visited > maxRecoveryEntries) {
        truncated = true
        return
      }
      if (entry.isFile() && ['.html', '.htm'].includes(extname(entry.name).toLowerCase())) files.push(join(folder, entry.name))
    }
    for (const entry of entries) {
      if (truncated) return
      if (!entry.isDirectory() || entry.name.startsWith('.') || ignoredRecoveryDirectories.has(entry.name)) continue
      await visit(join(folder, entry.name), depth + 1)
    }
  }

  await visit(root, 0)
  return { files, truncated }
}

async function selectedHtmlWithinRoot(
  root: string,
  entry: StoredRecentProject,
  iCloudRoots: string[]
): Promise<string | null> {
  const hints = relativeHtmlHints(entry)
  for (const hint of hints) {
    const candidate = resolve(root, hint)
    if (!isInside(root, candidate)) continue
    const probe = await probePath(candidate, iCloudRoots)
    if (probe.availability === 'available' && probe.kind === 'html') return probe.path
  }

  const inventory = await collectHtmlFiles(root)
  if (inventory.truncated) return null
  const comparableFileName = (value: string): string => value.normalize('NFC').toLocaleLowerCase('fr')
  const expectedNames = new Set(hints.map((hint) => comparableFileName(basename(hint))))
  expectedNames.add(comparableFileName(basename(entry.selectionPath)))
  const sameName = inventory.files.filter((file) => expectedNames.has(comparableFileName(basename(file))))
  if (sameName.length === 1) {
    const probe = await probePath(sameName[0], iCloudRoots)
    if (probe.availability === 'available' && probe.kind === 'html') return probe.path
  }
  return null
}

function comparableName(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('fr')
}

interface VersionedName {
  skeleton: string
  version: string
}

function versionedName(value: string): VersionedName | null {
  const normalized = comparableName(value)
  const versionPattern = /(^|[\s._(-])(v(?:ersion)?[\s._-]*\d+(?:[\s._-]+\d+)*)(?=$|[\s.)_-])/giu
  const matches = [...normalized.matchAll(versionPattern)]
  if (matches.length !== 1 || matches[0].index === undefined) return null
  const match = matches[0]
  const prefix = match[1] ?? ''
  const version = match[2] ?? ''
  const versionIndex = match.index + prefix.length
  return {
    skeleton: `${normalized.slice(0, versionIndex)}<version>${normalized.slice(versionIndex + version.length)}`,
    version
  }
}

function demonstrableRename(left: string, right: string): boolean {
  const first = comparableName(left)
  const second = comparableName(right)
  if (!first || !second) return false
  // Une différence de représentation Unicode (NFC/NFD) est sans ambiguïté.
  if (first === second) return true
  // Pour les dossiers versionnés, seules les versions peuvent différer. Cette
  // preuve stricte évite notamment de confondre « Site » et « Site Jessica ».
  const firstVersion = versionedName(first)
  const secondVersion = versionedName(second)
  return Boolean(firstVersion && secondVersion &&
    firstVersion.skeleton === secondVersion.skeleton &&
    firstVersion.version !== secondVersion.version)
}

async function relocatedSiblingRoot(
  root: string,
  entry: StoredRecentProject,
  iCloudRoots: string[]
): Promise<string | null> {
  if (!entry.entryPath) return null
  const parent = dirname(root)
  const parentProbe = await probePath(parent, iCloudRoots)
  if (parentProbe.availability !== 'available' || parentProbe.kind !== 'directory') return null
  let entries: Dirent[]
  try {
    entries = await readdir(parentProbe.path, { withFileTypes: true })
  } catch {
    return null
  }
  if (entries.length > maxRecoveryEntries) return null

  const matches: string[] = []
  for (const sibling of entries) {
    if (!sibling.isDirectory() || sibling.name.startsWith('.') || !demonstrableRename(basename(root), sibling.name)) continue
    const candidate = join(parentProbe.path, sibling.name)
    const candidateProbe = await probePath(candidate, iCloudRoots)
    if (candidateProbe.availability !== 'available' || candidateProbe.kind !== 'directory') continue
    if (entry.entryPath) {
      const expectedEntry = resolve(candidateProbe.path, entry.entryPath.replace(/^\/+/, '').split('/').join(sep))
      const entryProbe = isInside(candidateProbe.path, expectedEntry) ? await probePath(expectedEntry, iCloudRoots) : null
      if (!entryProbe || entryProbe.availability !== 'available' || entryProbe.kind !== 'html') continue
    }
    matches.push(candidateProbe.path)
  }
  return matches.length === 1 ? matches[0] : null
}

async function resolveStoredSelection(entry: StoredRecentProject, iCloudRoots: string[]): Promise<StoredSelectionResolution> {
  const selectionCandidates = pathVariants(entry.selectionPath, iCloudRoots)
  let selectionBlocked = false
  let unsupported = false
  for (const candidate of selectionCandidates) {
    const probe = await probePath(candidate, iCloudRoots)
    if (probe.availability === 'available' && (probe.kind === 'directory' || probe.kind === 'html')) {
      return { path: probe.path, availability: 'available' }
    }
    selectionBlocked ||= probe.availability === 'unreadable' && probe.existed
    unsupported ||= probe.availability === 'unsupported'
  }
  if (unsupported) return { path: entry.selectionPath, availability: 'unsupported' }
  if (selectionBlocked) return { path: entry.selectionPath, availability: 'unreadable' }

  const rootCandidates = pathVariants(entry.root, iCloudRoots)
  let rootBlocked = false
  for (const candidate of rootCandidates) {
    const probe = await probePath(candidate, iCloudRoots)
    rootBlocked ||= probe.availability === 'unreadable' && probe.existed
    if (probe.availability !== 'available' || probe.kind !== 'directory') continue
    if (htmlSelection(entry)) {
      const restoredFile = await selectedHtmlWithinRoot(probe.path, entry, iCloudRoots)
      if (restoredFile) return { path: restoredFile, availability: 'available' }
    }
    return { path: probe.path, availability: 'available' }
  }
  if (rootBlocked) return { path: entry.selectionPath, availability: 'unreadable' }

  for (const candidate of rootCandidates) {
    const relocated = await relocatedSiblingRoot(candidate, entry, iCloudRoots)
    if (!relocated) continue
    if (htmlSelection(entry)) {
      const restoredFile = await selectedHtmlWithinRoot(relocated, entry, iCloudRoots)
      if (restoredFile) return { path: restoredFile, availability: 'available' }
    }
    return { path: relocated, availability: 'available' }
  }

  const temporary = [...selectionCandidates, ...rootCandidates]
    .some((candidate) => isPotentiallyTemporaryLocation(candidate, iCloudRoots))
  return { path: entry.selectionPath, availability: temporary ? 'unreadable' : 'missing' }
}

function toSummary(entry: StoredRecentProject, resolution: StoredSelectionResolution, activeId?: string | null): RecentProjectSummary {
  return {
    ...entry,
    selectionPath: resolution.path,
    availability: resolution.availability,
    isActive: Boolean(activeId && entry.id === activeId)
  }
}

function assertStorePath(filePath: string): string {
  if (!isBoundedString(filePath, maxPathLength) || !isAbsolute(filePath)) {
    throw new Error('Le chemin du fichier d’historique doit être absolu et valide.')
  }
  return resolve(filePath)
}

function assertOptions(options: RecentProjectsStoreOptions): NormalizedRecentProjectsStoreOptions {
  const maxEntries = options.maxEntries ?? defaultMaxEntries
  const maxBytes = options.maxBytes ?? defaultMaxBytes
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > defaultMaxEntries) throw new Error('La limite de projets récents est invalide.')
  if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 1024 * 1024) throw new Error('La limite du fichier d’historique est invalide.')
  if (options.iCloudRoots && (!Array.isArray(options.iCloudRoots) || options.iCloudRoots.length > 8)) {
    throw new Error('La liste des racines iCloud est invalide.')
  }
  return {
    maxEntries,
    maxBytes,
    now: options.now ?? (() => new Date()),
    iCloudRoots: normalizedRoots(options.iCloudRoots ?? defaultICloudRoots())
  }
}

export class RecentProjectsStore {
  readonly filePath: string
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly now: () => Date
  private readonly iCloudRoots: string[]
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string, options: RecentProjectsStoreOptions = {}) {
    this.filePath = assertStorePath(filePath)
    const normalizedOptions = assertOptions(options)
    this.maxEntries = normalizedOptions.maxEntries
    this.maxBytes = normalizedOptions.maxBytes
    this.now = normalizedOptions.now
    this.iCloudRoots = normalizedOptions.iCloudRoots
  }

  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async readEntries(): Promise<StoredRecentProject[]> {
    let metadata
    try {
      metadata = await lstat(this.filePath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      return []
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > this.maxBytes) return []

    let handle: FileHandle | undefined
    try {
      handle = await open(this.filePath, 'r')
      const openedMetadata = await handle.stat()
      if (!openedMetadata.isFile() || openedMetadata.size > this.maxBytes) return []
      const buffer = Buffer.alloc(this.maxBytes + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > this.maxBytes) return []
      return parseDocument(buffer.subarray(0, bytesRead).toString('utf8'), this.maxEntries)?.entries ?? []
    } catch {
      return []
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  private async writeEntries(entries: StoredRecentProject[]): Promise<void> {
    const document: RecentProjectsDocument = { version: documentVersion, entries }
    const source = `${JSON.stringify(document, null, 2)}\n`
    if (Buffer.byteLength(source) > this.maxBytes) throw new Error('Le fichier d’historique dépasse sa taille maximale.')

    const directory = dirname(this.filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await chmod(directory, 0o700)
    const temporaryPath = join(directory, `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`)
    let handle: FileHandle | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(source, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporaryPath, this.filePath)
      if (process.platform !== 'win32') await chmod(this.filePath, 0o600)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  list(activeId?: string | null): Promise<RecentProjectSummary[]> {
    return this.queue(() => this.readEntries()).then(async (entries) => {
      const visibleEntries = activeId && entries.some((entry) => entry.id === activeId)
        ? [entries.find((entry) => entry.id === activeId)!, ...entries.filter((entry) => entry.id !== activeId).slice(0, 5)]
        : entries.slice(0, 5)
      const summaries: RecentProjectSummary[] = []
      // Les sondes de chemins iCloud/volumes ne retiennent pas la file des
      // mutations, et deux résolutions suffisent pour garder le disque réactif.
      let cursor = 0
      const workers = Array.from({ length: Math.min(2, visibleEntries.length) }, async () => {
        while (cursor < visibleEntries.length) {
          const index = cursor
          cursor += 1
          const entry = visibleEntries[index]
          summaries[index] = toSummary(entry, await resolveStoredSelection(entry, this.iCloudRoots), activeId)
        }
      })
      await Promise.all(workers)
      return summaries
    })
  }

  get(id: string): Promise<RecentProjectSummary | null> {
    return this.queue(async () => {
      if (!isBoundedString(id, 64)) return null
      return (await this.readEntries()).find((candidate) => candidate.id === id) ?? null
    }).then(async (entry) => entry ? toSummary(entry, await resolveStoredSelection(entry, this.iCloudRoots)) : null)
  }

  upsert(selectionPath: string, snapshot: ProjectSnapshot): Promise<string> {
    return this.queue(async () => {
      if (!isBoundedString(selectionPath, maxPathLength) || !isAbsolute(selectionPath)) throw new Error('Le chemin du projet récent est invalide.')
      const root = snapshot.root
      const entryPath = snapshot.entryPath
      const openedAt = this.now().toISOString()
      const entry: StoredRecentProject = {
        id: recentProjectId(root, entryPath),
        name: snapshot.name,
        selectionPath: resolve(selectionPath),
        root,
        entryPath,
        kind: snapshot.kind,
        files: snapshot.files,
        routes: snapshot.routes.length,
        issues: snapshot.issues.length,
        analyzedAt: snapshot.analyzedAt,
        lastOpenedAt: openedAt
      }
      if (!isStoredProject(entry)) throw new Error('Les métadonnées du projet récent sont invalides.')
      const entries = (await this.readEntries()).filter((candidate) => (
        candidate.id !== entry.id && candidate.selectionPath !== entry.selectionPath
      ))
      await this.writeEntries([entry, ...entries].slice(0, this.maxEntries))
      return entry.id
    })
  }

  forget(id: string): Promise<boolean> {
    return this.queue(async () => {
      if (!isBoundedString(id, 64)) return false
      const entries = await this.readEntries()
      const retained = entries.filter((entry) => entry.id !== id)
      if (retained.length === entries.length) return false
      await this.writeEntries(retained)
      return true
    })
  }
}

export function createRecentProjectsStore(filePath: string, options: RecentProjectsStoreOptions = {}): RecentProjectsStore {
  return new RecentProjectsStore(filePath, options)
}
