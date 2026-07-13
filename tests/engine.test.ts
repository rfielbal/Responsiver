import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { analyzeProject } from '../src/main/project-analyzer.ts'
import { applyProjectStagingToSource } from '../src/main/staging-source-apply.ts'
import type { ProjectPreparationProgress } from '../src/shared/contracts.ts'
import { createVisualEditOperation } from '../src/shared/visual-editor.ts'
import {
  assessComplementaryTheme,
  buildProjectStaging,
  generateComplementaryThemeCss,
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
  --background-gradient: linear-gradient(#11120f, #1d1f1b);
  --surface-opacity: .82;
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
  assert.equal(first.routes.some((route) => route.path === '/demos/isolated/index.html'), false)

  const rootMinimum = first.issues.find((issue) => issue.rule === 'css.min-width-mobile' && issue.routePath === '/index.html')
  const external = first.issues.find((issue) => issue.rule === 'network.external-resource' && issue.routePath === '/index.html')
  assert.ok(rootMinimum?.fix)
  assert.ok(external)

  const explicitDemo = await analyzeProject(fixture.root, { preferredEntryPath: '/demos/isolated/index.html' })
  assert.equal(explicitDemo.entryPath, '/demos/isolated/index.html')
  assert.ok(explicitDemo.routes.some((route) => route.path === '/demos/isolated/index.html'))
  assert.ok(explicitDemo.issues.some((issue) => issue.rule === 'css.fixed-width' && issue.routePath === '/demos/isolated/index.html'))
})

