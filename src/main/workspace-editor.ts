import { constants as fsConstants } from 'node:fs'
import {
  lstat,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_OVERLAY_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_WORKSPACE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_LISTED_FILES = 10_000
const DEFAULT_MAX_DIFF_CHARACTERS = 120_000

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.turbo',
  '.vite',
  'bower_components',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor'
])

const TEXT_EXTENSIONS = new Set([
  '.astro',
  '.cjs',
  '.coffee',
  '.conf',
  '.css',
  '.csv',
  '.ejs',
  '.env.example',
  '.graphql',
  '.gql',
  '.hbs',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.json5',
  '.jsx',
  '.less',
  '.liquid',
  '.md',
  '.mdx',
  '.mjs',
  '.mustache',
  '.php',
  '.properties',
  '.py',
  '.rb',
  '.sass',
  '.scss',
  '.sh',
  '.shtml',
  '.svelte',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.twig',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
])

const TEXT_BASENAMES = new Set([
  'dockerfile',
  'gemfile',
  'makefile',
  'procfile',
  'readme',
  'license',
  'notice'
])

const FORBIDDEN_EXACT_NAMES = new Set([
  '.env',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials.json',
  'id_dsa',
  'id_ed25519',
  'id_ecdsa',
  'id_rsa',
  'secrets.json'
])

const FORBIDDEN_EXTENSIONS = new Set([
  '.bak',
  '.db',
  '.der',
  '.dump',
  '.jks',
  '.key',
  '.keystore',
  '.p12',
  '.pfx',
  '.pem',
  '.sqlite',
  '.sqlite3',
  '.sql'
])

export type WorkspaceEditorErrorCode =
  | 'BINARY_FILE'
  | 'FILE_TOO_LARGE'
  | 'FORBIDDEN_PATH'
  | 'INVALID_EDIT'
  | 'INVALID_PATH'
  | 'NOT_A_FILE'
  | 'NOT_DIRTY'
  | 'SOURCE_CONFLICT'
  | 'SYMLINK_REFUSED'
  | 'TOO_MANY_FILES'
  | 'VERSION_CONFLICT'

export class WorkspaceEditorError extends Error {
  readonly code: WorkspaceEditorErrorCode

  constructor(code: WorkspaceEditorErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceEditorError'
    this.code = code
  }
}

export interface WorkspaceEditorOptions {
  maxFileBytes?: number
  maxOverlayBytes?: number
  /** Budget mémoire cumulé de tous les buffers chargés. */
  maxWorkspaceBytes?: number
  maxListedFiles?: number
  maxDiffCharacters?: number
}

export interface WorkspaceFileSummary {
  path: string
  size: number
  modifiedAt: string
  dirty: boolean
  version: number | null
}

export interface WorkspaceFileContent {
  path: string
  content: string
  sourceHash: string
  currentHash: string
  size: number
  dirty: boolean
  version: number
}

export interface WorkspaceTextEdit {
  /** Offset UTF-16 inclusif, compatible avec les offsets Monaco. */
  start: number
  /** Offset UTF-16 exclusif, compatible avec les offsets Monaco. */
  end: number
  text: string
}

export interface WorkspaceDiff {
  path: string
  text: string
  additions: number
  deletions: number
  truncated: boolean
}

export interface WorkspaceDocumentSnapshot {
  path: string
  version: number
  dirty: boolean
  sourceHash: string
  currentHash: string
  sourceBytes: number
  currentBytes: number
  additions: number
  deletions: number
}

export interface WorkspaceSnapshot {
  root: string
  dirtyCount: number
  overlayBytes: number
  documents: WorkspaceDocumentSnapshot[]
}

export interface WorkspaceApplyResult {
  path: string
  hash: string
  bytes: number
  version: number
}

interface LoadedDocument {
  path: string
  sourceContent: string
  sourceHash: string
  sourceBytes: number
  overlayContent: string
  currentHash: string
  version: number
  dirty: boolean
}

interface ReadSourceResult {
  content: string
  hash: string
  bytes: number
}

interface DiffBody {
  text: string
  additions: number
  deletions: number
  truncated: boolean
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function isWithinRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}

