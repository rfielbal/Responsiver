export const ONBOARDING_PREFERENCE_KEY = 'responsiver.onboarding.v1.hidden'

export interface OnboardingStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function browserStorage(storage?: OnboardingStorage): OnboardingStorage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function isOnboardingHidden(storage?: OnboardingStorage): boolean {
  const target = browserStorage(storage)
  if (!target) return false
  try {
    return target.getItem(ONBOARDING_PREFERENCE_KEY) === 'true'
  } catch {
    return false
  }
}

export function persistOnboardingHidden(hidden: boolean, storage?: OnboardingStorage): boolean {
  const target = browserStorage(storage)
  if (!target) return false
  try {
    if (hidden) target.setItem(ONBOARDING_PREFERENCE_KEY, 'true')
    else target.removeItem(ONBOARDING_PREFERENCE_KEY)
    return true
  } catch {
    return false
  }
}
