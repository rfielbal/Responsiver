import assert from 'node:assert/strict'
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ProjectSnapshot } from '../src/shared/contracts.ts'
import {
  RecentProjectsStore,
  recentProjectId
} from '../src/main/recent-projects.ts'

function projectSnapshot(root: string, name: string, entryPath = '/index.html', issueMarker = name): ProjectSnapshot {
  return {
    id: `project-${name}`,
    name,
    root,
    kind: 'Projet web local',
    files: 3,
    analyzedAt: '2026-07-10T08:00:00.000Z',
    issues: [{
      id: `issue-${name}`,
      title: 'Constat de test',
      description: `DESCRIPTION_SOURCE_${issueMarker}`,
      severity: 'attention',
      coverage: 'heuristique',
      viewport: '320–640 px',
      routePath: entryPath,
      rule: 'css.test',
      proposal: `PROPOSITION_SOURCE_${issueMarker}`
    }],
    previewHtml: `<html>SOURCE_HTML_${issueMarker}</html>`,
    previewOrigin: 'http://127.0.0.1:45678',
    previewBasePath: '/',
    previewReadiness: {
      status: 'ready',
      strategy: 'static',
      summary: 'Prêt',
      diagnostics: []
    },
    entryPath,
    routes: [{ path: entryPath, label: 'Accueil' }],
    theme: {
      detected: 'light',
      hasDark: false,
      hasLight: true,
      evidence: ['SOURCE_THEME_SECRET'],
      variables: []
    },
    capabilities: {
      interactive: true,
      staging: true,
      framework: null,
      packageManager: null,
      buildRequired: false,
      previewStrategy: 'static'
    },
    analysis: { truncated: false, scannedFiles: 3, scannedStyles: 1 }
  }
}

async function createFixture(prefix: string): Promise<{ root: string; historyPath: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const state = join(root, 'state')
  return { root, historyPath: join(state, 'recent-projects.v1.json') }
}

test('le store conserve l’actif et cinq anciens en MRU sans dupliquer un projet', async (context) => {
  const fixture = await createFixture('responsiver-recents-mru-')
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  let clock = Date.parse('2026-07-10T08:10:00.000Z')
  const store = new RecentProjectsStore(fixture.historyPath, {
    now: () => new Date(clock += 1_000)
  })
  const projects: ProjectSnapshot[] = []

  for (let index = 1; index <= 7; index += 1) {
    const root = join(fixture.root, `projet-${index}`)
    await mkdir(root)
    await writeFile(join(root, 'index.html'), `<!doctype html><title>Projet ${index}</title>`)
    const snapshot = projectSnapshot(root, `Projet ${index}`)
    projects.push(snapshot)
    await store.upsert(root, snapshot)
  }

  const regularList = await store.list()
  assert.deepEqual(regularList.map((project) => project.name), ['Projet 7', 'Projet 6', 'Projet 5', 'Projet 4', 'Projet 3'])
  assert.ok(regularList.every((project) => project.availability === 'available' && !project.isActive))

  const oldestRetainedId = recentProjectId(projects[1].root, projects[1].entryPath)
  const library = await store.list(oldestRetainedId)
  assert.equal(library.length, 6)
  assert.equal(library[0].name, 'Projet 2')
  assert.equal(library[0].isActive, true)
  assert.deepEqual(library.slice(1).map((project) => project.name), ['Projet 7', 'Projet 6', 'Projet 5', 'Projet 4', 'Projet 3'])
  assert.equal(await store.get(recentProjectId(projects[0].root, projects[0].entryPath)), null)

  const refreshed = { ...projects[4], files: 9 }
  await store.upsert(refreshed.root, refreshed)
  const refreshedList = await store.list()
  assert.equal(refreshedList[0].name, 'Projet 5')
  assert.equal(refreshedList[0].files, 9)
  assert.equal(new Set(refreshedList.map((project) => project.id)).size, refreshedList.length)

  const document = JSON.parse(await readFile(fixture.historyPath, 'utf8')) as { version: number; entries: Array<Record<string, unknown>> }
  assert.equal(document.version, 1)
  assert.equal(document.entries.length, 6)
  assert.ok(document.entries.every((entry) => typeof entry.issues === 'number'))
  const serialized = JSON.stringify(document)
  for (const forbidden of ['SOURCE_HTML_', 'DESCRIPTION_SOURCE_', 'PROPOSITION_SOURCE_', 'SOURCE_THEME_SECRET', 'previewHtml', 'previewOrigin', 'patch', 'generatedCss']) {
    assert.equal(serialized.includes(forbidden), false, `Le cache ne doit pas contenir ${forbidden}.`)
  }
  const restoredStore = new RecentProjectsStore(fixture.historyPath)
  assert.deepEqual((await restoredStore.list()).map((project) => project.name), ['Projet 5', 'Projet 7', 'Projet 6', 'Projet 4', 'Projet 3'])

  if (process.platform !== 'win32') {
    assert.equal((await lstat(join(fixture.root, 'state'))).mode & 0o777, 0o700)
    assert.equal((await lstat(fixture.historyPath)).mode & 0o777, 0o600)
  }
})