function isForbiddenName(name: string): boolean {
  const lower = name.toLocaleLowerCase('en-US')
  if (lower.startsWith('.env')) return lower !== '.env.example'
  if (FORBIDDEN_EXACT_NAMES.has(lower)) return true
  if (FORBIDDEN_EXTENSIONS.has(extname(lower))) return true
  if (/^(?:credentials?|secrets?|service[-_.]?account)(?:\.|$)/u.test(lower)) return true
  return false
}

function isRelevantTextFile(name: string): boolean {
  const lower = name.toLocaleLowerCase('en-US')
  if (isForbiddenName(lower)) return false
  if (TEXT_BASENAMES.has(lower)) return true
  if (lower.startsWith('dockerfile.')) return true
  if (lower.endsWith('.env.example')) return true
  return TEXT_EXTENSIONS.has(extname(lower))
}

function assertPositiveInteger(value: number, optionName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${optionName} doit être un entier strictement positif.`)
  }
}

function decodeText(buffer: Buffer, path: string): string {
  if (buffer.includes(0)) {
    throw new WorkspaceEditorError('BINARY_FILE', `Le fichier « ${path} » semble binaire et ne peut pas être ouvert.`)
  }

  let suspiciousControls = 0
  for (const byte of buffer) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) {
      suspiciousControls += 1
    }
  }
  if (buffer.length > 0 && suspiciousControls / buffer.length > 0.01) {
    throw new WorkspaceEditorError('BINARY_FILE', `Le fichier « ${path} » semble binaire et ne peut pas être ouvert.`)
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new WorkspaceEditorError('BINARY_FILE', `Le fichier « ${path} » n’est pas un texte UTF-8 valide.`)
  }
}

function splitLines(value: string): string[] {
  if (value.length === 0) return []
  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function createSimpleDiff(before: string, after: string, path: string, maxCharacters: number): DiffBody {
  if (before === after) return { text: '', additions: 0, deletions: 0, truncated: false }

  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) {
    suffix += 1
  }

  const context = 3
  const contextStart = Math.max(0, prefix - context)
  const oldChangeEnd = oldLines.length - suffix
  const newChangeEnd = newLines.length - suffix
  const contextEndOld = Math.min(oldLines.length, oldChangeEnd + context)
  const contextEndNew = Math.min(newLines.length, newChangeEnd + context)
  const oldCount = contextEndOld - contextStart
  const newCount = contextEndNew - contextStart
  const additions = newChangeEnd - prefix
  const deletions = oldChangeEnd - prefix
  const output = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`
  ]

  for (let index = contextStart; index < prefix; index += 1) output.push(` ${oldLines[index]}`)
  for (let index = prefix; index < oldChangeEnd; index += 1) output.push(`-${oldLines[index]}`)
  for (let index = prefix; index < newChangeEnd; index += 1) output.push(`+${newLines[index]}`)
  for (let offset = 0; offset < Math.min(context, suffix); offset += 1) {
    output.push(` ${newLines[newChangeEnd + offset]}`)
  }

  const fullText = `${output.join('\n')}\n`
  if (fullText.length <= maxCharacters) {
    return { text: fullText, additions, deletions, truncated: false }
  }
  const marker = '\n… diff tronqué par Responsiver …\n'
  return {
    text: `${fullText.slice(0, Math.max(0, maxCharacters - marker.length))}${marker}`,
    additions,
    deletions,
    truncated: true
  }
}

export class WorkspaceEditor {
  readonly root: string
  private readonly maxFileBytes: number
  private readonly maxOverlayBytes: number
  private readonly maxWorkspaceBytes: number
  private readonly maxListedFiles: number
  private readonly maxDiffCharacters: number
  private readonly documents = new Map<string, LoadedDocument>()