test('un squelette sans rendu est bloqué avec un diagnostic explicite', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-empty-'))
  await mkdir(join(root, 'images'))
  await writeFile(join(root, 'index.html'), `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title></title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
</html>`)
  await writeFile(join(root, 'styles.css'), '')
  await writeFile(join(root, 'images', 'portrait.jpg'), Buffer.from('image locale non référencée'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const progress: ProjectPreparationProgress[] = []
  const project = await analyzeProject(root, { onProgress: (event) => progress.push(event) })
  const diagnosticCodes = project.previewReadiness.diagnostics.map((diagnostic) => diagnostic.code)

  assert.equal(project.previewReadiness.status, 'blocked')
  assert.equal(project.previewReadiness.strategy, 'static')
  assert.equal(project.previewBasePath, null)
  assert.equal(project.capabilities.interactive, false)
  assert.deepEqual(diagnosticCodes, [
    'html.incomplete-document',
    'html.no-visible-content',
    'css.empty',
    'assets.unreferenced'
  ])
  assert.equal(project.issues.some((issue) => issue.rule === 'manual.visual-sweep'), false)
  assert.deepEqual(project.issues.map((issue) => issue.rule), diagnosticCodes)
  assert.ok(project.issues.every((issue) => !issue.fix || issue.fix.kind === 'manual'))
  assert.deepEqual(progress.map((event) => event.phase), ['inventory', 'routes', 'responsive', 'preview', 'blocked'])
  assert.deepEqual(progress.map((event) => [event.step, event.total]), [[2, 6], [3, 6], [4, 6], [5, 6], [5, 6]])
})

test('un artefact compilé local remplace prudemment le shell source', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-artifact-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'dist', 'assets'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    scripts: { build: 'vite build' },
    dependencies: { react: '^19.0.0', vite: '^6.0.0' }
  }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>Source</title><link rel="stylesheet" href="/source.css"></head><body><div id="root"></div><script type="module" src="/src/main.js"></script></body></html>')
  await writeFile(join(root, 'source.css'), '.source-only { width: 1200px; }')
  await writeFile(join(root, 'src', 'main.js'), 'document.querySelector("#root").textContent = "Source"')
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Build</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>')
  await writeFile(join(root, 'dist', 'about.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>À propos</title></head><body>À propos</body></html>')
  await writeFile(join(root, 'dist', 'assets', 'app.js'), 'document.querySelector("#root").textContent = "Build"')
  await writeFile(join(root, 'dist', 'assets', 'app.css'), '.compiled { width: 900px; }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewReadiness.status, 'ready')
  assert.equal(project.previewReadiness.strategy, 'artifact')
  assert.equal(project.previewBasePath, 'dist')
  assert.equal(project.entryPath, '/index.html')
  assert.deepEqual(
    project.routes.map(({ path, label, sourcePath }) => ({ path, label, sourcePath })),
    [
      { path: '/index.html', label: 'index.html', sourcePath: 'dist/index.html' },
      { path: '/about.html', label: 'about.html', sourcePath: 'dist/about.html' }
    ]
  )
  assert.equal(project.capabilities.previewStrategy, 'artifact')
  assert.equal(project.capabilities.buildRequired, false)
  assert.ok(project.issues.some((issue) => issue.rule === 'css.fixed-width' && issue.source?.file === 'dist/assets/app.css'))
  assert.equal(project.issues.some((issue) => issue.source?.file === 'source.css'), false)

  const fixedWidth = project.issues.find((issue) => issue.rule === 'css.fixed-width')
  assert.ok(fixedWidth)
  const staging = await buildProjectStaging(root, project, { issueIds: [fixedWidth.id], themeTarget: null, instructions: [] })
  assert.ok(staging.snapshot.changedFiles.includes('dist/assets/app.css'))
  assert.equal(staging.snapshot.changedFiles.includes('index.html'), false)
  assert.equal(staging.snapshot.generatedFile, null)
  assert.match(staging.overrides.get('dist/assets/app.css')?.toString('utf8') ?? '', /min\(100%, 900px\)/)

  const explicitSource = await analyzeProject(root, { preferredEntryPath: '/index.html' })
  assert.equal(explicitSource.entryPath, '/index.html')
  assert.equal(explicitSource.previewBasePath, null)
  assert.equal(explicitSource.previewReadiness.status, 'needs-build')
  assert.equal(explicitSource.previewReadiness.strategy, 'source')
  assert.equal(explicitSource.capabilities.staging, false)
})

test('un artefact imbriqué monte le dossier réel de son entrée et signale un build ancien', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-nested-artifact-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'dist', 'client', 'browser', 'assets'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'ng build' }, dependencies: { '@angular/core': '^20.0.0' } }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>')
  await writeFile(join(root, 'src', 'main.ts'), 'document.querySelector("#app")!.textContent = "Source"')
  await writeFile(join(root, 'dist', 'client', 'browser', 'index.html'), '<!doctype html><html><head><base href="/"><meta name="viewport" content="width=device-width"></head><body><script src="assets/main.js"></script></body></html>')
  await writeFile(join(root, 'dist', 'client', 'browser', 'assets', 'main.js'), 'document.body.textContent = "Build"')
  const future = new Date(Date.now() + 10_000)
  await utimes(join(root, 'src', 'main.ts'), future, future)
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewBasePath, 'dist/client/browser')
  assert.equal(project.entryPath, '/index.html')
  assert.equal(project.routes[0]?.sourcePath, 'dist/client/browser/index.html')
  assert.equal(project.previewReadiness.status, 'degraded')
  assert.ok(project.previewReadiness.diagnostics.some((diagnostic) => diagnostic.code === 'artifact.possibly-stale'))
})

