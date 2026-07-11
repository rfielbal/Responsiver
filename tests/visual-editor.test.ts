import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizeVisualEditor,
  compileVisualEditCss,
  createVisualEditOperation,
  validateVisualEditOperation,
  type VisualEditOperationInput
} from '../src/shared/visual-editor'

function operation(overrides: Partial<VisualEditOperationInput> = {}): VisualEditOperationInput {
  return {
    target: {
      selector: '.hero > .cta',
      metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true }
    },
    property: 'padding',
    before: '12px 16px',
    after: '16px 22px',
    scope: { kind: 'mobile' },
    route: { kind: 'current', path: '/index.html' },
    ...overrides
  }
}

test('normalise une modification visuelle et produit une media query déterministe', () => {
  const edit = createVisualEditOperation(operation())
  const compiled = compileVisualEditCss([edit])
  assert.equal(compiled.invalid.length, 0)
  assert.equal(compiled.conflicts.length, 0)
  assert.match(compiled.css, /@media \(max-width: 767px\)/)
  assert.match(compiled.css, /\.hero > \.cta/)
  assert.match(compiled.css, /padding: 16px 22px !important/)
  assert.match(compiled.css, /route \/index\.html/)
})

test('la preview ne compile que les réglages de la route active', () => {
  const home = createVisualEditOperation(operation({ after: '18px', route: { kind: 'current', path: '/index.html' } }))
  const journal = createVisualEditOperation(operation({ after: '30px', route: { kind: 'current', path: '/journal.html' } }))
  const global = createVisualEditOperation(operation({ property: 'border-radius', after: '12px', route: { kind: 'all' } }))
  const homePreview = compileVisualEditCss([home, journal, global], '/index.html#navigation')
  assert.match(homePreview.css, /padding: 18px !important/)
  assert.doesNotMatch(homePreview.css, /padding: 30px !important/)
  assert.match(homePreview.css, /border-radius: 12px/)
  const journalPreview = compileVisualEditCss([home, journal, global], '/journal.html?mode=compact')
  assert.match(journalPreview.css, /padding: 30px !important/)
  assert.doesNotMatch(journalPreview.css, /padding: 18px !important/)
})

test('refuse les valeurs capables de charger une ressource ou d’injecter une règle', () => {
  for (const after of ['url(https://example.test/a.png)', 'u\\72l(https://example.test/a.png)', 'image-set("https://example.test/a.png")', '@import "evil.css"', 'red; display:none', 'expression(alert(1))', 'javascript:alert(1)']) {
    const result = validateVisualEditOperation(operation({ after }))
    assert.equal(result.valid, false, after)
  }
})

test('refuse les groupes de sélecteurs qui pourraient sortir d’une portée de route', () => {
  assert.equal(validateVisualEditOperation(operation({ target: { selector: '.carte, body', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true } } })).valid, false)
})

test('refuse une cible ambiguë tant que la modification groupée n’est pas confirmée', () => {
  const result = validateVisualEditOperation(operation({
    target: { selector: '.card', metadata: { matchCount: 4, selectionMode: 'matching', stable: true, editable: true } }
  }))
  assert.equal(result.valid, false)
  const confirmed = validateVisualEditOperation(operation({
    target: { selector: '.card', metadata: { matchCount: 4, selectionMode: 'matching', stable: true, editable: true, multipleConfirmed: true } }
  }))
  assert.equal(confirmed.valid, true)
})

test('garde les cibles Shadow DOM et cross-origin en inspection seule', () => {
  assert.equal(validateVisualEditOperation(operation({
    target: { selector: 'photo-card >>> button', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true, insideShadowRoot: true } }
  })).valid, false)
  assert.equal(validateVisualEditOperation(operation({
    target: { selector: 'iframe', metadata: { matchCount: 1, selectionMode: 'single', stable: true, editable: true, crossOrigin: true } }
  })).valid, false)
})

test('signale les conflits et regroupe les doublons sans laisser gagner le dernier', () => {
  const first = createVisualEditOperation(operation({ after: '12px' }))
  const duplicate = { ...first, id: 'visual-deadbeef' }
  const duplicateResult = compileVisualEditCss([first, duplicate])
  assert.equal(duplicateResult.operations.length, 1)
  assert.deepEqual(duplicateResult.skipped, ['visual-deadbeef'])
  const conflict = createVisualEditOperation(operation({ after: '20px' }))
  const conflictResult = compileVisualEditCss([first, conflict])
  assert.equal(conflictResult.operations.length, 0)
  assert.equal(conflictResult.conflicts.length, 1)
})

test('borne et valide une plage personnalisée', () => {
  const edit = createVisualEditOperation(operation({ scope: { kind: 'custom', minWidth: 500, maxWidth: 880 } }))
  assert.match(compileVisualEditCss([edit]).css, /min-width: 500px.*max-width: 880px/s)
  assert.throws(() => createVisualEditOperation(operation({ scope: { kind: 'custom', minWidth: 1_200, maxWidth: 700 } })), /inversée/)
})

test('autorise seulement les projets qui possèdent des sources locales', () => {
  assert.equal(authorizeVisualEditor({ sourceKind: 'local-project', readOnly: false, localRoot: '/tmp/site' }).strategy, 'managed-css')
  assert.equal(authorizeVisualEditor({ sourceKind: 'linked-localhost', readOnly: false, localRoot: '/tmp/site' }).strategy, 'export-only')
  assert.equal(authorizeVisualEditor({ sourceKind: 'remote-url', readOnly: true, localRoot: null }).allowed, false)
})