  private constructor(root: string, options: WorkspaceEditorOptions) {
    this.root = root
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    this.maxOverlayBytes = options.maxOverlayBytes ?? DEFAULT_MAX_OVERLAY_BYTES
    this.maxWorkspaceBytes = options.maxWorkspaceBytes ?? DEFAULT_MAX_WORKSPACE_BYTES
    this.maxListedFiles = options.maxListedFiles ?? DEFAULT_MAX_LISTED_FILES
    this.maxDiffCharacters = options.maxDiffCharacters ?? DEFAULT_MAX_DIFF_CHARACTERS
    assertPositiveInteger(this.maxFileBytes, 'maxFileBytes')
    assertPositiveInteger(this.maxOverlayBytes, 'maxOverlayBytes')
    assertPositiveInteger(this.maxWorkspaceBytes, 'maxWorkspaceBytes')
    assertPositiveInteger(this.maxListedFiles, 'maxListedFiles')
    assertPositiveInteger(this.maxDiffCharacters, 'maxDiffCharacters')
  }

  static async create(root: string, options: WorkspaceEditorOptions = {}): Promise<WorkspaceEditor> {
    const resolvedRoot = await realpath(root)
    const metadata = await lstat(resolvedRoot)
    if (!metadata.isDirectory()) {
      throw new WorkspaceEditorError('INVALID_PATH', 'La racine de l’espace de changements doit être un dossier local.')
    }
    return new WorkspaceEditor(resolvedRoot, options)
  }