test('une entrée rangée dans pages conserve la racine qui porte ses assets absolus', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-artifact-pages-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'dist', 'pages'), { recursive: true })
  await mkdir(join(root, 'dist', 'assets'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6.0.0' } }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>')
  await writeFile(join(root, 'src', 'main.ts'), 'document.querySelector("#app")!.textContent = "Source"')
  await writeFile(join(root, 'dist', 'pages', 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/app.css"></head><body>Build</body></html>')
  await writeFile(join(root, 'dist', 'assets', 'app.css'), 'body { margin: 0; }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewBasePath, 'dist')
  assert.equal(project.entryPath, '/pages/index.html')
  assert.equal(project.routes[0]?.sourcePath, 'dist/pages/index.html')
  assert.equal(project.previewReadiness.diagnostics.some((diagnostic) => diagnostic.code === 'artifact.mount-uncertain'), false)
})

test('un artefact imbriqué conserve le parent nécessaire à ses ressources relatives', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-artifact-relative-parent-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'dist', 'client', 'pages'), { recursive: true })
  await mkdir(join(root, 'dist', 'client', 'assets'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6.0.0' } }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>')
  await writeFile(join(root, 'src', 'main.ts'), 'document.querySelector("#app")!.textContent = "Source"')
  await writeFile(join(root, 'dist', 'client', 'pages', 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="../assets/app.css"></head><body>Build</body></html>')
  await writeFile(join(root, 'dist', 'client', 'assets', 'app.css'), 'body { margin: 0; }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewBasePath, 'dist/client')
  assert.equal(project.entryPath, '/pages/index.html')
  assert.equal(project.routes[0]?.sourcePath, 'dist/client/pages/index.html')
  assert.equal(project.previewReadiness.diagnostics.some((diagnostic) => diagnostic.code === 'artifact.mount-uncertain'), false)
})

test('un artefact sans asset conserve les routes HTML sœurs de son entrée imbriquée', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-artifact-sibling-routes-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'dist', 'pages'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6.0.0' } }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>')
  await writeFile(join(root, 'src', 'main.ts'), 'document.querySelector("#app")!.textContent = "Source"')
  await writeFile(join(root, 'dist', 'pages', 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>Accueil compilé</body></html>')
  await writeFile(join(root, 'dist', 'about.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>À propos</body></html>')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewBasePath, 'dist')
  assert.equal(project.entryPath, '/pages/index.html')
  assert.deepEqual(project.routes.map((route) => route.path), ['/pages/index.html', '/about.html'])
})

test('les dossiers cachés ne deviennent jamais une entrée ou une route', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-hidden-entry-'))
  await mkdir(join(root, '.docs'))
  await mkdir(join(root, '.responsiver'))
  await writeFile(join(root, '.docs', 'index.html'), '<!doctype html><html><body>Documentation cachée</body></html>')
  await writeFile(join(root, '.responsiver', 'index.html'), '<!doctype html><html><body>Overlay physique</body></html>')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.entryPath, null)
  assert.deepEqual(project.routes, [])
  assert.equal(project.previewReadiness.status, 'blocked')
  assert.ok(project.previewReadiness.diagnostics.some((diagnostic) => diagnostic.code === 'html.entry-missing'))
})

test('un grand dossier média ne masque pas l’entrée HTML racine', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-media-budget-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>Page visible</body></html>')
  for (let start = 0; start < 1_510; start += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 1_510 - start) }, (_, offset) => (
      writeFile(join(root, 'assets', `image-${String(start + offset).padStart(4, '0')}.png`), '')
    )))
  }
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.entryPath, '/index.html')
  assert.notEqual(project.previewReadiness.status, 'blocked')
  assert.equal(project.capabilities.interactive, true)
  assert.equal(project.analysis.truncated, true)
  assert.ok(project.previewReadiness.diagnostics.some((diagnostic) => diagnostic.code === 'analysis.truncated'))
  assert.ok(project.issues.some((issue) => issue.rule === 'analysis.truncated' && issue.title === 'Analyse partielle'))
})

test('un bundle JavaScript local déjà exécutable à la racine ne demande pas de rebuild', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-root-bundle-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'static'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { vite: '^6.0.0' } }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><div id="app"></div><script type="module" src="/static/app.js"></script></body></html>')
  await writeFile(join(root, 'static', 'app.js'), 'document.querySelector("#app").textContent = "Prêt"')
  await writeFile(join(root, 'src', 'source.ts'), 'export const source = true')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewReadiness.status, 'ready')
  assert.equal(project.previewReadiness.strategy, 'static')
  assert.equal(project.previewBasePath, null)
  assert.equal(project.capabilities.buildRequired, false)
  assert.equal(project.capabilities.interactive, true)
})

