import assert from 'node:assert/strict'
import test from 'node:test'
import { clampPreviewScale, stepPreviewScale, wheelPreviewScale, zoomPercentage } from '../src/renderer/src/preview-zoom.ts'

test('le zoom de preview reste borné entre 10 et 200 %', () => {
  assert.equal(clampPreviewScale(-5), 0.1)
  assert.equal(clampPreviewScale(7), 2)
  assert.equal(clampPreviewScale(Number.NaN, 0.7), 0.7)
  assert.equal(zoomPercentage(0.734), 73)
})

test('les commandes de zoom avancent par pas lisibles', () => {
  assert.equal(stepPreviewScale(0.7, 1), 0.8)
  assert.equal(stepPreviewScale(0.7, -1), 0.6)
  assert.equal(stepPreviewScale(2, 1), 2)
  assert.equal(stepPreviewScale(0.1, -1), 0.1)
})

test('Cmd/Ctrl + molette respecte la direction et normalise les lignes', () => {
  assert.ok(wheelPreviewScale(1, -100) > 1)
  assert.ok(wheelPreviewScale(1, 100) < 1)
  assert.ok(wheelPreviewScale(1, -3, 1) > 1)
  assert.equal(wheelPreviewScale(0.65, 0), 0.65)
})
