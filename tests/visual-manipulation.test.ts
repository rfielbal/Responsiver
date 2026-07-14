import assert from 'node:assert/strict'
import test from 'node:test'

import type { VisualGestureCommit } from '../src/shared/contracts'
import { compileVisualEditCss } from '../src/shared/visual-editor'
import {
  mergeVisualGestureOperations,
  rebaseVisualGestureChangesAfterRejection,
  rollbackVisualGestureOperations,
  sanitizeVisualGestureCommit,
  visualGestureOperationChanges,
  visualGestureOperations
} from '../src/shared/visual-manipulation'

function target(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selector: '.hero > .hero-copy',
    tag: 'div',
    classes: ['hero-copy'],
    rect: { x: 24, y: 80, width: 320, height: 180 },
    styles: { translate: 'none', width: '320px' },
    occurrences: 1,
    route: '/index.html',
    text: 'contenu privé qui ne doit pas remonter',
    role: 'region',
    ariaLabel: 'secret',
    editable: true,
    insideFrame: false,
    ...overrides
  }
}

function gesture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: 1,
    sessionId: 'session-12345678',
    documentId: 'document-12345678',
    revision: 3,
    gestureId: 'gesture-12345678',
    kind: 'move',
    strategy: 'flow-translate',
    mutations: [{ target: target(), property: 'translate', before: 'none', after: '18px -6px' }],
    warning: 'flow-preserved',
    ...overrides
  }
}

test('assainit un déplacement direct sans conserver le contenu de la page', () => {
  const result = sanitizeVisualGestureCommit(gesture({ mutations: [{ target: target({ route: '/index.html?token=secret#profil' }), property: 'translate', before: 'none', after: '18px -6px' }] }))
  assert.ok(result)
  assert.equal(result.mutations[0].target.text, '')
  assert.equal(result.mutations[0].target.role, null)
  assert.equal(result.mutations[0].target.ariaLabel, null)
  assert.equal(result.mutations[0].target.route, '/index.html')
  assert.doesNotMatch(JSON.stringify(result), /secret|profil/)
  const operations = visualGestureOperations(result, { scope: { kind: 'mobile' }, route: { kind: 'current', path: '/index.html' } })
  assert.equal(operations.length, 1)
  const css = compileVisualEditCss(operations).css
  assert.match(css, /@media \(max-width: 767px\)/)
  assert.match(css, /translate: 18px -6px !important/)
  assert.match(css, /route \/index\.html/)
})

test('convertit un redimensionnement libre en un lot exact et borné par le viewport', () => {
  const result = sanitizeVisualGestureCommit(gesture({
    kind: 'resize',
    strategy: 'responsive-size',
    mutations: [
      { target: target(), property: 'display', before: 'inline', after: 'inline-block' },
      { target: target(), property: 'box-sizing', before: 'content-box', after: 'border-box' },
      { target: target(), property: 'min-width', before: '340px', after: '0' },
      { target: target(), property: 'max-width', before: '260px', after: 'none' },
      { target: target(), property: 'width', before: '320px', after: 'min(280px, calc(100vw - 8px))' },
      { target: target(), property: 'flex-basis', before: '0%', after: 'min(280px, calc(100vw - 8px))' },
      { target: target(), property: 'flex-grow', before: '1', after: '0' },
      { target: target(), property: 'flex-shrink', before: '1', after: '0' },
      { target: target(), property: 'max-height', before: '200px', after: 'none' },
      { target: target(), property: 'min-height', before: '0', after: '220px' },
      { target: target(), property: 'height', before: '180px', after: '220px' }
    ],
    warning: 'fixed-height'
  }))
  assert.ok(result)
  const operations = visualGestureOperations(result, { scope: { kind: 'tablet' }, route: { kind: 'all' } })
  assert.deepEqual(operations.map((entry) => entry.property), ['display', 'box-sizing', 'min-width', 'max-width', 'width', 'flex-basis', 'flex-grow', 'flex-shrink', 'max-height', 'min-height', 'height'])
  const css = compileVisualEditCss(operations).css
  assert.match(css, /min-width: 768px.*max-width: 1024px/s)
  assert.match(css, /width: min\(280px, calc\(100vw - 8px\)\) !important/)
})

test('la portée forgée par la page est ignorée au profit de celle de l’interface', () => {
  const result = sanitizeVisualGestureCommit({ ...gesture(), scope: { kind: 'all' }, route: { kind: 'all' } })
  assert.ok(result)
  const [operation] = visualGestureOperations(result as VisualGestureCommit, { scope: { kind: 'mobile' }, route: { kind: 'current', path: '/journal.html' } })
  assert.deepEqual(operation.scope, { kind: 'mobile' })
  assert.deepEqual(operation.route, { kind: 'current', path: '/journal.html' })
})

test('refuse les cibles ambiguës et les propriétés étrangères à la stratégie', () => {
  assert.equal(sanitizeVisualGestureCommit(gesture({ mutations: [{ target: target({ occurrences: 2 }), property: 'translate', before: 'none', after: '10px 0px' }] })), null)
  assert.equal(sanitizeVisualGestureCommit(gesture({ mutations: [{ target: target(), property: 'background-image', before: 'none', after: 'none' }] })), null)
  assert.equal(sanitizeVisualGestureCommit(gesture({ strategy: 'responsive-size' })), null)
})