test('un dossier sans HTML est non pris en charge sans inventer une compilation', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-no-entry-'))
  await writeFile(join(root, 'styles.css'), 'body { color: #222; }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewReadiness.status, 'blocked')
  assert.equal(project.previewReadiness.strategy, 'unsupported')
  assert.equal(project.capabilities.buildRequired, false)
  assert.equal(project.capabilities.staging, false)
  assert.ok(project.previewReadiness.diagnostics.some((diagnostic) => diagnostic.code === 'html.entry-missing'))
})

test('un template public de framework n’est pas confondu avec un artefact compilé', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-public-template-'))
  await mkdir(join(root, 'public'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6.0.0' } }))
  await writeFile(join(root, 'public', 'index.html'), '<!doctype html><html><head><title>Template</title></head><body>Template public</body></html>')
  await writeFile(join(root, 'main.ts'), 'document.body.textContent = "Application"')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.previewReadiness.status, 'needs-build')
  assert.equal(project.previewReadiness.strategy, 'source')
  assert.equal(project.previewBasePath, null)
  assert.equal(project.capabilities.buildRequired, true)
})

test('la stack Symfony, React et Tailwind est annoncée sans exécuter sa chaîne de build', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-framework-stack-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    scripts: { build: 'vite build' },
    dependencies: { react: '^19.0.0', vite: '^6.0.0', tailwindcss: '^4.0.0' }
  }))
  await writeFile(join(root, 'composer.json'), JSON.stringify({ require: { 'symfony/framework-bundle': '^7.0' } }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>Shell</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')
  await writeFile(join(root, 'src', 'main.tsx'), 'export const App = () => <main>Application</main>')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.capabilities.framework, 'Symfony + React + Tailwind CSS')
  assert.equal(project.capabilities.buildRequired, true)
  assert.equal(project.previewReadiness.status, 'needs-build')
})

test('le staging produit un patch et une variante claire sans toucher aux sources', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const themeCss = generateComplementaryThemeCss(project, 'light')
  assert.match(themeCss, /Contrastes vérifiés/)
  assert.doesNotMatch(themeCss, /\n\s*--accent\s*:/)
  assert.doesNotMatch(themeCss, /--background-gradient|--surface-opacity/)
  assert.doesNotMatch(themeCss, /\[class\*="card"|\bimg\b|\bfilter\s*:/i)
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
  assert.ok(staging.snapshot.outcomes?.some((outcome) => outcome.kind === 'theme' && outcome.status === 'applied'))
  assert.ok(staging.snapshot.outcomes?.some((outcome) => outcome.kind === 'instruction' && outcome.status === 'skipped'))
  assert.ok(selectedIssues.every((id) => staging.snapshot.outcomes?.some((outcome) => outcome.proposalId === id && outcome.status === 'applied')))

  const stagedIndex = staging.overrides.get('index.html')?.toString('utf8') ?? ''
  const stagedJournal = staging.overrides.get('journal.html')?.toString('utf8') ?? ''
  assert.match(stagedIndex, /data-responsiver-generated-theme="light"/)
  assert.match(stagedJournal, /data-responsiver-generated-theme="light"/)
})

