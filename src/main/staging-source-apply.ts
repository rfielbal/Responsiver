import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { mkdir, lstat, open, realpath, rename, rmdir, unlink, type FileHandle } from 'node:fs/promises'
import type { StagingApplyResult, StagingUndoResult } from '../shared/contracts'
import type { ProjectStaging } from './project-transformer'

const NEW_FILE_HASH = 'nouveau-fichier'
const MAX_CHANGED_FILES = 500
const MAX_STAGING_BYTES = 64 * 1024 * 1024

interface PreparedChange {
  path: string
  target: string
  applied: Buffer
  appliedHash: string
  appliedMode: number
  original: Buffer | null
  originalHash: string | null
  originalMode: number | null
}

export interface StagingSourceUndoSnapshot {
  root: string
  changes: PreparedChange[]
  createdDirectories: string[]
}

export interface StagingSourceApplyOperation {
  result: StagingApplyResult
  undo: StagingSourceUndoSnapshot
}

interface CurrentFile {
  content: Buffer
  hash: string
  mode: number
}

interface TemporaryFile {
  change: PreparedChange
  path: string
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

function normalizedRelativePath(value: string): string {
  if (!value || value.length > 4_096 || value.includes('\0') || value.includes('\\') || isAbsolute(value) || value.startsWith('/')) {
    throw new Error(`Chemin de staging invalide : ${value}`)
  }
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Chemin de staging invalide : ${value}`)
  return parts.join('/')
}

function isWithinRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== '' && !child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child)
}

async function safeTarget(root: string, path: string): Promise<{ target: string; exists: boolean }> {
  const normalized = normalizedRelativePath(path)
  const target = resolve(root, ...normalized.split('/'))
  if (!isWithinRoot(root, target)) throw new Error(`Chemin hors projet refusé : ${path}`)

  const segments = normalized.split('/')
  let cursor = root
  for (let index = 0; index < segments.length; index += 1) {
    cursor = join(cursor, segments[index])
    let metadata
    try {
      metadata = await lstat(cursor)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { target, exists: false }
      throw error
    }
    if (metadata.isSymbolicLink()) throw new Error(`Lien symbolique refusé dans le chemin : ${path}`)
    if (index < segments.length - 1 && !metadata.isDirectory()) throw new Error(`Un parent de ${path} n’est pas un dossier.`)
    if (index === segments.length - 1 && !metadata.isFile()) throw new Error(`La cible ${path} n’est pas un fichier ordinaire.`)
  }
  return { target, exists: true }
}

async function readCurrentFile(root: string, path: string): Promise<CurrentFile | null> {
  const checked = await safeTarget(root, path)
  if (!checked.exists) return null
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
  let handle: FileHandle | null = null
  try {
    handle = await open(checked.target, fsConstants.O_RDONLY | noFollow)
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error(`La cible ${path} n’est plus un fichier ordinaire.`)
    const content = await handle.readFile()
    return { content, hash: digest(content), mode: metadata.mode & 0o777 }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function ensureSafeParentDirectories(root: string, path: string): Promise<string[]> {
  const parentSegments = normalizedRelativePath(path).split('/').slice(0, -1)
  let cursor = root
  const created: string[] = []
  for (const segment of parentSegments) {
    cursor = join(cursor, segment)
    try {
      await mkdir(cursor, { mode: 0o755 })
      created.push(relative(root, cursor).split(sep).join('/'))
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const metadata = await lstat(cursor)
    if (metadata.isSymbolicLink()) throw new Error(`Lien symbolique refusé dans le chemin : ${path}`)
    if (!metadata.isDirectory()) throw new Error(`Un parent de ${path} n’est pas un dossier.`)
  }
  return created
}

async function writeTemporary(root: string, change: PreparedChange, content: Buffer, mode: number, createdDirectories?: Set<string>): Promise<string> {
  // Créer chaque parent séparément évite qu’un mkdir récursif suive en silence
  // un lien symbolique apparu dans un segment encore absent.
  for (const directory of await ensureSafeParentDirectories(root, change.path)) createdDirectories?.add(directory)
  // Un dossier peut avoir été remplacé concurremment : revalider tous les
  // segments avant d’ouvrir le temporaire dans le dossier de la cible.
  await safeTarget(root, change.path)
  const temporaryPath = join(dirname(change.target), `.responsiver-${randomUUID()}.tmp`)
  let handle: FileHandle | null = null
  try {
    handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, mode)
    await handle.writeFile(content)
    await handle.sync()
    if (process.platform !== 'win32') await handle.chmod(mode)
    await handle.close()
    handle = null
    return temporaryPath
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function atomicReplace(root: string, change: PreparedChange, content: Buffer, mode: number): Promise<void> {
  const temporaryPath = await writeTemporary(root, change, content, mode)
  let renamed = false
  try {
    await rename(temporaryPath, change.target)
    renamed = true
  } finally {
    if (!renamed) await unlink(temporaryPath).catch(() => undefined)
  }
}

async function assertOriginalUnchanged(root: string, change: PreparedChange): Promise<void> {
  const current = await readCurrentFile(root, change.path)
  if (change.original === null) {
    if (current !== null) throw new Error(`Conflit source : ${change.path} a été créé depuis la préparation des corrections.`)
    return
  }
  if (!current || current.hash !== change.originalHash) {
    throw new Error(`Conflit source : ${change.path} a changé depuis la préparation des corrections.`)
  }
}

async function assertAppliedUnchanged(root: string, change: PreparedChange): Promise<void> {
  const current = await readCurrentFile(root, change.path)
  if (!current || current.hash !== change.appliedHash) {
    throw new Error(`Annulation refusée : ${change.path} a changé depuis l’application des corrections.`)
  }
}

async function prepareChanges(root: string, staging: ProjectStaging): Promise<PreparedChange[]> {
  const hashes = staging.snapshot.sourceHashes
  if (!hashes) throw new Error('Le staging ne contient pas les empreintes nécessaires à une application sûre.')
  const entries = [...staging.overrides.entries()].sort(([left], [right]) => left.localeCompare(right, 'fr'))
  if (entries.length === 0) throw new Error('Le staging ne contient aucun fichier modifié à appliquer.')
  if (entries.length > MAX_CHANGED_FILES) throw new Error(`Le staging dépasse la limite de ${MAX_CHANGED_FILES} fichiers modifiés.`)
  const normalizedPaths = entries.map(([path]) => normalizedRelativePath(path))
  if (new Set(normalizedPaths).size !== normalizedPaths.length) throw new Error('Le staging contient plusieurs écritures vers le même fichier.')
  const hashPaths = Object.keys(hashes).sort((left, right) => left.localeCompare(right, 'fr'))
  if (hashPaths.length !== normalizedPaths.length || hashPaths.some((path, index) => path !== normalizedPaths[index])) {
    throw new Error('Les empreintes du staging ne correspondent pas exactement aux fichiers modifiés.')
  }

  let totalBytes = 0
  const changes: PreparedChange[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const [rawPath, body] = entries[index]
    const path = normalizedPaths[index]
    if (!Buffer.isBuffer(body)) throw new Error(`Le contenu préparé pour ${path} est invalide.`)
    totalBytes += body.length
    if (totalBytes > MAX_STAGING_BYTES) throw new Error('Le staging dépasse le budget mémoire autorisé.')
    const expectedHash = hashes[rawPath]
    if (expectedHash !== NEW_FILE_HASH && !/^[a-f\d]{64}$/u.test(expectedHash ?? '')) {
      throw new Error(`Empreinte source invalide pour ${path}.`)
    }
    const checked = await safeTarget(root, path)
    const current = await readCurrentFile(root, path)
    if (expectedHash === NEW_FILE_HASH) {
      if (current !== null) throw new Error(`Conflit source : ${path} existe déjà.`)
    } else if (!current || current.hash !== expectedHash) {
      throw new Error(`Conflit source : ${path} a changé depuis la construction du staging.`)
    }
    const applied = Buffer.from(body)
    changes.push({
      path,
      target: checked.target,
      applied,
      appliedHash: digest(applied),
      appliedMode: current?.mode ?? 0o644,
      original: current ? Buffer.from(current.content) : null,
      originalHash: current?.hash ?? null,
      originalMode: current?.mode ?? null
    })
  }
  return changes
}

async function cleanupTemporaries(temporaries: TemporaryFile[]): Promise<void> {
  await Promise.all(temporaries.map((temporary) => unlink(temporary.path).catch(() => undefined)))
}

async function cleanupCreatedDirectories(root: string, directories: Iterable<string>): Promise<void> {
  const ordered = [...new Set(directories)]
    .sort((left, right) => right.split('/').length - left.split('/').length || right.localeCompare(left, 'fr'))
  for (const directory of ordered) {
    const normalized = normalizedRelativePath(directory)
    const target = resolve(root, ...normalized.split('/'))
    if (!isWithinRoot(root, target)) continue
    try {
      const metadata = await lstat(target)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue
      await rmdir(target)
    } catch {
      // Le contenu restauré prime sur le nettoyage cosmétique d’un dossier
      // désormais vide. Une permission concurrente ne doit pas invalider l’undo.
    }
  }
}

async function rollbackAppliedChanges(root: string, committed: PreparedChange[]): Promise<string[]> {
  const failures: string[] = []
  for (const change of [...committed].reverse()) {
    try {
      await assertAppliedUnchanged(root, change)
      if (change.original === null) await unlink(change.target)
      else await atomicReplace(root, change, change.original, change.originalMode ?? 0o644)
    } catch {
      failures.push(change.path)
    }
  }
  return failures
}

export async function applyProjectStagingToSource(rootValue: string, staging: ProjectStaging): Promise<StagingSourceApplyOperation> {
  const conflicts = staging.snapshot.outcomes?.filter((outcome) => outcome.status === 'conflict') ?? []
  if (conflicts.length) {
    throw new Error(`${conflicts.length} proposition${conflicts.length > 1 ? 's entrent' : ' entre'} en conflit. Retirez-en une avant d’appliquer les corrections.`)
  }
  const root = await realpath(rootValue)
  const changes = await prepareChanges(root, staging)
  const temporaries: TemporaryFile[] = []
  const committed: PreparedChange[] = []
  const createdDirectories = new Set<string>()
  try {
    for (const change of changes) {
      temporaries.push({ change, path: await writeTemporary(root, change, change.applied, change.appliedMode, createdDirectories) })
    }
    // Second préflight, effectué après la préparation de tous les temporaires
    // mais avant la première substitution visible.
    for (const change of changes) await assertOriginalUnchanged(root, change)
    for (const temporary of temporaries) {
      await rename(temporary.path, temporary.change.target)
      committed.push(temporary.change)
    }
  } catch (error) {
    const rollbackFailures = await rollbackAppliedChanges(root, committed)
    await cleanupTemporaries(temporaries)
    await cleanupCreatedDirectories(root, createdDirectories)
    if (rollbackFailures.length) {
      throw new Error(`L’application a échoué et ${rollbackFailures.join(', ')} n’a pas pu être restauré automatiquement.`)
    }
    throw error
  }

  const appliedAt = new Date().toISOString()
  const paths = changes.map((change) => change.path)
  return {
    result: { paths, appliedAt, undoAvailable: true },
    undo: { root, changes, createdDirectories: [...createdDirectories] }
  }
}

async function rollbackUndoChanges(root: string, committed: PreparedChange[]): Promise<string[]> {
  const failures: string[] = []
  for (const change of [...committed].reverse()) {
    try {
      await atomicReplace(root, change, change.applied, change.appliedMode)
    } catch {
      failures.push(change.path)
    }
  }
  return failures
}

export async function undoProjectStagingSource(snapshot: StagingSourceUndoSnapshot): Promise<StagingUndoResult> {
  const root = await realpath(snapshot.root)
  if (root !== snapshot.root) throw new Error('La racine du projet a changé depuis l’application des corrections.')
  if (!snapshot.changes.length) throw new Error('Aucune application de staging ne peut être annulée.')
  for (const change of snapshot.changes) await assertAppliedUnchanged(root, change)

  const temporaries: TemporaryFile[] = []
  const committed: PreparedChange[] = []
  try {
    for (const change of snapshot.changes) {
      if (change.original !== null) {
        temporaries.push({ change, path: await writeTemporary(root, change, change.original, change.originalMode ?? 0o644) })
      }
    }
    // L’utilisateur peut encore modifier un fichier pendant la préparation des
    // temporaires : aucune annulation ne commence sans cette seconde vérification.
    for (const change of snapshot.changes) await assertAppliedUnchanged(root, change)
    const temporaryByPath = new Map(temporaries.map((temporary) => [temporary.change.path, temporary.path]))
    for (const change of snapshot.changes) {
      const temporaryPath = temporaryByPath.get(change.path)
      if (temporaryPath) await rename(temporaryPath, change.target)
      else await unlink(change.target)
      committed.push(change)
    }
  } catch (error) {
    const rollbackFailures = await rollbackUndoChanges(root, committed)
    await cleanupTemporaries(temporaries)
    if (rollbackFailures.length) {
      throw new Error(`L’annulation a échoué et ${rollbackFailures.join(', ')} n’a pas pu être réappliqué automatiquement.`)
    }
    throw error
  }

  await cleanupCreatedDirectories(root, snapshot.createdDirectories)

  return {
    paths: snapshot.changes.map((change) => change.path),
    undoneAt: new Date().toISOString()
  }
}
