import { randomUUID } from 'node:crypto'
import { open, mkdir, readdir, lstat, chmod, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const MAX_PENDING_REQUESTS = 128

export class SpoolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SpoolError'
    this.code = code
  }
}

export function resolveInboxPath({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (env.RESPONSIVER_EXTENSION_INBOX) {
    if (!path.isAbsolute(env.RESPONSIVER_EXTENSION_INBOX)) {
      throw new SpoolError('UNSAFE_INBOX', 'Le dossier de test doit être un chemin absolu.')
    }
    return path.normalize(env.RESPONSIVER_EXTENSION_INBOX)
  }

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Responsiver', 'extension-inbox')
  }

  if (platform === 'win32') {
    const appData = env.APPDATA
    if (!appData || !path.win32.isAbsolute(appData)) {
      throw new SpoolError('MISSING_APP_DATA', 'Le dossier AppData de l’utilisateur est introuvable.')
    }
    return path.win32.join(appData, 'Responsiver', 'extension-inbox')
  }

  const configRoot = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(home, '.config')
  return path.join(configRoot, 'Responsiver', 'extension-inbox')
}

async function ensurePrivateDirectory(inboxPath) {
  if (!path.isAbsolute(inboxPath)) {
    throw new SpoolError('UNSAFE_INBOX', 'Le dossier de réception doit être absolu.')
  }

  await mkdir(inboxPath, { recursive: true, mode: 0o700 })
  const stats = await lstat(inboxPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SpoolError('UNSAFE_INBOX', 'Le dossier de réception n’est pas un répertoire sûr.')
  }

  if (process.platform !== 'win32') {
    await chmod(inboxPath, 0o700)
  }
}

function isPendingRequest(name) {
  return /^open-url-[0-9]{13}-[0-9a-f-]{36}\.json$/i.test(name)
}

export async function persistOpenUrlRequest(request, { inboxPath = resolveInboxPath(), now = Date.now } = {}) {
  await ensurePrivateDirectory(inboxPath)

  const entries = await readdir(inboxPath, { withFileTypes: true })
  const pendingCount = entries.filter((entry) => entry.isFile() && isPendingRequest(entry.name)).length
  if (pendingCount >= MAX_PENDING_REQUESTS) {
    throw new SpoolError('QUEUE_FULL', 'Trop de demandes sont déjà en attente dans Responsiver.')
  }

  const spoolId = randomUUID()
  const receivedAt = new Date(now()).toISOString()
  const timestamp = Date.parse(receivedAt)
  const finalName = `open-url-${timestamp}-${spoolId}.json`
  const temporaryName = `.open-url-${spoolId}.tmp`
  const finalPath = path.join(inboxPath, finalName)
  const temporaryPath = path.join(inboxPath, temporaryName)
  const record = {
    schemaVersion: 1,
    spoolId,
    receivedAt,
    request
  }

  let handle
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(record)}\n`, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, finalPath)
    if (process.platform !== 'win32') await chmod(finalPath, 0o600)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    if (error instanceof SpoolError) throw error
    throw new SpoolError('WRITE_FAILED', 'La demande ne peut pas être enregistrée localement.')
  }

  return { spoolId, receivedAt }
}