test('deux propositions incompatibles sur la même cible sont signalées sans disparaître du staging', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const base = project.issues.find((issue) => issue.rule === 'css.min-width-mobile' && issue.routePath === '/index.html')
  assert.ok(base?.fix && base.fix.kind === 'css-media-override')
  const conflicting = {
    ...base,
    id: `${base.id}-conflict`,
    fix: { ...base.fix, after: '12rem' }
  }
  project.issues.push(conflicting)

  const staging = await buildProjectStaging(fixture.root, project, {
    issueIds: [base.id, conflicting.id],
    themeTarget: null,
    instructions: []
  })

  const conflicts = staging.snapshot.outcomes?.filter((outcome) => outcome.status === 'conflict') ?? []
  assert.deepEqual(conflicts.map((outcome) => outcome.proposalId).sort(), [base.id, conflicting.id].sort())
  assert.equal(staging.snapshot.changedFiles.length, 0)
})

test('deux applications successives réutilisent la feuille Responsiver gérée', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const firstProject = await analyzeProject(fixture.root)
  const first = await buildProjectStaging(fixture.root, firstProject, {
    issueIds: [], themeTarget: null, instructions: ['Utilise un accent #315f8c']
  })
  await applyProjectStagingToSource(fixture.root, first)

  const refreshed = await analyzeProject(fixture.root)
  const duplicate = await buildProjectStaging(fixture.root, refreshed, {
    issueIds: [], themeTarget: null, instructions: ['Utilise un accent #315f8c']
  })
  assert.equal(duplicate.snapshot.changes.length, 0, JSON.stringify(duplicate.snapshot.changes))
  assert.equal(duplicate.snapshot.outcomes?.find((outcome) => outcome.kind === 'instruction')?.status, 'skipped')
  const second = await buildProjectStaging(fixture.root, refreshed, {
    issueIds: [], themeTarget: null, instructions: ['Mets les angles droits sur les composants']
  })
  assert.ok(second.snapshot.changedFiles.includes('.responsiver/responsiver.generated.css'))
  assert.equal(second.snapshot.changedFiles.some((path) => /responsiver\.generated\.\d+\.css$/.test(path)), false)
  const generated = second.overrides.get('.responsiver/responsiver.generated.css')?.toString('utf8') ?? ''
  assert.match(generated, /--responsiver-accent: #315f8c/)
  assert.match(generated, /border-radius: 0/)
})

test('l’Atelier visuel prépare une surcharge responsive liée uniquement à la route choisie', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const visualEdit = createVisualEditOperation({
    target: { selector: 'html > body > nav.navigation', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true } },
    property: 'flex-wrap',
    before: 'nowrap',
    after: 'wrap',
    scope: { kind: 'mobile' },
    route: { kind: 'current', path: '/index.html' }
  })
  const staging = await buildProjectStaging(fixture.root, project, {
    issueIds: [], themeTarget: null, instructions: [], visualEdits: [visualEdit]
  })
  assert.match(staging.snapshot.generatedCss, /Atelier visuel/)
  assert.match(staging.snapshot.generatedCss, /@media \(max-width: 767px\)/)
  assert.match(staging.snapshot.generatedCss, /flex-wrap: wrap !important/)
  assert.match(staging.snapshot.generatedCss, /html\[data-responsiver-route="route-[a-f\d]{10}"\] > body > nav\.navigation/)
  assert.doesNotMatch(staging.snapshot.generatedCss, /data-responsiver-route="[^"]+"\] html/)
  assert.equal(staging.snapshot.visualEdits?.length, 1)
  assert.equal(staging.snapshot.changes.some((change) => change.kind === 'visual'), true)
  assert.match(staging.overrides.get('index.html')?.toString('utf8') ?? '', /data-responsiver-route="route-[a-f\d]{10}"/)
  assert.match(staging.overrides.get('index.html')?.toString('utf8') ?? '', /data-responsiver-generated/)
  assert.equal(staging.overrides.has('journal.html'), false)

  await applyProjectStagingToSource(fixture.root, staging)
  const refreshed = await analyzeProject(fixture.root)
  const repeated = await buildProjectStaging(fixture.root, refreshed, {
    issueIds: [], themeTarget: null, instructions: [], visualEdits: [visualEdit]
  })
  assert.equal(repeated.snapshot.outcomes?.find((outcome) => outcome.kind === 'visual')?.status, 'skipped')
  assert.equal(repeated.snapshot.changedFiles.length, 0)
})

