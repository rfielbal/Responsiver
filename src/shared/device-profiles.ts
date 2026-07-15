export interface CanonicalDeviceProfile {
  id: 'mobile' | 'tablet' | 'desktop'
  name: string
  width: number
  height: number
  mobile: boolean
  touch: boolean
}

/** Profils peu nombreux et stables utilisés par les vérifications reproductibles. */
export const CANONICAL_MATRIX_DEVICES: readonly CanonicalDeviceProfile[] = Object.freeze([
  { id: 'mobile', name: 'Mobile', width: 393, height: 852, mobile: true, touch: true },
  { id: 'tablet', name: 'Tablette', width: 768, height: 1024, mobile: true, touch: true },
  { id: 'desktop', name: 'Bureau', width: 1440, height: 900, mobile: false, touch: false }
])

export function canonicalMatrixDevice(id: string): CanonicalDeviceProfile | null {
  return CANONICAL_MATRIX_DEVICES.find((device) => device.id === id) ?? null
}