test('l’identité dépend de la racine et de la page d’entrée', async (context) => {
  const fixture = await createFixture('responsiver-recents-entry-')
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  await mkdir(join(fixture.root, 'project'))
  const root = join(fixture.root, 'project')
  const store = new RecentProjectsStore(fixture.historyPath)
  const home = projectSnapshot(root, 'Accueil', '/index.html')
  const landing = projectSnapshot(root, 'Landing', '/landing.html')

  assert.notEqual(recentProjectId(root, home.entryPath), recentProjectId(root, landing.entryPath))
  await store.upsert(join(root, 'index.html'), home)
  await store.upsert(join(root, 'landing.html'), landing)

  const projects = await store.list()
  assert.deepEqual(projects.map((project) => project.entryPath), ['/landing.html', '/index.html'])
})

test('une même sélection remplace son ancienne entrée quand l’entrée détectée change', async (context) => {
  const fixture = await createFixture('responsiver-recents-selection-')
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const root = join(fixture.root, 'project')
  await mkdir(root)
  const store = new RecentProjectsStore(fixture.historyPath)

  await store.upsert(root, projectSnapshot(root, 'Sources', '/index.html'))
  await store.upsert(root, projectSnapshot(root, 'Artefact compilé', '/dist/index.html'))

  const projects = await store.list()
  assert.equal(projects.length, 1)
  assert.equal(projects[0].name, 'Artefact compilé')
  assert.equal(projects[0].selectionPath, root)
  assert.equal(projects[0].entryPath, '/dist/index.html')
})

test('la corruption, un schéma inconnu et un fichier surdimensionné restent sans effet', async (context) => {
  const fixture = await createFixture('responsiver-recents-corrupt-')
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  await mkdir(join(fixture.root, 'state'), { recursive: true })
  const store = new RecentProjectsStore(fixture.historyPath, { maxBytes: 1_024 })

  await writeFile(fixture.historyPath, '{ ceci n’est pas du JSON')
  assert.deepEqual(await store.list(), [])

  await writeFile(fixture.historyPath, JSON.stringify({ version: 99, entries: [] }))
  assert.deepEqual(await store.list(), [])

  await writeFile(fixture.historyPath, JSON.stringify({ version: 1, entries: [], cacheSource: '<html>interdit</html>' }))
  assert.deepEqual(await store.list(), [])

  await writeFile(fixture.historyPath, Buffer.alloc(1_025, 0x20))
  assert.deepEqual(await store.list(), [])

  const root = join(fixture.root, 'project')
  await mkdir(root)
  await store.upsert(root, projectSnapshot(root, 'Projet restauré'))
  assert.deepEqual((await store.list()).map((project) => project.name), ['Projet restauré'])
})

test('le listage conserve les chemins disparus et distingue les formats non pris en charge', async (context) => {
  const fixture = await createFixture('responsiver-recents-status-')
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const availableRoot = join(fixture.root, 'available')
  const missingRoot = join(fixture.root, 'missing')
  const unsupportedFile = join(fixture.root, 'notes.txt')
  await mkdir(availableRoot)
  await mkdir(missingRoot)
  await writeFile(unsupportedFile, 'texte')
  const store = new RecentProjectsStore(fixture.historyPath)

  await store.upsert(availableRoot, projectSnapshot(availableRoot, 'Disponible'))
  await store.upsert(missingRoot, projectSnapshot(missingRoot, 'Disparu'))
  await store.upsert(unsupportedFile, projectSnapshot(fixture.root, 'Non pris en charge'))
  await rm(missingRoot, { recursive: true })

  const statuses = new Map((await store.list()).map((project) => [project.name, project.availability]))
  assert.equal(statuses.get('Disponible'), 'available')
  assert.equal(statuses.get('Disparu'), 'missing')
  assert.equal(statuses.get('Non pris en charge'), 'unsupported')

  if (process.platform !== 'win32') {
    const loop = join(fixture.root, 'boucle.html')
    await symlink('boucle.html', loop)
    await store.upsert(loop, projectSnapshot(fixture.root, 'Illisible', '/boucle.html'))
    assert.equal((await store.get(recentProjectId(fixture.root, '/boucle.html')))?.availability, 'unreadable')
  }
})

test('get, forget et les mutations concurrentes restent cohérents et atomiques', async (context) => {
  const fixture = await createFixture('responsiver-recents-atomic-')
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const store = new RecentProjectsStore(fixture.historyPath)
  const snapshots: ProjectSnapshot[] = []

  for (let index = 0; index < 6; index += 1) {
    const root = join(fixture.root, `parallel-${index}`)
    await mkdir(root)
    snapshots.push(projectSnapshot(root, `Parallèle ${index}`))
  }
  await Promise.all(snapshots.map((snapshot) => store.upsert(snapshot.root, snapshot)))

  const last = snapshots.at(-1)!
  const lastId = recentProjectId(last.root, last.entryPath)
  assert.equal((await store.get(lastId))?.selectionPath, last.root)
  assert.equal(await store.get('../../etc/passwd'), null)
  assert.equal(await store.forget('recent-inconnu'), false)
  assert.equal(await store.forget(lastId), true)
  assert.equal(await store.get(lastId), null)

  const document = JSON.parse(await readFile(fixture.historyPath, 'utf8')) as { entries: unknown[] }
  assert.equal(document.entries.length, 5)
  assert.equal((await readdir(join(fixture.root, 'state'))).some((name) => name.endsWith('.tmp')), false)

  if (process.platform !== 'win32') await chmod(fixture.historyPath, 0o600)
})
