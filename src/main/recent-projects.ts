import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, lstat, mkdir, open, rename, stat, unlink, type FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
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
}

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

async function availabilityOf(selectionPath: string): Promise<RecentProjectAvailability> {
  let details
  try {
    details = await stat(selectionPath)
  } catch (error) {
    const code = errorCode(error)
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable'
  }

  if (!details.isDirectory() && !(details.isFile() && ['.html', '.htm'].includes(extname(selectionPath).toLowerCase()))) {
    return 'unsupported'
  }

  try {
    const mode = details.isDirectory() ? fsConstants.R_OK | fsConstants.X_OK : fsConstants.R_OK
    await access(selectionPath, mode)
    return 'available'
  } catch {
    return 'unreadable'
  }
}

function toSummary(entry: StoredRecentProject, availability: RecentProjectAvailability, activeId?: string | null): RecentProjectSummary {
  return { ...entry, availability, isActive: Boolean(activeId && entry.id === activeId) }
}

function assertStorePath(filePath: string): string {
  if (!isBoundedString(filePath, maxPathLength) || !isAbsolute(filePath)) {
    throw new Error('Le chemin du fichier d’historique doit être absolu et valide.')
  }
  return resolve(filePath)
}

function assertOptions(options: RecentProjectsStoreOptions): Required<RecentProjectsStoreOptions> {
  const maxEntries = options.maxEntries ?? defaultMaxEntries
  const maxBytes = options.maxBytes ?? defaultMaxBytes
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > defaultMaxEntries) throw new Error('La limite de projets récents est invalide.')
  if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 1024 * 1024) throw new Error('La limite du fichier d’historique est invalide.')
  return { maxEntries, maxBytes, now: options.now ?? (() => new Date()) }
}

export class RecentProjectsStore {
  readonly filePath: string
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly now: () => Date
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string, options: RecentProjectsStoreOptions = {}) {
    this.filePath = assertStorePath(filePath)
    const normalizedOptions = assertOptions(options)
    this.maxEntries = normalizedOptions.maxEntries
    this.maxBytes = normalizedOptions.maxBytes
    this.now = normalizedOptions.now
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
    return this.queue(async () => {
      const entries = await this.readEntries()
      const visibleEntries = activeId && entries.some((entry) => entry.id === activeId)
        ? [entries.find((entry) => entry.id === activeId)!, ...entries.filter((entry) => entry.id !== activeId).slice(0, 5)]
        : entries.slice(0, 5)
      return Promise.all(visibleEntries.map(async (entry) => toSummary(entry, await availabilityOf(entry.selectionPath), activeId)))
    })
  }

  get(id: string): Promise<RecentProjectSummary | null> {
    return this.queue(async () => {
      if (!isBoundedString(id, 64)) return null
      const entry = (await this.readEntries()).find((candidate) => candidate.id === id)
      return entry ? toSummary(entry, await availabilityOf(entry.selectionPath)) : null
    })
  }

  upsert(selectionPath: string, snapshot: ProjectSnapshot): Promise<void> {
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
