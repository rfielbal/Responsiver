import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  WorkspaceEditorError,
  createWorkspaceEditor
} from '../src/main/workspace-editor.ts'

async function projectFixture(context: { after: (callback: () => Promise<unknown>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-workspace-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'const message = "avant"\n', 'utf8')
  return root
}

function hasCode(code: WorkspaceEditorError['code']): (error: unknown) => boolean {
  return (error) => error instanceof WorkspaceEditorError && error.code === code
}

test('liste seulement les sources pertinentes et masque secrets, builds et dépendances', async (context) => {
  const root = await projectFixture(context)
  await Promise.all([
    writeFile(join(root, '.env'), 'DATABASE_PASSWORD=secret\n'),
    writeFile(join(root, 'private.pem'), 'fausse clé'),
    writeFile(join(root, 'backup.sql'), 'SELECT 1;'),
    writeFile(join(root, 'logo.png'), Buffer.from([0, 1, 2, 3])),
    mkdir(join(root, 'node_modules'), { recursive: true }),
    mkdir(join(root, 'build'), { recursive: true }),
    mkdir(join(root, '.hidden'), { recursive: true })
  ])
  await Promise.all([
    writeFile(join(root, 'node_modules', 'package.js'), 'non'),
    writeFile(join(root, 'build', 'bundle.js'), 'non'),
    writeFile(join(root, '.hidden', 'file.ts'), 'non')
  ])

  const editor = await createWorkspaceEditor(root)
  const files = await editor.listFiles()
  assert.deepEqual(files.map((file) => file.path), ['src/app.ts'])
  await assert.rejects(editor.readFile('.env'), hasCode('FORBIDDEN_PATH'))
  await assert.rejects(editor.readFile('private.pem'), hasCode('FORBIDDEN_PATH'))
  await assert.rejects(editor.readFile('backup.sql'), hasCode('FORBIDDEN_PATH'))
})

test('refuse traversée de répertoires, chemins absolus et liens symboliques', async (context) => {
  const root = await projectFixture(context)
  const outside = await mkdtemp(join(tmpdir(), 'responsiver-workspace-outside-'))
  context.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'outside.ts'), 'secret hors racine')
  await symlink(join(outside, 'outside.ts'), join(root, 'linked.ts'), 'file')

  const editor = await createWorkspaceEditor(root)
  await assert.rejects(editor.readFile('../outside.ts'), hasCode('INVALID_PATH'))
  await assert.rejects(editor.readFile(join(outside, 'outside.ts')), hasCode('INVALID_PATH'))
  await assert.rejects(editor.readFile('linked.ts'), hasCode('SYMLINK_REFUSED'))
  assert.equal((await editor.listFiles()).some((file) => file.path === 'linked.ts'), false)
})

test('refuse un contenu binaire même si son extension ressemble à une source', async (context) => {
  const root = await projectFixture(context)
  await writeFile(join(root, 'src', 'binary.ts'), Buffer.from([0x41, 0x00, 0x42]))
  const editor = await createWorkspaceEditor(root)
  await assert.rejects(editor.readFile('src/binary.ts'), hasCode('BINARY_FILE'))
})

test('conserve les changements en mémoire, produit un diff et applique explicitement', async (context) => {
  const root = await projectFixture(context)
  const sourcePath = join(root, 'src', 'app.ts')
  const editor = await createWorkspaceEditor(root)
  const initial = await editor.readFile('src/app.ts')
  const changed = await editor.applyEdits('src/app.ts', [{ start: 17, end: 22, text: 'après' }], initial.version)

  assert.equal(changed.content, 'const message = "après"\n')
  assert.equal(changed.dirty, true)
  assert.equal(await readFile(sourcePath, 'utf8'), 'const message = "avant"\n', 'aucune écriture ne précède applyFile')
  const diff = await editor.getDiff('src/app.ts')
  assert.match(diff.text, /-const message = "avant"/)
  assert.match(diff.text, /\+const message = "après"/)
  assert.equal(diff.additions, 1)
  assert.equal(diff.deletions, 1)

  const snapshot = editor.getSnapshot()
  assert.equal(snapshot.dirtyCount, 1)
  assert.equal('content' in snapshot.documents[0], false, 'le snapshot ne transporte pas le contenu source')

  const applied = await editor.applyFile('src/app.ts', changed.version)
  assert.equal(await readFile(sourcePath, 'utf8'), 'const message = "après"\n')
  assert.equal(editor.getSnapshot().dirtyCount, 0)
  assert.equal(applied.hash.length, 64)
})

test('détecte les versions périmées et les modifications externes sans écraser la source', async (context) => {
  const root = await projectFixture(context)
  const sourcePath = join(root, 'src', 'app.ts')
  const editor = await createWorkspaceEditor(root)
  const initial = await editor.readFile('src/app.ts')
  const changed = await editor.replaceFile('src/app.ts', 'const message = "overlay"\n', initial.version)

  await assert.rejects(
    editor.replaceFile('src/app.ts', 'const message = "périmé"\n', initial.version),
    hasCode('VERSION_CONFLICT')
  )
  await writeFile(sourcePath, 'const message = "externe"\n', 'utf8')
  await assert.rejects(editor.applyFile('src/app.ts', changed.version), hasCode('SOURCE_CONFLICT'))
  assert.equal(await readFile(sourcePath, 'utf8'), 'const message = "externe"\n')
  assert.equal(editor.getSnapshot().dirtyCount, 1)
})

test('discard restaure uniquement la copie en mémoire', async (context) => {
  const root = await projectFixture(context)
  const editor = await createWorkspaceEditor(root)
  const initial = await editor.readFile('src/app.ts')
  const changed = await editor.replaceFile('src/app.ts', 'autre\n', initial.version)
  const discarded = await editor.discard('src/app.ts', changed.version)
  assert.equal(discarded.content, initial.content)
  assert.equal(discarded.dirty, false)
  assert.equal(editor.getSnapshot().dirtyCount, 0)
})