test('un nouveau geste remplace sa précédente règle gérée au lieu de l’empiler', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const operation = (after: string) => createVisualEditOperation({
    target: { selector: 'html > body > nav.navigation', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true } },
    property: 'gap',
    before: '8px',
    after,
    scope: { kind: 'mobile' },
    route: { kind: 'current', path: '/index.html' }
  })
  const firstOperation = operation('12px')
  const first = await buildProjectStaging(fixture.root, project, { issueIds: [], themeTarget: null, instructions: [], visualEdits: [firstOperation] })
  await applyProjectStagingToSource(fixture.root, first)

  const refreshed = await analyzeProject(fixture.root)
  const secondOperation = operation('24px')
  assert.equal(secondOperation.id, firstOperation.id)
  const second = await buildProjectStaging(fixture.root, refreshed, { issueIds: [], themeTarget: null, instructions: [], visualEdits: [secondOperation] })
  const generated = second.overrides.get('.responsiver/responsiver.generated.css')?.toString('utf8') ?? ''
  assert.match(generated, /gap: 24px !important/)
  assert.doesNotMatch(generated, /gap: 12px !important/)
  assert.equal(generated.match(new RegExp(`Responsiver visual:start ${firstOperation.id}`, 'g'))?.length, 1)
})

test('les anciennes règles visuelles dupliquées sont migrées vers un seul bloc géré', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const operation = createVisualEditOperation({
    target: { selector: 'html > body > nav.navigation', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true } },
    property: 'gap',
    before: '8px',
    after: '24px',
    scope: { kind: 'mobile' },
    route: { kind: 'current', path: '/index.html' }
  })
  await mkdir(join(fixture.root, '.responsiver'), { recursive: true })
  await writeFile(join(fixture.root, '.responsiver', 'responsiver.generated.css'), [
    '/*\n * Généré localement par Responsiver.\n * Chaque règle reste lisible, exportable et réversible.\n */',
    `/* Atelier visuel · /index.html · ${operation.id} */\n.navigation { gap: 12px !important; }`,
    `/* Atelier visuel · /index.html · ${operation.id} */\n.navigation { gap: 16px !important; }`
  ].join('\n\n'))

  const staging = await buildProjectStaging(fixture.root, project, { issueIds: [], themeTarget: null, instructions: [], visualEdits: [operation] })
  const generated = staging.overrides.get('.responsiver/responsiver.generated.css')?.toString('utf8') ?? ''
  assert.match(generated, /gap: 24px !important/)
  assert.doesNotMatch(generated, /gap: (?:12|16)px !important/)
  assert.equal(generated.match(new RegExp(`Responsiver visual:start ${operation.id}`, 'g'))?.length, 1)
})

test('un correctif déjà couvert par la feuille gérée devient un no-op explicite', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const initial = await analyzeProject(fixture.root)
  const finding = initial.issues.find((issue) => issue.rule === 'css.min-width-mobile' && issue.routePath === '/index.html')
  assert.ok(finding)
  const first = await buildProjectStaging(fixture.root, initial, { issueIds: [finding.id], themeTarget: null, instructions: [] })
  await applyProjectStagingToSource(fixture.root, first)

  const refreshed = await analyzeProject(fixture.root)
  const repeatedFinding = refreshed.issues.find((issue) => issue.rule === 'css.min-width-mobile' && issue.routePath === '/index.html')
  assert.ok(repeatedFinding)
  const repeated = await buildProjectStaging(fixture.root, refreshed, { issueIds: [repeatedFinding.id], themeTarget: null, instructions: [] })
  assert.equal(repeated.snapshot.changes.length, 0)
  assert.equal(repeated.snapshot.changedFiles.length, 0)
  assert.equal(repeated.snapshot.outcomes?.find((outcome) => outcome.proposalId === repeatedFinding.id)?.status, 'skipped')
})

