import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_DEVICE_SUITE_ID,
  DEFAULT_DEVICE_SUITES,
  DEVICE_CATALOG,
  DEVICE_DPR_LIMITS,
  DEVICE_HEIGHT_LIMITS,
  DEVICE_WIDTH_LIMITS,
  MAX_ACTIVE_DEVICES,
  MAX_DEVICE_CATALOG_IMPORT_BYTES,
  allDeviceProfiles,
  createCustomDeviceProfile,
  createDefaultDeviceCatalogState,
  createDeviceSuite,
  findDeviceProfile,
  normalizeDeviceCatalogState,
  normalizeDeviceSuite,
  parseDeviceCatalogState,
  serializeDeviceCatalogState,
  validateCustomDeviceProfile
} from '../src/shared/device-catalog'
import { CANONICAL_MATRIX_DEVICES } from '../src/shared/device-profiles'

test('le catalogue curaté couvre les principales familles sans doublon', () => {
  assert.ok(DEVICE_CATALOG.length >= 60)
  assert.equal(new Set(DEVICE_CATALOG.map((profile) => profile.id)).size, DEVICE_CATALOG.length)
  assert.deepEqual(new Set(DEVICE_CATALOG.map((profile) => profile.category)), new Set(['phone', 'tablet', 'foldable', 'laptop', 'desktop']))

  for (const brand of ['Apple', 'Google', 'Samsung', 'Microsoft']) {
    assert.ok(DEVICE_CATALOG.some((profile) => profile.brand === brand), `${brand} doit être représenté`)
  }
  for (const profile of DEVICE_CATALOG) {
    assert.match(profile.id, /^[a-z0-9][a-z0-9-]+$/)
    assert.ok(profile.name && profile.family && profile.brand)
    assert.ok(profile.width >= DEVICE_WIDTH_LIMITS.min && profile.width <= DEVICE_WIDTH_LIMITS.max)
    assert.ok(profile.height >= DEVICE_HEIGHT_LIMITS.min && profile.height <= DEVICE_HEIGHT_LIMITS.max)
    assert.ok(profile.dpr >= DEVICE_DPR_LIMITS.min && profile.dpr <= DEVICE_DPR_LIMITS.max)
    assert.equal(profile.source, 'catalog')
  }
})

test('le catalogue exploratoire reste indépendant des profils canoniques de la Matrice', () => {
  const catalogIds = new Set(DEVICE_CATALOG.map((profile) => profile.id))
  for (const canonical of CANONICAL_MATRIX_DEVICES) assert.equal(catalogIds.has(canonical.id), false)
})

test('les suites intégrées utilisent de un à cinq appareils connus', () => {
  const ids = new Set(DEVICE_CATALOG.map((profile) => profile.id))
  assert.ok(DEFAULT_DEVICE_SUITES.length >= 3)
  assert.ok(DEFAULT_DEVICE_SUITES.some((suite) => suite.deviceIds.length === MAX_ACTIVE_DEVICES))
  for (const suite of DEFAULT_DEVICE_SUITES) {
    assert.ok(suite.deviceIds.length >= 1 && suite.deviceIds.length <= MAX_ACTIVE_DEVICES)
    assert.equal(new Set(suite.deviceIds).size, suite.deviceIds.length)
    assert.ok(suite.deviceIds.every((id) => ids.has(id)))
    assert.equal(suite.builtIn, true)
  }
})

test('crée un appareil personnalisé borné, nettoyé et déterministe', () => {
  const input = {
    name: '  Écran\u0000 test  ',
    category: 'tablet' as const,
    width: 912,
    height: 1368,
    dpr: 1.5,
    tags: ['Prototype', 'prototype', ' tactile ']
  }
  const first = createCustomDeviceProfile(input)
  const second = createCustomDeviceProfile(input)
  assert.equal(first.id, second.id)
  assert.match(first.id, /^custom-ecran-test-/)
  assert.equal(first.name, 'Écran test')
  assert.equal(first.family, 'Écran test')
  assert.equal(first.brand, 'Personnalisé')
  assert.equal(first.touch, true)
  assert.equal(first.mobile, true)
  assert.equal(first.rotatable, true)
  assert.deepEqual(first.tags, ['Prototype', 'tactile'])
})

test('refuse les dimensions, DPR et types dangereux', () => {
  assert.throws(() => createCustomDeviceProfile({ name: 'Trop petit', category: 'phone', width: 120, height: 800 }), /largeur/)
  assert.throws(() => createCustomDeviceProfile({ name: 'DPR', category: 'desktop', width: 1920, height: 1080, dpr: 10 }), /DPR/)
  assert.ok(validateCustomDeviceProfile({ name: 'Invalide', category: 'console', width: 800, height: 600, touch: 'oui' }).length >= 2)
})

