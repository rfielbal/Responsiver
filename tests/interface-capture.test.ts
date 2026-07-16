import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampInterfaceCaptureRegion,
  normalizeCaptureScaleFactor,
  normalizeInterfaceCaptureRequest,
  sanitizeInterfaceCaptureName
} from '../src/main/interface-capture.ts'

test('la capture recadre un rectangle CSS fractionnaire dans la zone visible', () => {
  assert.deepEqual(
    clampInterfaceCaptureRegion({ x: -3.2, y: 10.4, width: 805.1, height: 700 }, { width: 800, height: 600 }),
    { x: 0, y: 10, width: 800, height: 590 }
  )
})

test('la capture refuse les rectangles vides, hors écran ou démesurés', () => {
  assert.equal(clampInterfaceCaptureRegion({ x: 900, y: 0, width: 20, height: 20 }, { width: 800, height: 600 }), null)
  assert.equal(clampInterfaceCaptureRegion({ x: 0, y: 0, width: 0, height: 20 }, { width: 800, height: 600 }), null)
  assert.equal(clampInterfaceCaptureRegion({ x: Number.NaN, y: 0, width: 20, height: 20 }, { width: 800, height: 600 }), null)
  assert.equal(clampInterfaceCaptureRegion({ x: 0, y: 0, width: 100_001, height: 20 }, { width: 800, height: 600 }), null)
})

test('le nom de capture reste un simple fichier PNG borné', () => {
  assert.equal(sanitizeInterfaceCaptureName('../../Studio: mobile?.PNG'), 'Studio- mobile.png')
  assert.equal(sanitizeInterfaceCaptureName('\u0000...'), 'responsiver-studio.png')
  assert.ok(sanitizeInterfaceCaptureName('a'.repeat(300)).length <= 100)
})

test('la requête IPC normalise le rectangle et rejette les formes inattendues', () => {
  assert.deepEqual(
    normalizeInterfaceCaptureRequest(
      { region: { x: 12, y: 24, width: 320, height: 480 }, suggestedName: 'Planche responsive' },
      { width: 500, height: 500 }
    ),
    { region: { x: 12, y: 24, width: 320, height: 476 }, suggestedName: 'Planche responsive.png' }
  )
  assert.equal(normalizeInterfaceCaptureRequest({ region: {}, suggestedName: 'x' }, { width: 500, height: 500 }), null)
  assert.equal(normalizeInterfaceCaptureRequest({ region: { x: 0, y: 0, width: 10, height: 10 }, suggestedName: 4 }, { width: 500, height: 500 }), null)
})

test('le facteur de densité utilisé pour encoder le PNG reste sûr', () => {
  assert.equal(normalizeCaptureScaleFactor(2), 2)
  assert.equal(normalizeCaptureScaleFactor(8), 4)
  assert.equal(normalizeCaptureScaleFactor(0.5), 1)
  assert.equal(normalizeCaptureScaleFactor(Number.NaN), 1)
})