test('deux déclarations CSS de même cible à des lignes différentes ne sont pas un faux conflit', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-css-lines-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="styles.css"><title>CSS</title></head><body><nav class="site-nav">Menu</nav></body></html>')
  await writeFile(join(root, 'styles.css'), '.site-nav { min-width: 720px; }\n\n.site-nav { min-width: 680px; }\n')
  const project = await analyzeProject(root)
  const findings = project.issues.filter((issue) => issue.rule === 'css.min-width-mobile')
  assert.ok(findings.length >= 2)
  const staged = await buildProjectStaging(root, project, { issueIds: findings.map((issue) => issue.id), themeTarget: null, instructions: [] })
  assert.equal(staged.snapshot.outcomes?.some((outcome) => outcome.status === 'conflict'), false)
})

test('les instructions et thèmes incompatibles sont refusés au lieu de laisser gagner le dernier', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  const project = await analyzeProject(fixture.root)
  const accents = await buildProjectStaging(fixture.root, project, {
    issueIds: [], themeTarget: null, instructions: ['Utilise un accent #315f8c', 'Utilise un accent #b74538']
  })
  assert.equal(accents.snapshot.outcomes?.filter((outcome) => outcome.status === 'conflict').length, 2)
  assert.equal(accents.snapshot.changedFiles.length, 0)

  const themes = await buildProjectStaging(fixture.root, project, {
    issueIds: [], themeTarget: 'dark', instructions: ['Crée une version claire']
  })
  assert.equal(themes.snapshot.outcomes?.filter((outcome) => outcome.status === 'conflict').length, 2)
  assert.equal(themes.snapshot.changedFiles.length, 0)
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
  assert.equal(staging.snapshot.outcomes?.[0]?.status, 'skipped')
})

test('la génération de thème refuse une palette sans rôles fond et texte fiables', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-theme-unsafe-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="styles.css"></head><body>Marque</body></html>')
  await writeFile(join(root, 'styles.css'), ':root { --button-bg: #e0cdb9; --text-primary: #101010; } body { background: #f7f2e9; color: var(--text-primary); }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  const assessment = assessComplementaryTheme(project, 'dark')
  assert.equal(project.theme.detected, 'light')
  assert.equal(assessment.safe, false)
  assert.match(assessment.reason, /fond\/texte|Génération refusée/)
  await assert.rejects(
    buildProjectStaging(root, project, { issueIds: [], themeTarget: 'dark', instructions: [] }),
    /Génération refusée/
  )
})

test('un token de palette inutilisé ne crée pas un faux second thème', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-theme-tokens-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="styles.css"></head><body>Thème actif</body></html>')
  await writeFile(join(root, 'styles.css'), `:root {
    --background-dark: #11120f;
    --background-light: #f8f6f0;
    --background: var(--background-dark);
  }
  body { background: var(--background); color: #f5f3ed; }`)
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.theme.detected, 'dark')
  assert.equal(project.theme.hasDark, true)
  assert.equal(project.theme.hasLight, false)
  assert.equal(suggestedComplementaryTheme(project.theme), 'light')
})

test('un layout bicolore sans sélecteur ne devient pas un thème dual', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-bicolor-layout-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="styles.css"></head><body><main>Carte claire</main></body></html>')
  await writeFile(join(root, 'styles.css'), 'body { background: #11120f; color: #f5f3ed; } main { background: #ffffff; color: #20211e; }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  assert.equal(project.theme.detected, 'dark')
  assert.equal(project.theme.hasDark, true)
  assert.equal(project.theme.hasLight, false)
})

