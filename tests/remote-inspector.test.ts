import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { REMOTE_INSPECTOR_LIMITS, sanitizeRemoteInspectorSelection } from '../src/main/remote-session.ts'

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
})
