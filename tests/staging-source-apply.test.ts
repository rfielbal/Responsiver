import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ProjectStaging } from '../src/main/project-transformer.ts'
import { applyProjectStagingToSource, undoProjectStagingSource } from '../src/main/staging-source-apply.ts'

function digest(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function staging(overrides: Record<string, string>, originals: Record<string, string | null>): ProjectStaging {
  const changedFiles = Object.keys(overrides).sort((left, right) => left.localeCompare(right, 'fr'))
  return {
    overrides: new Map(changedFiles.map((path) => [path, Buffer.from(overrides[path], 'utf8')])),
    snapshot: {
      previewOrigin: null,
      changes: [],
      patch: '',
      generatedCss: '',
      themeTarget: null,
      instructions: [],
      changedFiles,
      sourceHashes: Object.fromEntries(changedFiles.map((path) => [path, originals[path] === null ? 'nouveau-fichier' : digest(originals[path])])),
      createdAt: '2026-07-11T08:00:00.000Z'
    }
  }
}

async function fixture(context: { after: (callback: () => Promise<unknown>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-staging-apply-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'styles'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<main>Avant</main>\n')
  await writeFile(join(root, 'styles', 'site.css'), 'main { width: 900px; }\n')
  return root
}

test('applique atomiquement les fichiers existants et nouveaux puis restaure exactement les originaux', async (context) => {
  const root = await fixture(context)
  if (process.platform !== 'win32') await chmod(join(root, 'index.html'), 0o640)
  const prepared = staging({
    'index.html': '<main>Après</main>\n',
    '.responsiver/responsiver.generated.css': 'main { max-width: 100%; }\n'
  }, {
    'index.html': '<main>Avant</main>\n',
    '.responsiver/responsiver.generated.css': null
  })

  const applied = await applyProjectStagingToSource(root, prepared)
  assert.deepEqual(applied.result.paths, ['.responsiver/responsiver.generated.css', 'index.html'])
  assert.equal(applied.result.undoAvailable, true)
  assert.equal(new Date(applied.result.appliedAt).toISOString(), applied.result.appliedAt)
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), '<main>Après</main>\n')
  assert.equal(await readFile(join(root, '.responsiver', 'responsiver.generated.css'), 'utf8'), 'main { max-width: 100%; }\n')
  if (process.platform !== 'win32') assert.equal((await stat(join(root, 'index.html'))).mode & 0o777, 0o640)

  const undone = await undoProjectStagingSource(applied.undo)
  assert.deepEqual(undone.paths, applied.result.paths)
  assert.equal(new Date(undone.undoneAt).toISOString(), undone.undoneAt)
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), '<main>Avant</main>\n')
  await assert.rejects(lstat(join(root, '.responsiver', 'responsiver.generated.css')), /ENOENT/)
  await assert.rejects(lstat(join(root, '.responsiver')), /ENOENT/)
  if (process.platform !== 'win32') assert.equal((await stat(join(root, 'index.html'))).mode & 0o777, 0o640)
})

test('un conflit détecté au préflight empêche toute écriture, même sur les fichiers valides', async (context) => {
  const root = await fixture(context)
  const prepared = staging({
    'index.html': '<main>Après</main>\n',
    'styles/site.css': 'main { max-width: 100%; }\n'
  }, {
    'index.html': '<main>Avant</main>\n',
    'styles/site.css': 'main { width: 900px; }\n'
  })
  await writeFile(join(root, 'styles', 'site.css'), '/* modification externe */\n')

  await assert.rejects(applyProjectStagingToSource(root, prepared), /Conflit source.*styles\/site\.css/)
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), '<main>Avant</main>\n')
  assert.equal(await readFile(join(root, 'styles', 'site.css'), 'utf8'), '/* modification externe */\n')
})

test('un conflit entre propositions bloque l’application avant toute écriture', async (context) => {
  const root = await fixture(context)
  const prepared = staging({ 'index.html': '<main>Après</main>\n' }, { 'index.html': '<main>Avant</main>\n' })
  prepared.snapshot.outcomes = [{
    proposalId: 'fix-b', findingIds: ['finding-b'], kind: 'issue', status: 'conflict', changeIds: [],
    reason: 'Deux valeurs ciblent la même déclaration.'
  }]

  await assert.rejects(applyProjectStagingToSource(root, prepared), /proposition entre en conflit/i)
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), '<main>Avant</main>\n')
})

test('les traversées et liens symboliques sont refusés avant toute modification', async (context) => {
  const root = await fixture(context)
  const outside = await mkdtemp(join(tmpdir(), 'responsiver-staging-outside-'))
  context.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'outside.css'), 'secret\n')
  await symlink(join(outside, 'outside.css'), join(root, 'linked.css'))

  const linked = staging({ 'linked.css': 'écrasé\n' }, { 'linked.css': 'secret\n' })
  await assert.rejects(applyProjectStagingToSource(root, linked), /Lien symbolique refusé/)
  assert.equal(await readFile(join(outside, 'outside.css'), 'utf8'), 'secret\n')

  const traversal = staging({ '../outside.css': 'écrasé\n' }, { '../outside.css': null })
  await assert.rejects(applyProjectStagingToSource(root, traversal), /Chemin de staging invalide/)
})

test('l’annulation refuse tous les fichiers si un contenu appliqué a ensuite changé', async (context) => {
  const root = await fixture(context)
  const prepared = staging({
    'index.html': '<main>Après</main>\n',
    'styles/site.css': 'main { max-width: 100%; }\n'
  }, {
    'index.html': '<main>Avant</main>\n',
    'styles/site.css': 'main { width: 900px; }\n'
  })
  const applied = await applyProjectStagingToSource(root, prepared)
  await writeFile(join(root, 'styles', 'site.css'), '/* changement après application */\n')

  await assert.rejects(undoProjectStagingSource(applied.undo), /Annulation refusée.*styles\/site\.css/)
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), '<main>Après</main>\n')
  assert.equal(await readFile(join(root, 'styles', 'site.css'), 'utf8'), '/* changement après application */\n')
})
