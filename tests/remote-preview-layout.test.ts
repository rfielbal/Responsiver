import assert from 'node:assert/strict'
import test from 'node:test'
import { intersectRemoteClipBounds } from '../src/renderer/src/RemotePreview.tsx'

test('la découpe distante cumule la fenêtre et les conteneurs qui masquent le débordement', () => {
  assert.deepEqual(intersectRemoteClipBounds(
    { left: -40, top: 20, right: 1_120, bottom: 900 },
    [
      { rectangle: { left: 0, top: 0, right: 1_000, bottom: 760 }, horizontal: true, vertical: true },
      { rectangle: { left: 120, top: 80, right: 920, bottom: 700 }, horizontal: true, vertical: true }
    ]
  ), { left: 120, top: 80, right: 920, bottom: 700 })
})

test('la découpe respecte indépendamment les axes overflow-x et overflow-y', () => {
  assert.deepEqual(intersectRemoteClipBounds(
    { left: 10, top: 20, right: 810, bottom: 620 },
    [
      { rectangle: { left: 100, top: 400, right: 700, bottom: 500 }, horizontal: true, vertical: false },
      { rectangle: { left: 400, top: 80, right: 500, bottom: 560 }, horizontal: false, vertical: true }
    ]
  ), { left: 100, top: 80, right: 700, bottom: 560 })
})

test('une vue totalement hors de la zone peinte est masquée', () => {
  assert.equal(intersectRemoteClipBounds(
    { left: 900, top: 40, right: 1_100, bottom: 500 },
    [{ rectangle: { left: 0, top: 0, right: 800, bottom: 700 }, horizontal: true, vertical: true }]
  ), null)
})

test('une géométrie invalide ne produit jamais de clip natif', () => {
  assert.equal(intersectRemoteClipBounds(
    { left: Number.NaN, top: 0, right: 800, bottom: 700 },
    []
  ), null)
})
