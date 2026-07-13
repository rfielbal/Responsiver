import assert from 'node:assert/strict'
import test from 'node:test'

import { isOnboardingHidden, ONBOARDING_PREFERENCE_KEY, persistOnboardingHidden, type OnboardingStorage } from '../src/renderer/src/onboarding'

function memoryStorage(initial: Record<string, string> = {}): OnboardingStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) }
  }
}

test('le guide reste visible tant que la préférence versionnée est absente', () => {
  assert.equal(isOnboardingHidden(memoryStorage()), false)
})

test('la préférence du guide peut être activée puis révoquée', () => {
  const storage = memoryStorage()
  assert.equal(persistOnboardingHidden(true, storage), true)
  assert.equal(storage.values.get(ONBOARDING_PREFERENCE_KEY), 'true')
  assert.equal(isOnboardingHidden(storage), true)

  assert.equal(persistOnboardingHidden(false, storage), true)
  assert.equal(storage.values.has(ONBOARDING_PREFERENCE_KEY), false)
  assert.equal(isOnboardingHidden(storage), false)
})

test('une ancienne valeur ou un stockage indisponible ne masque pas le guide', () => {
  const storage = memoryStorage({ [ONBOARDING_PREFERENCE_KEY]: 'false' })
  assert.equal(isOnboardingHidden(storage), false)
  const unavailable: OnboardingStorage = {
    getItem: () => { throw new Error('indisponible') },
    setItem: () => { throw new Error('indisponible') },
    removeItem: () => { throw new Error('indisponible') }
  }
  assert.equal(isOnboardingHidden(unavailable), false)
  assert.equal(persistOnboardingHidden(true, unavailable), false)
})