test('les médias, srcset et URL CSS distants sont diagnostiqués sans exposer leurs paramètres', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'responsiver-external-media-'))
  await writeFile(join(root, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="styles.css"></head><body>
    <img src="https://cdn.example.test/photo.jpg?token=secret" srcset="https://images.example.test/photo@2x.jpg?sig=private 2x">
    <video poster="//media.example.test/poster.jpg?key=hidden"></video>
    <iframe src="https://frames.example.test/embed?id=42"></iframe>
  </body></html>`)
  await writeFile(join(root, 'styles.css'), '.hero { background-image: url("https://assets.example.test/hero.webp?signature=hidden"); }')
  context.after(() => rm(root, { recursive: true, force: true }))

  const project = await analyzeProject(root)
  const htmlIssue = project.issues.find((issue) => issue.rule === 'network.external-resource')
  const cssIssue = project.issues.find((issue) => issue.rule === 'network.external-css-resource')
  assert.ok(htmlIssue?.fix?.before?.includes('cdn.example.test/photo.jpg'))
  assert.ok(htmlIssue?.fix?.before?.includes('images.example.test/photo@2x.jpg'))
  assert.ok(htmlIssue?.fix?.before?.includes('media.example.test/poster.jpg'))
  assert.ok(htmlIssue?.fix?.before?.includes('frames.example.test/embed'))
  assert.equal(htmlIssue?.fix?.before?.includes('secret'), false)
  assert.ok(cssIssue?.fix?.before?.includes('assets.example.test/hero.webp'))
  assert.equal(cssIssue?.fix?.before?.includes('signature'), false)
})

test('la conversation locale reste déterministe et refuse les demandes inconnues', () => {
  assert.equal(interpretLocalInstruction('Autorise le menu à revenir à la ligne').recognized, true)
  const stableNavigation = interpretLocalInstruction('Sur mobile, stabilise le menu dans une rangée défilante sans masquer ses liens.')
  assert.equal(stableNavigation.recognized, true)
  assert.match(stableNavigation.css ?? '', /overflow-x:\s*auto/)
  const boundedTitle = interpretLocalInstruction('Sur mobile, borne la taille des grands titres disproportionnés.')
  assert.equal(boundedTitle.recognized, true)
  assert.match(boundedTitle.css ?? '', /font-size:\s*clamp/)
  assert.match(interpretLocalInstruction('Jusqu’à 1024 px, borne la taille des grands titres disproportionnés.').css ?? '', /max-width:\s*1024px/)
  assert.match(interpretLocalInstruction('Jusqu’à 1440 px, borne la taille des grands titres disproportionnés.').css ?? '', /max-width:\s*1440px/)
  const targetedTitle = interpretLocalInstruction('Cible h1.hero__title. Jusqu’à 1024 px, borne la taille des grands titres disproportionnés.')
  assert.match(targetedTitle.css ?? '', /:where\(h1\.hero__title\)/)
  assert.doesNotMatch(targetedTitle.css ?? '', /\[class\*="title"/)
  const targetedNavigation = interpretLocalInstruction('Cible nav.menu. Jusqu’à 1024 px, stabilise le menu dans une rangée défilante sans masquer ses liens.')
  assert.match(targetedNavigation.css ?? '', /:where\(nav\.menu, nav\.menu > ul, nav\.menu > ol\)/)
  assert.match(targetedNavigation.css ?? '', /:where\(nav\.menu > ul, nav\.menu > ol, nav\.menu:not\(:has\(> ul, > ol\)\)\)/)
  assert.match(targetedNavigation.css ?? '', /:where\(nav\.menu > a, nav\.menu > button/)
  assert.doesNotMatch(targetedNavigation.css ?? '', /nav\.menu ul/)
  assert.match(targetedNavigation.css ?? '', /min-inline-size:\s*0\s*!important/)
  assert.doesNotMatch(targetedNavigation.css ?? '', /\[class\*="nav"/)
  assert.equal(interpretLocalInstruction('Mets un accent terracotta').recognized, true)
  assert.equal(interpretLocalInstruction('Réinvente tout avec une IA').recognized, false)
})
