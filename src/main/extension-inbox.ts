import { constants as fsConstants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

const maxRequestBytes = 64 * 1024
const maxPendingAgeMs = 10 * 60 * 1_000
const maxBatchSize = 16
const pendingPattern = /^open-url-([0-9]{13})-([0-9a-f-]{36})\.json$/i
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ExtensionOpenUrlRequest {
  requestId: string
  sentAt: string
  url: string
  title: string
  viewport: { width: number; height: number; devicePixelRatio: number }
}

export interface ExtensionInboxOptions {
  now?: () => number
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null
}

function validateRecord(value: unknown, now: number): ExtensionOpenUrlRequest {
  const envelope = record(value)
  if (!envelope || !exactKeys(envelope, ['schemaVersion', 'spoolId', 'receivedAt', 'request']) || envelope.schemaVersion !== 1 || typeof envelope.spoolId !== 'string' || !uuidPattern.test(envelope.spoolId)) {
    throw new Error('Enveloppe extension invalide.')
  }
  const receivedAt = typeof envelope.receivedAt === 'string' ? Date.parse(envelope.receivedAt) : Number.NaN
  if (!Number.isFinite(receivedAt) || Math.abs(now - receivedAt) > maxPendingAgeMs) throw new Error('Demande extension expirée.')
  const request = record(envelope.request)
  if (!request || !exactKeys(request, ['version', 'type', 'requestId', 'sentAt', 'source', 'payload']) || request.version !== 1 || request.type !== 'open-url' || request.source !== 'chrome-extension' || typeof request.requestId !== 'string' || !uuidPattern.test(request.requestId)) {
    throw new Error('Requête extension invalide.')
  }
  const sentAt = typeof request.sentAt === 'string' ? Date.parse(request.sentAt) : Number.NaN
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > maxPendingAgeMs) throw new Error('Requête extension expirée.')
  const payload = record(request.payload)
  if (!payload || !exactKeys(payload, ['url', 'title', 'viewport', 'devicePixelRatio']) || typeof payload.url !== 'string' || payload.url.length > 8_192 || typeof payload.title !== 'string' || payload.title.length > 256 || typeof payload.devicePixelRatio !== 'number' || !Number.isFinite(payload.devicePixelRatio) || payload.devicePixelRatio < 0.5 || payload.devicePixelRatio > 8) {
    throw new Error('Contenu extension invalide.')
  }
  let url: URL
  try { url = new URL(payload.url) } catch { throw new Error('URL extension invalide.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL extension refusée.')
  const viewport = record(payload.viewport)
  const width = viewport ? boundedInteger(viewport.width, 1, 16_384) : null
  const height = viewport ? boundedInteger(viewport.height, 1, 16_384) : null
  if (!viewport || !exactKeys(viewport, ['width', 'height']) || width === null || height === null) throw new Error('Viewport extension invalide.')
  return {
    requestId: request.requestId,
    sentAt: new Date(sentAt).toISOString(),
    url: url.href,
    title: payload.title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(),
    viewport: { width, height, devicePixelRatio: Math.round(payload.devicePixelRatio * 100) / 100 }
  }
}

export function resolveExtensionInbox(userDataPath: string, override = process.env.RESPONSIVER_EXTENSION_INBOX): string {
  if (override) {
    if (!isAbsolute(override) || override.includes('\0')) throw new Error('Le dossier extension configuré est invalide.')
    return normalize(override)
  }
  return join(userDataPath, 'extension-inbox')
}

async function ensurePrivateInbox(inbox: string): Promise<void> {
  await mkdir(inbox, { recursive: true, mode: 0o700 })
  const metadata = await lstat(inbox)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Le dossier extension n’est pas sûr.')
  if (process.platform !== 'win32') await chmod(inbox, 0o700)
}

async function readClaimedFile(path: string): Promise<unknown> {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const handle = await open(path, fsConstants.O_RDONLY | noFollow)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxRequestBytes) throw new Error('Fichier extension invalide.')
    const body = await handle.readFile({ encoding: 'utf8' })
    return JSON.parse(body)
  } finally {
    await handle.close()
  }
}

export async function consumeExtensionInbox(
  inboxPath: string,
  consume: (request: ExtensionOpenUrlRequest) => Promise<void>,
  options: ExtensionInboxOptions = {}
): Promise<number> {
  const now = options.now?.() ?? Date.now()
  await ensurePrivateInbox(inboxPath)
  const entries = await readdir(inboxPath, { withFileTypes: true })
  const pending = entries
    .filter((entry) => pendingPattern.test(entry.name))
    .map((entry) => ({ name: entry.name, timestamp: Number(entry.name.match(pendingPattern)?.[1] ?? 0) }))
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, maxBatchSize)
  let consumed = 0
  for (const entry of pending) {
    const source = join(inboxPath, entry.name)
    const claimed = join(inboxPath, `.claim-${entry.name.slice('open-url-'.length)}`)
    try {
      const sourceMetadata = await lstat(source)
      if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.size > maxRequestBytes) {
        await unlink(source).catch(() => undefined)
        continue
      }
      await rename(source, claimed)
      const request = validateRecord(await readClaimedFile(claimed), now)
      await consume(request)
      consumed += 1
    } catch {
      // Une demande invalide, expirée ou impossible à ouvrir est supprimée sans
      // conserver son URL dans une quarantaine ou un journal.
    } finally {
      await unlink(claimed).catch(() => undefined)
    }
  }
  return consumed
}

export function startExtensionInboxWatcher(
  inboxPath: string,
  consume: (request: ExtensionOpenUrlRequest) => Promise<void>,
  intervalMs = 1_500
): { poll: () => Promise<number>; close: () => void } {
  let running = false
  let closed = false
  const poll = async (): Promise<number> => {
    if (running || closed) return 0
    running = true
    try { return await consumeExtensionInbox(inboxPath, consume) } finally { running = false }
  }
  const timer = setInterval(() => { void poll() }, Math.max(500, intervalMs))
  timer.unref()
  return { poll, close: () => { closed = true; clearInterval(timer) } }
}
