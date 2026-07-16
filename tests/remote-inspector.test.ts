import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MAX_REMOTE_BROWSER_VIEWS, REMOTE_INSPECTOR_LIMITS, REMOTE_SCROLL_LIMITS, normalizeRemoteViewId, sanitizeRemoteInspectorSelection, sanitizeRemoteScrollSnapshot } from '../src/main/remote-session.ts'

test('les identifiants du Studio distant sont bornés et la vue historique reste implicite', () => {
  assert.equal(MAX_REMOTE_BROWSER_VIEWS, 5)
  assert.equal(normalizeRemoteViewId(undefined), null)
  assert.equal(normalizeRemoteViewId('studio-4.tablet'), 'studio-4.tablet')
  assert.throws(() => normalizeRemoteViewId('vue avec espaces'), /invalide/)
  assert.throws(() => normalizeRemoteViewId(`v${'x'.repeat(64)}`), /invalide/)
})

test('le snapshot de défilement ne transporte que progression et repère sémantique bornés', () => {
  const snapshot = sanitizeRemoteScrollSnapshot({
    version: 1,
    xProgress: 1.4,
    yProgress: 0.31415926535,
    anchor: { kind: 'section', index: 12, viewportOffset: -8, text: 'secret', selector: '#privé' },
    url: 'https://secret.example/compte',
    content: 'information à ne jamais relayer'
  })
  assert.deepEqual(snapshot, {
    version: 1,
    xProgress: 1,
    yProgress: 0.314159,
    anchor: { kind: 'section', index: 12, viewportOffset: -REMOTE_SCROLL_LIMITS.maxViewportOffset }
  })
  assert.equal(sanitizeRemoteScrollSnapshot({ version: 1, xProgress: '0.5', yProgress: 0, anchor: null }), null)
  assert.equal(sanitizeRemoteScrollSnapshot({ version: 1, xProgress: 0, yProgress: 0, anchor: { kind: 'form', index: 0, viewportOffset: 0 } }), null)
  assert.equal(sanitizeRemoteScrollSnapshot({ version: 1, xProgress: 0, yProgress: 0, anchor: { kind: 'main', index: REMOTE_SCROLL_LIMITS.maxAnchorIndex, viewportOffset: 0 } }), null)
})

test('le snapshot distant identifie un conteneur interne uniquement par un rang borné', () => {
  assert.deepEqual(sanitizeRemoteScrollSnapshot({
    version: 1,
    xProgress: 0,
    yProgress: 0.75,
    container: { kind: 'scrollable', index: 3, selector: '#secret', text: 'privé' },
    anchor: null
  }), {
    version: 1,
    xProgress: 0,
    yProgress: 0.75,
    container: { kind: 'scrollable', index: 3 },
    anchor: null
  })
  assert.equal(sanitizeRemoteScrollSnapshot({ version: 1, xProgress: 0, yProgress: 0, container: { kind: 'selector', index: 0 }, anchor: null }), null)
  assert.equal(sanitizeRemoteScrollSnapshot({ version: 1, xProgress: 0, yProgress: 0, container: { kind: 'scrollable', index: REMOTE_SCROLL_LIMITS.maxContainerIndex }, anchor: null }), null)
})

test('la sélection CDP est bornée avant de rejoindre le renderer', () => {
  const selection = sanitizeRemoteInspectorSelection({
    selector: `.card-${'x'.repeat(500)}`,
    tag: 'ARTICLE',
    classes: [...Array.from({ length: 30 }, (_value, index) => `classe-${index}`), 42],
    role: `button${'x'.repeat(200)}`,
    ariaLabel: `Carte ${'x'.repeat(300)}`,
    rect: { x: -900_000, y: 18.125, width: 900_000, height: 72.333 },
    styles: {
      display: 'grid',
      color: `rgb(20, 20, 20)${'x'.repeat(400)}`,
      content: 'information privée à ignorer'
    },
    occurrences: 50_000,
    text: `Contenu ${'x'.repeat(500)}`
  }, { route: `/route\u0000${'r'.repeat(3_000)}`, editable: true })

  assert.ok(selection)
  assert.equal(selection.selector.length, REMOTE_INSPECTOR_LIMITS.maxSelectorLength)
  assert.equal(selection.tag, 'article')
  assert.equal(selection.classes.length, REMOTE_INSPECTOR_LIMITS.maxClasses)
  assert.equal(selection.rect.x, -REMOTE_INSPECTOR_LIMITS.maxCoordinate)
  assert.equal(selection.rect.width, REMOTE_INSPECTOR_LIMITS.maxCoordinate)
  assert.equal(selection.styles.display, 'grid')
  assert.equal(selection.styles.color.length, REMOTE_INSPECTOR_LIMITS.maxStyleValueLength)
  assert.equal('content' in selection.styles, false)
  assert.equal(selection.occurrences, REMOTE_INSPECTOR_LIMITS.maxOccurrences)
  assert.equal(selection.route.length, REMOTE_INSPECTOR_LIMITS.maxRouteLength)
  assert.equal(selection.text.length, REMOTE_INSPECTOR_LIMITS.maxTextLength)
  assert.equal(selection.editable, true)
})