test('normalise une suite, dédoublonne ses appareils et la limite à cinq vues', () => {
  const ids = DEVICE_CATALOG.slice(0, 7).map((profile) => profile.id)
  const suite = normalizeDeviceSuite({
    name: '  Ma couverture  ',
    deviceIds: [ids[0], ids[0], ...ids.slice(1), 'inconnu']
  })
  assert.ok(suite)
  assert.equal(suite.name, 'Ma couverture')
  assert.equal(suite.deviceIds.length, MAX_ACTIVE_DEVICES)
  assert.equal(new Set(suite.deviceIds).size, MAX_ACTIVE_DEVICES)
  assert.equal(suite.builtIn, false)
  assert.throws(() => createDeviceSuite({ name: 'Vide', deviceIds: ['inconnu'] }), /entre 1 et 5/)
})

test('normalise une persistance hostile sans perdre les suites intégrées', () => {
  const custom = createCustomDeviceProfile({
    id: 'custom-studio-portrait', name: 'Studio portrait', category: 'phone', width: 420, height: 900
  })
  const state = normalizeDeviceCatalogState({
    version: 1,
    customDevices: [custom, custom, { name: 'Cassé', category: 'phone', width: -1, height: 2 }],
    suites: [
      DEFAULT_DEVICE_SUITES[0],
      { id: 'suite-studio-personal', name: 'Studio', deviceIds: [custom.id, 'apple-iphone-15', custom.id, 'inconnu'] },
      { id: 'suite-empty-personal', name: 'Vide', deviceIds: ['inconnu'] }
    ],
    activeSuiteId: 'suite-studio-personal'
  })
  assert.equal(state.customDevices.length, 1)
  assert.equal(state.suites.filter((suite) => suite.builtIn).length, DEFAULT_DEVICE_SUITES.length)
  const personal = state.suites.find((suite) => suite.id === 'suite-studio-personal')
  assert.deepEqual(personal?.deviceIds, [custom.id, 'apple-iphone-15'])
  assert.equal(state.activeSuiteId, 'suite-studio-personal')
  assert.equal(allDeviceProfiles(state).length, DEVICE_CATALOG.length + 1)
  assert.equal(findDeviceProfile(custom.id, state)?.name, custom.name)
})

test('répare une suite active manquante avec la suite essentielle', () => {
  const state = normalizeDeviceCatalogState({ version: 1, customDevices: [], suites: [], activeSuiteId: 'suite-disparue' })
  assert.equal(state.activeSuiteId, DEFAULT_DEVICE_SUITE_ID)
  assert.equal(state.suites.length, DEFAULT_DEVICE_SUITES.length)
})

test('sérialise uniquement les données personnelles puis les réhydrate', () => {
  const custom = createCustomDeviceProfile({
    id: 'custom-kiosk-landscape', name: 'Borne paysage', category: 'desktop', width: 1600, height: 900, touch: true
  })
  const customSuite = createDeviceSuite(
    { id: 'suite-kiosk-personal', name: 'Borne', deviceIds: [custom.id, 'desktop-full-hd'] },
    [...DEVICE_CATALOG.map((profile) => profile.id), custom.id]
  )
  const state = {
    ...createDefaultDeviceCatalogState(),
    customDevices: [custom],
    suites: [...DEFAULT_DEVICE_SUITES, customSuite],
    activeSuiteId: customSuite.id
  }
  const serialized = serializeDeviceCatalogState(state)
  const raw = JSON.parse(serialized) as { suites: Array<{ builtIn?: boolean }> }
  assert.equal(raw.suites.length, 1)
  assert.equal(raw.suites[0].builtIn, false)

  const imported = parseDeviceCatalogState(serialized)
  assert.equal(imported.ok, true)
  assert.equal(imported.error, null)
  assert.equal(imported.state.customDevices.length, 1)
  assert.equal(imported.state.suites.length, DEFAULT_DEVICE_SUITES.length + 1)
  assert.equal(imported.state.activeSuiteId, customSuite.id)
})

test('un import corrompu, futur ou trop volumineux échoue sans état partiel', () => {
  for (const serialized of [
    '{pas du json',
    JSON.stringify({ version: 99 }),
    ' '.repeat(MAX_DEVICE_CATALOG_IMPORT_BYTES + 1)
  ]) {
    const result = parseDeviceCatalogState(serialized)
    assert.equal(result.ok, false)
    assert.equal(result.state.activeSuiteId, DEFAULT_DEVICE_SUITE_ID)
    assert.equal(result.state.customDevices.length, 0)
    assert.ok(result.error)
  }
})

test('un import valide signale et ignore les entrées invalides', () => {
  const result = parseDeviceCatalogState(JSON.stringify({
    version: 1,
    customDevices: [{ id: 'custom-bad-entry', name: '', category: 'phone', width: 390, height: 844 }],
    suites: [{ id: 'suite-bad-entry', name: 'Inconnus', deviceIds: ['absent'] }],
    activeSuiteId: 'suite-bad-entry'
  }))
  assert.equal(result.ok, true)
  assert.equal(result.state.customDevices.length, 0)
  assert.equal(result.state.activeSuiteId, DEFAULT_DEVICE_SUITE_ID)
  assert.ok(result.warnings.length >= 2)
})