test('retire une ancienne surcharge lorsqu’un geste revient exactement à la valeur source', () => {
  const initial = sanitizeVisualGestureCommit(gesture())
  const reset = sanitizeVisualGestureCommit(gesture({
    revision: 4,
    gestureId: 'gesture-reset-12345678',
    mutations: [{ target: target(), property: 'translate', before: '18px -6px', after: '0px 0px' }]
  }))
  assert.ok(initial)
  assert.ok(reset)
  const context = { scope: { kind: 'mobile' } as const, route: { kind: 'current', path: '/index.html' } as const }
  const current = visualGestureOperations(initial, context)
  const unrelated = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    kind: 'resize',
    strategy: 'responsive-size',
    gestureId: 'gesture-width-12345678',
    mutations: [{ target: target(), property: 'width', before: '320px', after: 'min(280px, 100%)' }]
  }))!, context)
  const unchanged = mergeVisualGestureOperations([...current, ...unrelated], visualGestureOperations(initial, context))
  assert.strictEqual(unchanged[0], current[0])
  assert.strictEqual(unchanged[1], unrelated[0])
  const batch = visualGestureOperations(reset, context)
  assert.equal(mergeVisualGestureOperations(current, batch).length, 0)
})

test('annule un geste rejeté sans perdre une modification ultérieure indépendante', () => {
  const context = { scope: { kind: 'mobile' } as const, route: { kind: 'current', path: '/index.html' } as const }
  const initial = visualGestureOperations(sanitizeVisualGestureCommit(gesture())!, context)
  const resize = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    kind: 'resize',
    strategy: 'responsive-size',
    gestureId: 'gesture-rejected-12345678',
    mutations: [{ target: target(), property: 'width', before: '320px', after: 'min(280px, 100%)' }]
  }))!, context)
  const afterRejectedGesture = mergeVisualGestureOperations(initial, resize)
  const changes = visualGestureOperationChanges(initial, afterRejectedGesture, resize)
  const later = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    gestureId: 'gesture-later-12345678',
    mutations: [{ target: target({ selector: '.footer' }), property: 'translate', before: 'none', after: '4px 0px' }]
  }))!, context)
  const withLaterChange = mergeVisualGestureOperations(afterRejectedGesture, later)
  const rolledBack = rollbackVisualGestureOperations(withLaterChange, changes)
  assert.deepEqual(rolledBack.map((operation) => [operation.target.selector, operation.property, operation.after]), [
    ['.hero > .hero-copy', 'translate', '18px -6px'],
    ['.footer', 'translate', '4px 0px']
  ])
})

test('préserve une valeur plus récente sur la même propriété lors d’un rejet tardif', () => {
  const context = { scope: { kind: 'mobile' } as const, route: { kind: 'current', path: '/index.html' } as const }
  const initial = visualGestureOperations(sanitizeVisualGestureCommit(gesture())!, context)
  const rejected = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    gestureId: 'gesture-rejected-12345678',
    mutations: [{ target: target(), property: 'translate', before: '18px -6px', after: '24px -6px' }]
  }))!, context)
  const afterRejectedGesture = mergeVisualGestureOperations(initial, rejected)
  const changes = visualGestureOperationChanges(initial, afterRejectedGesture, rejected)
  const newer = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    gestureId: 'gesture-newer-12345678',
    mutations: [{ target: target(), property: 'translate', before: '24px -6px', after: '32px 2px' }]
  }))!, context)
  const latest = mergeVisualGestureOperations(afterRejectedGesture, newer)
  assert.deepEqual(rollbackVisualGestureOperations(latest, changes), latest)
})

test('deux rejets tardifs successifs reviennent à la dernière base validée', () => {
  const context = { scope: { kind: 'mobile' } as const, route: { kind: 'current', path: '/index.html' } as const }
  const source: ReturnType<typeof visualGestureOperations> = []
  const firstBatch = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    gestureId: 'gesture-first-pending',
    mutations: [{ target: target(), property: 'translate', before: 'none', after: '10px 0px' }]
  }))!, context)
  const afterFirst = mergeVisualGestureOperations(source, firstBatch)
  const firstChanges = visualGestureOperationChanges(source, afterFirst, firstBatch)
  const secondBatch = visualGestureOperations(sanitizeVisualGestureCommit(gesture({
    gestureId: 'gesture-second-pending',
    mutations: [{ target: target(), property: 'translate', before: '10px 0px', after: '20px 0px' }]
  }))!, context)
  const afterSecond = mergeVisualGestureOperations(afterFirst, secondBatch)
  const secondChanges = visualGestureOperationChanges(afterFirst, afterSecond, secondBatch)
  const rebasedSecond = rebaseVisualGestureChangesAfterRejection(secondChanges, firstChanges)
  assert.deepEqual(rollbackVisualGestureOperations(afterSecond, rebasedSecond), source)
})
