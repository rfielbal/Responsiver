import { constants as fsConstants } from 'node:fs'
import { access, lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null
}

export async function assertPrivateExportDirectory(destination: string, parent: string): Promise<string> {
  const metadata = await lstat(destination)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Le dossier d’export sécurisé a été remplacé ou n’est plus valide.')
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('Les permissions du dossier d’export ne sont plus privées.')
  }
  const [realDestination, realParent] = await Promise.all([realpath(destination), realpath(parent)])
  if (dirname(realDestination) !== realParent) {
    throw new Error('Le dossier d’export ne se trouve plus dans le dossier choisi.')
  }
  return realDestination
}

export async function reservePrivateExportDirectory(parent: string, baseName: string): Promise<string> {
  if (!baseName || baseName.length > 200 || baseName !== basename(baseName) || baseName === '.' || baseName === '..' || baseName.includes('\0')) {
    throw new Error('Le nom du dossier d’export est invalide.')
  }
  const realParent = await realpath(parent)
  const parentMetadata = await lstat(realParent)
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error('Le dossier parent choisi n’est pas un dossier local valide.')
  }
  await access(realParent, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)

  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const destination = join(realParent, suffix === 0 ? baseName : `${baseName}-${suffix + 1}`)
    try {
      await mkdir(destination, { recursive: false, mode: 0o700 })
      await assertPrivateExportDirectory(destination, realParent)
      return destination
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
  }
  throw new Error('Impossible de réserver un dossier d’export unique.')
}
