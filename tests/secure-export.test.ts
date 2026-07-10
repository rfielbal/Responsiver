import assert from 'node:assert/strict'
import { access, chmod, lstat, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertPrivateExportDirectory, reservePrivateExportDirectory } from '../src/main/secure-export.ts'

test('la réservation d’export est atomique, privée et choisit un nom libre', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'responsiver-export-'))
  context.after(() => rm(parent, { recursive: true, force: true }))
  await mkdir(join(parent, 'site-responsiver-modifications'))

  const destination = await reservePrivateExportDirectory(parent, 'site-responsiver-modifications')
  assert.equal(destination, join(await realpath(parent), 'site-responsiver-modifications-2'))
  const metadata = await lstat(destination)
  assert.equal(metadata.isDirectory(), true)
  assert.equal(metadata.isSymbolicLink(), false)
  if (process.platform !== 'win32') assert.equal(metadata.mode & 0o777, 0o700)
})

test('un dossier réservé remplacé par un lien symbolique est refusé', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'responsiver-export-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'responsiver-export-outside-'))
  context.after(() => Promise.all([
    rm(parent, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]))
  const destination = await reservePrivateExportDirectory(parent, 'site-responsiver')
  await rm(destination, { recursive: true })
  await symlink(outside, destination, 'dir')

  await assert.rejects(
    assertPrivateExportDirectory(destination, parent),
    /remplacé|valide/
  )
})

test('un nom de dossier ne peut pas sortir du parent choisi', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'responsiver-export-name-'))
  const escaped = join(parent, '..', 'responsiver-export-escaped')
  context.after(() => Promise.all([
    rm(parent, { recursive: true, force: true }),
    rm(escaped, { recursive: true, force: true })
  ]))

  await assert.rejects(
    reservePrivateExportDirectory(parent, '../responsiver-export-escaped'),
    /nom.+invalide/i
  )
  await assert.rejects(access(escaped))
})

test('un dossier dont les permissions ont été élargies est refusé', { skip: process.platform === 'win32' }, async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'responsiver-export-mode-'))
  context.after(() => rm(parent, { recursive: true, force: true }))
  const destination = await reservePrivateExportDirectory(parent, 'site-responsiver')
  await chmod(destination, 0o755)

  await assert.rejects(
    assertPrivateExportDirectory(destination, parent),
    /permissions.+privées/i
  )
})
