import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { analyzeProject } from '../src/main/project-analyzer.ts'
import {
  buildProjectStaging,
  interpretLocalInstruction,
  suggestedComplementaryTheme
} from '../src/main/project-transformer.ts'

interface Fixture {
  root: string
  sourceHtml: string
  sourceCss: string
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-engine-'))
  await mkdir(join(root, 'demos', 'isolated'), { recursive: true })
  const sourceHtml = `<!doctype html>
<html lang="fr"><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Site principal</title>
  <link rel="stylesheet" href="./styles.css">
  <link rel="stylesheet" href="https://cdn.example.test/icons.css">
</head><body><nav class="navigation">Accueil À propos Contact</nav></body></html>
`
  const sourceCss = `:root {
  color-scheme: dark;
  --background: #11120f;
  --surface: #1d1f1b;
  --text: #f3f1ea;
  --accent: #e36a43;
}
body { background: var(--background); color: var(--text); }
.navigation { min-width: 720px; white-space: nowrap; }
`
  await writeFile(join(root, 'index.html'), sourceHtml)
  await writeFile(join(root, 'journal.html'), sourceHtml.replace('Site principal', 'Journal'))
  await writeFile(join(root, 'styles.css'), sourceCss)
  await writeFile(join(root, 'demos', 'isolated', 'index.html'), '<!doctype html><html><head><title>Démo isolée</title><link rel="stylesheet" href="./demo.css"></head><body>Démo</body></html>')
  await writeFile(join(root, 'demos', 'isolated', 'demo.css'), '.demo { width: 900px; }')
  return { root, sourceHtml, sourceCss }
}

test('l’analyse choisit la racine, scope les routes et conserve des identifiants stables', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))

  const first = await analyzeProject(fixture.root)
  const second = await analyzeProject(fixture.root)

  assert.equal(first.entryPath, '/index.html')
  assert.equal(first.theme.detected, 'dark')
  assert.equal(suggestedComplementaryTheme(first.theme), 'light')
  assert.deepEqual(first.issues.map((issue) => issue.id), second.issues.map((issue) => issue.id))
  assert.ok(first.routes.some((route) => route.path === '/demos/isolated/index.html'))

  const rootMinimum = first.issues.find((issue) => issue.rule === 'css.min-width-mobile' && issue.routePath === '/index.html')
  const demoWidth = first.issues.find((issue) => issue.rule === 'css.fixed-width' && issue.routePath === '/demos/isolated/index.html')
  const external = first.issues.find((issue) => issue.rule === 'network.external-resource' && issue.routePath === '/index.html')
  assert.ok(rootMinimum?.fix)
  assert.ok(demoWidth)
  assert.ok(external)
})

test('le staging produit un patch et une variante claire sans toucher aux sources', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const selectedIssues = project.issues
    .filter((issue) => issue.routePath === '/index.html' && ['css.min-width-mobile', 'css.nowrap'].includes(issue.rule))
    .map((issue) => issue.id)

  const staging = await buildProjectStaging(fixture.root, project, {
    issueIds: selectedIssues,
    themeTarget: 'light',
    instructions: ['Utilise un accent #315f8c', 'Ajoute une intelligence artificielle distante']
  })

  assert.equal(await readFile(join(fixture.root, 'index.html'), 'utf8'), fixture.sourceHtml)
  assert.equal(await readFile(join(fixture.root, 'styles.css'), 'utf8'), fixture.sourceCss)
  assert.ok(staging.snapshot.changedFiles.includes('index.html'))
  assert.ok(staging.snapshot.changedFiles.includes('journal.html'))
  assert.ok(staging.snapshot.changedFiles.some((file) => file.startsWith('.responsiver/')))
  assert.ok(!staging.snapshot.changedFiles.includes('demos/isolated/index.html'))
  assert.match(staging.snapshot.generatedCss, /Variante claire déterministe/)
  assert.match(staging.snapshot.generatedCss, /#315f8c/i)
  assert.match(staging.snapshot.patch, /diff --git a\/index\.html b\/index\.html/)
  assert.deepEqual(staging.snapshot.recognizedInstructions, ['Utilise un accent #315f8c'])
  assert.deepEqual(staging.snapshot.ignoredInstructions, ['Ajoute une intelligence artificielle distante'])

  const stagedIndex = staging.overrides.get('index.html')?.toString('utf8') ?? ''
  const stagedJournal = staging.overrides.get('journal.html')?.toString('utf8') ?? ''
  assert.match(stagedIndex, /data-responsiver-generated-theme="light"/)
  assert.match(stagedJournal, /data-responsiver-generated-theme="light"/)
})

test('un thème existant n’est jamais proposé comme doublon', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const staging = await buildProjectStaging(fixture.root, project, {
    issueIds: [],
    themeTarget: 'dark',
    instructions: []
  })

  assert.equal(staging.snapshot.generatedCss, '')
  assert.equal(staging.snapshot.changes.length, 0)
  assert.equal(staging.overrides.size, 0)
})

test('la conversation locale reste déterministe et refuse les demandes inconnues', () => {
  assert.equal(interpretLocalInstruction('Autorise le menu à revenir à la ligne').recognized, true)
  assert.equal(interpretLocalInstruction('Mets un accent terracotta').recognized, true)
  assert.equal(interpretLocalInstruction('Réinvente tout avec une IA').recognized, false)
})