test('un Shadow DOM reste inspectable mais n’est pas annoncé comme directement éditable', () => {
  const selection = sanitizeRemoteInspectorSelection({
    selector: '#composant >>> button.action',
    tag: 'button',
    classes: ['action'],
    rect: { x: 10, y: 20, width: 80, height: 44 },
    styles: { display: 'inline-flex' },
    occurrences: 1,
    text: 'Valider'
  }, { route: '/', editable: true })

  assert.ok(selection)
  assert.equal(selection.editable, false)
  assert.equal(sanitizeRemoteInspectorSelection({ selector: '*', tag: '<script>', rect: {} }, { route: '/', editable: true }), null)
})

test('un nœud de sous-frame distante reste en inspection seule', () => {
  const selection = sanitizeRemoteInspectorSelection({
    selector: 'button.action',
    tag: 'button',
    classes: ['action'],
    rect: { x: 10, y: 20, width: 80, height: 44 },
    styles: { display: 'inline-flex' },
    occurrences: 1,
    text: 'Valider',
    insideFrame: true
  }, { route: '/paiement', editable: true })

  assert.ok(selection)
  assert.equal(selection.insideFrame, true)
  assert.equal(selection.editable, false)
})

test('le moteur utilise le mode inspecteur CDP sans DevTools ni collecte de formulaires', async () => {
  const path = fileURLToPath(new URL('../src/main/remote-session.ts', import.meta.url))
  const source = await readFile(path, 'utf8')
  const runtime = source.match(/const remoteInspectorPayloadFunction = `([\s\S]*?)`\n\nfunction cleanInspectorText/)?.[1]
  assert.ok(runtime)
  assert.match(source, /Overlay\.setInspectMode/)
  assert.match(source, /Overlay\.inspectNodeRequested/)
  assert.match(source, /DOM\.resolveNode/)
  assert.match(source, /Runtime\.callFunctionOn/)
  assert.doesNotMatch(source, /openDevTools\s*\(/)
  assert.doesNotMatch(runtime, /\.value\b|innerHTML|outerHTML|localStorage|sessionStorage|indexedDB/)
  assert.match(runtime, /excludesEditableText/)
  assert.match(runtime, /insideFrame: window\.top !== window/)
  assert.match(source, /mode === 'localhost' && Boolean\(this\.linkedSourceRoot\)/)
  assert.match(source, /if \(key === 'escape'\)/)
  assert.match(source, /this\.callbacks\.onEscape\?\.\(\)/)
})

test('le pont de scroll distant ne collecte ni texte, ni sélecteur applicatif, ni formulaire', async () => {
  const path = fileURLToPath(new URL('../src/main/remote-session.ts', import.meta.url))
  const source = await readFile(path, 'utf8')
  const runtime = source.match(/const remoteScrollSnapshotFunction = `([\s\S]*?)`\n\nfunction cleanInspectorText/)?.[1]
  assert.ok(runtime)
  assert.match(runtime, /xProgress/)
  assert.match(runtime, /yProgress/)
  assert.match(runtime, /viewportOffset/)
  assert.match(runtime, /container: \{ kind: 'scrollable', index: selected\.index \}/)
  assert.match(runtime, /createTreeWalker/)
  assert.match(runtime, /nodes\.length < \$\{REMOTE_SCROLL_LIMITS\.maxScrollableNodes\}/)
  assert.doesNotMatch(runtime, /querySelectorAll\('body \*'\)/)
  assert.doesNotMatch(runtime, /innerText|textContent|innerHTML|outerHTML|\.value\b|localStorage|sessionStorage|indexedDB/)
  assert.doesNotMatch(runtime, /\.id\b|classList|CSS\.escape/)
})