  private normalisePath(input: string): string {
    if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
      throw new WorkspaceEditorError('INVALID_PATH', 'Le chemin de fichier est invalide.')
    }
    const portable = input.replaceAll('\\', '/')
    if (portable.startsWith('/') || portable.startsWith('//') || /^[a-z]:/iu.test(portable)) {
      throw new WorkspaceEditorError('INVALID_PATH', 'Seuls les chemins relatifs à la racine du projet sont acceptés.')
    }
    const segments = portable.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new WorkspaceEditorError('INVALID_PATH', 'Le chemin ne peut pas sortir de la racine du projet.')
    }
    for (const segment of segments) {
      if (segment.startsWith('.')) {
        throw new WorkspaceEditorError('FORBIDDEN_PATH', 'Les fichiers et dossiers cachés ne sont pas accessibles dans l’éditeur.')
      }
      if (EXCLUDED_DIRECTORIES.has(segment.toLocaleLowerCase('en-US'))) {
        throw new WorkspaceEditorError('FORBIDDEN_PATH', `Le dossier « ${segment} » est exclu de l’espace de changements.`)
      }
    }
    if (isForbiddenName(segments.at(-1) ?? '')) {
      throw new WorkspaceEditorError('FORBIDDEN_PATH', 'Ce fichier peut contenir des secrets, des clés ou des données et reste inaccessible.')
    }

    const candidate = resolve(this.root, ...segments)
    if (!isWithinRoot(this.root, candidate)) {
      throw new WorkspaceEditorError('INVALID_PATH', 'Le chemin ne peut pas sortir de la racine du projet.')
    }
    return segments.join('/')
  }

  private async assertSafeExistingFile(relativePath: string): Promise<string> {
    const normalised = this.normalisePath(relativePath)
    const segments = normalised.split('/')
    let cursor = this.root
    for (let index = 0; index < segments.length; index += 1) {
      cursor = join(cursor, segments[index])
      const metadata = await lstat(cursor)
      if (metadata.isSymbolicLink()) {
        throw new WorkspaceEditorError('SYMLINK_REFUSED', `Le lien symbolique « ${normalised} » est refusé.`)
      }
      if (index < segments.length - 1 && !metadata.isDirectory()) {
        throw new WorkspaceEditorError('NOT_A_FILE', `« ${normalised} » n’est pas un fichier du projet.`)
      }
      if (index === segments.length - 1 && !metadata.isFile()) {
        throw new WorkspaceEditorError('NOT_A_FILE', `« ${normalised} » n’est pas un fichier texte ordinaire.`)
      }
    }

    const canonical = await realpath(cursor)
    if (!isWithinRoot(this.root, canonical) || canonical !== cursor) {
      throw new WorkspaceEditorError('SYMLINK_REFUSED', `Le chemin « ${normalised} » traverse un lien symbolique et reste inaccessible.`)
    }
    return cursor
  }

  private async readSource(relativePath: string): Promise<ReadSourceResult> {
    const normalised = this.normalisePath(relativePath)
    if (!isRelevantTextFile(basename(normalised))) {
      throw new WorkspaceEditorError('FORBIDDEN_PATH', `Le fichier « ${normalised} » n’est pas un fichier source texte pris en charge.`)
    }
    const absolutePath = await this.assertSafeExistingFile(normalised)
    const flags = fsConstants.O_RDONLY | (process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW)
    const handle = await open(absolutePath, flags)
    try {
      const metadata = await handle.stat()
      if (!metadata.isFile()) {
        throw new WorkspaceEditorError('NOT_A_FILE', `« ${normalised} » n’est pas un fichier texte ordinaire.`)
      }
      if (metadata.size > this.maxFileBytes) {
        throw new WorkspaceEditorError('FILE_TOO_LARGE', `Le fichier « ${normalised} » dépasse la limite de ${this.maxFileBytes} octets.`)
      }
      const buffer = Buffer.allocUnsafe(this.maxFileBytes + 1)
      let bytesRead = 0
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
        if (chunk.bytesRead === 0) break
        bytesRead += chunk.bytesRead
      }
      if (bytesRead > this.maxFileBytes) {
        throw new WorkspaceEditorError('FILE_TOO_LARGE', `Le fichier « ${normalised} » a grandi au-delà de la limite autorisée.`)
      }
      const bytes = buffer.subarray(0, bytesRead)
      return { content: decodeText(bytes, normalised), hash: sha256(bytes), bytes: bytesRead }
    } finally {
      await handle.close()
    }
  }

  private async loadDocument(relativePath: string): Promise<LoadedDocument> {
    const normalised = this.normalisePath(relativePath)
    const loaded = this.documents.get(normalised)
    if (loaded) return loaded
    const source = await this.readSource(normalised)
    const loadedBytes = [...this.documents.values()].reduce((total, document) => total + byteLength(document.overlayContent), 0)
    if (loadedBytes + source.bytes > this.maxWorkspaceBytes) {
      throw new WorkspaceEditorError(
        'FILE_TOO_LARGE',
        `Le budget mémoire de l’espace de changements (${this.maxWorkspaceBytes} octets) est atteint.`
      )
    }
    const document: LoadedDocument = {
      path: normalised,
      sourceContent: source.content,
      sourceHash: source.hash,
      sourceBytes: source.bytes,
      overlayContent: source.content,
      currentHash: source.hash,
      version: 1,
      dirty: false
    }
    this.documents.set(normalised, document)
    return document
  }

  private assertExpectedVersion(document: LoadedDocument, expectedVersion?: number): void {
    if (expectedVersion !== undefined && expectedVersion !== document.version) {
      throw new WorkspaceEditorError(
        'VERSION_CONFLICT',
        `La version ${expectedVersion} de « ${document.path} » est obsolète ; la version courante est ${document.version}.`
      )
    }
  }

  private assertOverlaySize(path: string, content: string): number {
    const bytes = byteLength(content)
    if (bytes > this.maxOverlayBytes) {
      throw new WorkspaceEditorError('FILE_TOO_LARGE', `La copie de travail de « ${path} » dépasse la limite de ${this.maxOverlayBytes} octets.`)
    }
    const existingBytes = this.documents.get(path) ? byteLength(this.documents.get(path)?.overlayContent ?? '') : 0
    const loadedBytes = [...this.documents.values()].reduce((total, document) => total + byteLength(document.overlayContent), 0)
    if (loadedBytes - existingBytes + bytes > this.maxWorkspaceBytes) {
      throw new WorkspaceEditorError(
        'FILE_TOO_LARGE',
        `Le budget mémoire de l’espace de changements (${this.maxWorkspaceBytes} octets) serait dépassé.`
      )
    }
    return bytes
  }

  private setOverlay(document: LoadedDocument, content: string): WorkspaceFileContent {
    const bytes = this.assertOverlaySize(document.path, content)
    document.overlayContent = content
    document.currentHash = sha256(content)
    document.dirty = document.currentHash !== document.sourceHash
    document.version += 1
    return this.toFileContent(document, bytes)
  }

  private toFileContent(document: LoadedDocument, currentBytes = byteLength(document.overlayContent)): WorkspaceFileContent {
    return {
      path: document.path,
      content: document.overlayContent,
      sourceHash: document.sourceHash,
      currentHash: document.currentHash,
      size: currentBytes,
      dirty: document.dirty,
      version: document.version
    }
  }

  async listFiles(): Promise<WorkspaceFileSummary[]> {
    const files: WorkspaceFileSummary[] = []
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const lower = entry.name.toLocaleLowerCase('en-US')
        if (isForbiddenName(lower)) continue
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        const absolutePath = join(directory, entry.name)
        const metadata = await lstat(absolutePath)
        if (metadata.isSymbolicLink()) continue
        if (metadata.isDirectory()) {
          if (!EXCLUDED_DIRECTORIES.has(lower)) await visit(absolutePath, relativePath)
          continue
        }
        if (!metadata.isFile() || !isRelevantTextFile(entry.name) || metadata.size > this.maxFileBytes) continue
        files.push({
          path: relativePath,
          size: metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
          dirty: this.documents.get(relativePath)?.dirty ?? false,
          version: this.documents.get(relativePath)?.version ?? null
        })
        if (files.length > this.maxListedFiles) {
          throw new WorkspaceEditorError('TOO_MANY_FILES', `Le projet contient plus de ${this.maxListedFiles} fichiers éditables.`)
        }
      }
    }

    await visit(this.root, '')
    return files
  }

  async readFile(relativePath: string): Promise<WorkspaceFileContent> {
    return this.toFileContent(await this.loadDocument(relativePath))
  }

  async replaceFile(relativePath: string, content: string, expectedVersion?: number): Promise<WorkspaceFileContent> {
    if (typeof content !== 'string') throw new TypeError('Le contenu de remplacement doit être une chaîne de caractères.')
    const document = await this.loadDocument(relativePath)
    this.assertExpectedVersion(document, expectedVersion)
    return this.setOverlay(document, content)
  }

  async applyEdits(relativePath: string, edits: readonly WorkspaceTextEdit[], expectedVersion?: number): Promise<WorkspaceFileContent> {
    const document = await this.loadDocument(relativePath)
    this.assertExpectedVersion(document, expectedVersion)
    if (!Array.isArray(edits) || edits.length === 0) {
      throw new WorkspaceEditorError('INVALID_EDIT', 'Au moins une modification bornée est requise.')
    }

    const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
    let previousEnd = -1
    for (const edit of sorted) {
      if (
        !Number.isSafeInteger(edit.start) ||
        !Number.isSafeInteger(edit.end) ||
        edit.start < 0 ||
        edit.end < edit.start ||
        edit.end > document.overlayContent.length ||
        typeof edit.text !== 'string' ||
        edit.start < previousEnd
      ) {
        throw new WorkspaceEditorError('INVALID_EDIT', `Une modification de « ${document.path} » est invalide ou chevauche une autre modification.`)
      }
      previousEnd = edit.end
    }

    let content = document.overlayContent
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const edit = sorted[index]
      content = `${content.slice(0, edit.start)}${edit.text}${content.slice(edit.end)}`
    }
    return this.setOverlay(document, content)
  }

  async getDiff(relativePath: string): Promise<WorkspaceDiff> {
    const document = await this.loadDocument(relativePath)
    const diff = createSimpleDiff(document.sourceContent, document.overlayContent, document.path, this.maxDiffCharacters)
    return { path: document.path, ...diff }
  }

  async discard(relativePath: string, expectedVersion?: number): Promise<WorkspaceFileContent> {
    const document = await this.loadDocument(relativePath)
    this.assertExpectedVersion(document, expectedVersion)
    return this.setOverlay(document, document.sourceContent)
  }

  discardAll(): WorkspaceSnapshot {
    for (const document of this.documents.values()) {
      if (!document.dirty) continue
      document.overlayContent = document.sourceContent
      document.currentHash = document.sourceHash
      document.dirty = false
      document.version += 1
    }
    return this.getSnapshot()
  }

  getSnapshot(): WorkspaceSnapshot {
    let dirtyCount = 0
    let overlayBytes = 0
    const documents = [...this.documents.values()]
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))
      .map((document): WorkspaceDocumentSnapshot => {
        const currentBytes = byteLength(document.overlayContent)
        const diff = createSimpleDiff(document.sourceContent, document.overlayContent, document.path, this.maxDiffCharacters)
        if (document.dirty) dirtyCount += 1
        overlayBytes += currentBytes
        return {
          path: document.path,
          version: document.version,
          dirty: document.dirty,
          sourceHash: document.sourceHash,
          currentHash: document.currentHash,
          sourceBytes: document.sourceBytes,
          currentBytes,
          additions: diff.additions,
          deletions: diff.deletions
        }
      })
    return { root: this.root, dirtyCount, overlayBytes, documents }
  }

  /** Copie défensive des seuls buffers modifiés, destinée au runner éphémère. */
  getOverrides(): ReadonlyMap<string, Buffer> {
    const overrides = new Map<string, Buffer>()
    for (const document of this.documents.values()) {
      if (document.dirty) overrides.set(document.path, Buffer.from(document.overlayContent, 'utf8'))
    }
    return overrides
  }

  private async assertSourceUnchanged(document: LoadedDocument): Promise<void> {
    const currentSource = await this.readSource(document.path)
    if (currentSource.hash !== document.sourceHash) {
      throw new WorkspaceEditorError(
        'SOURCE_CONFLICT',
        `Le fichier « ${document.path} » a changé sur le disque. Rechargez-le avant d’appliquer les modifications.`
      )
    }
  }

  async applyFile(relativePath: string, expectedVersion?: number): Promise<WorkspaceApplyResult> {
    const document = await this.loadDocument(relativePath)
    this.assertExpectedVersion(document, expectedVersion)
    if (!document.dirty) {
      throw new WorkspaceEditorError('NOT_DIRTY', `Aucune modification de « ${document.path} » n’est en attente.`)
    }
    await this.assertSourceUnchanged(document)

    const absolutePath = await this.assertSafeExistingFile(document.path)
    const originalMetadata = await stat(absolutePath)
    const temporaryPath = join(dirname(absolutePath), `.${basename(absolutePath)}.responsiver-${randomUUID()}.tmp`)
    const mode = process.platform === 'win32' ? undefined : originalMetadata.mode & 0o777
    const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY
    const handle = await open(temporaryPath, flags, mode)
    let renamed = false
    try {
      await handle.writeFile(document.overlayContent, 'utf8')
      await handle.sync()
      await handle.close()

      // Deuxième contrôle juste avant le remplacement : un fichier modifié pendant
      // la préparation n’est jamais écrasé silencieusement.
      await this.assertSourceUnchanged(document)
      await rename(temporaryPath, absolutePath)
      renamed = true
    } finally {
      try {
        await handle.close()
      } catch {
        // Le descripteur est normalement déjà fermé avant rename.
      }
      if (!renamed) {
        try {
          await unlink(temporaryPath)
        } catch {
          // Le temporaire peut ne pas avoir été créé ou avoir déjà disparu.
        }
      }
    }

    document.sourceContent = document.overlayContent
    document.sourceHash = document.currentHash
    document.sourceBytes = byteLength(document.overlayContent)
    document.dirty = false
    document.version += 1
    return {
      path: document.path,
      hash: document.sourceHash,
      bytes: document.sourceBytes,
      version: document.version
    }
  }

  async applyAll(): Promise<WorkspaceApplyResult[]> {
    const dirtyDocuments = [...this.documents.values()].filter((document) => document.dirty)
    for (const document of dirtyDocuments) await this.assertSourceUnchanged(document)
    const results: WorkspaceApplyResult[] = []
    for (const document of dirtyDocuments) results.push(await this.applyFile(document.path, document.version))
    return results
  }
}

export async function createWorkspaceEditor(root: string, options: WorkspaceEditorOptions = {}): Promise<WorkspaceEditor> {
  return WorkspaceEditor.create(root, options)
}
