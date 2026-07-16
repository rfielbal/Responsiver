export const DEVICE_CATALOG_SCHEMA_VERSION = 1 as const
export const DEVICE_CATALOG_STORAGE_KEY = 'responsiver.device-catalog.v1'
export const MAX_ACTIVE_DEVICES = 5
export const MAX_CUSTOM_DEVICES = 50
export const MAX_CUSTOM_SUITES = 24
export const MAX_DEVICE_CATALOG_IMPORT_BYTES = 128 * 1024

export const DEVICE_WIDTH_LIMITS = Object.freeze({ min: 240, max: 5120 })
export const DEVICE_HEIGHT_LIMITS = Object.freeze({ min: 240, max: 5120 })
export const DEVICE_DPR_LIMITS = Object.freeze({ min: 0.5, max: 5 })

export type DeviceCategory = 'phone' | 'tablet' | 'foldable' | 'laptop' | 'desktop'
export type DeviceProfileSource = 'catalog' | 'custom'

export interface DeviceProfile {
  id: string
  name: string
  family: string
  category: DeviceCategory
  brand: string
  width: number
  height: number
  dpr: number
  touch: boolean
  mobile: boolean
  rotatable: boolean
  tags: readonly string[]
  source: DeviceProfileSource
}

export interface CustomDeviceProfileInput {
  id?: string
  name: string
  family?: string
  category: DeviceCategory
  brand?: string
  width: number
  height: number
  dpr?: number
  touch?: boolean
  mobile?: boolean
  rotatable?: boolean
  tags?: readonly string[]
}

export interface DeviceSuite {
  id: string
  name: string
  deviceIds: readonly string[]
  builtIn: boolean
}

export interface DeviceSuiteInput {
  id?: string
  name: string
  deviceIds: readonly string[]
}

export interface DeviceCatalogState {
  version: typeof DEVICE_CATALOG_SCHEMA_VERSION
  customDevices: readonly DeviceProfile[]
  /** Contient toujours les suites intégrées, suivies des suites de l’utilisateur. */
  suites: readonly DeviceSuite[]
  activeSuiteId: string
}

export interface DeviceCatalogImportResult {
  ok: boolean
  state: DeviceCatalogState
  warnings: readonly string[]
  error: string | null
}

const CATEGORIES: readonly DeviceCategory[] = ['phone', 'tablet', 'foldable', 'laptop', 'desktop']
const MAX_NAME_LENGTH = 60
const MAX_FAMILY_LENGTH = 48
const MAX_BRAND_LENGTH = 40
const MAX_TAG_LENGTH = 24
const MAX_TAGS = 12

type CatalogProfileInput = Omit<DeviceProfile, 'source' | 'tags'> & { tags?: readonly string[] }

function catalogProfile(input: CatalogProfileInput): DeviceProfile {
  return Object.freeze({
    ...input,
    tags: Object.freeze(uniqueStrings(input.tags ?? []).slice(0, MAX_TAGS)),
    source: 'catalog' as const
  })
}

/**
 * Catalogue éditorial local. Il est volontairement indépendant des trois profils
 * canoniques de la Matrice, dont les dimensions doivent rester stables.
 */
export const DEVICE_CATALOG: readonly DeviceProfile[] = Object.freeze([
  catalogProfile({ id: 'apple-iphone-se-2', name: 'iPhone SE', family: 'iPhone SE', category: 'phone', brand: 'Apple', width: 375, height: 667, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['essentiel', 'compact', 'ios'] }),
  catalogProfile({ id: 'apple-iphone-12-mini', name: 'iPhone 12 mini', family: 'iPhone', category: 'phone', brand: 'Apple', width: 360, height: 780, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['compact', 'ios'] }),
  catalogProfile({ id: 'apple-iphone-13', name: 'iPhone 13', family: 'iPhone', category: 'phone', brand: 'Apple', width: 390, height: 844, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['ios'] }),
  catalogProfile({ id: 'apple-iphone-14', name: 'iPhone 14', family: 'iPhone', category: 'phone', brand: 'Apple', width: 390, height: 844, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['ios'] }),
  catalogProfile({ id: 'apple-iphone-14-plus', name: 'iPhone 14 Plus', family: 'iPhone', category: 'phone', brand: 'Apple', width: 428, height: 926, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['grand', 'ios'] }),
  catalogProfile({ id: 'apple-iphone-14-pro', name: 'iPhone 14 Pro', family: 'iPhone Pro', category: 'phone', brand: 'Apple', width: 393, height: 852, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['ios'] }),
  catalogProfile({ id: 'apple-iphone-15', name: 'iPhone 15', family: 'iPhone', category: 'phone', brand: 'Apple', width: 393, height: 852, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['essentiel', 'ios'] }),
  catalogProfile({ id: 'apple-iphone-15-plus', name: 'iPhone 15 Plus', family: 'iPhone', category: 'phone', brand: 'Apple', width: 430, height: 932, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['grand', 'ios'] }),
  catalogProfile({ id: 'apple-iphone-15-pro', name: 'iPhone 15 Pro', family: 'iPhone Pro', category: 'phone', brand: 'Apple', width: 393, height: 852, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['ios'] }),
  catalogProfile({ id: 'apple-iphone-15-pro-max', name: 'iPhone 15 Pro Max', family: 'iPhone Pro', category: 'phone', brand: 'Apple', width: 430, height: 932, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['grand', 'ios'] }),
  catalogProfile({ id: 'apple-iphone-xr', name: 'iPhone XR', family: 'iPhone', category: 'phone', brand: 'Apple', width: 414, height: 896, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['ios', 'ancien'] }),

  catalogProfile({ id: 'google-pixel-5', name: 'Pixel 5', family: 'Pixel', category: 'phone', brand: 'Google', width: 393, height: 851, dpr: 2.75, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'google-pixel-6', name: 'Pixel 6', family: 'Pixel', category: 'phone', brand: 'Google', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'google-pixel-7', name: 'Pixel 7', family: 'Pixel', category: 'phone', brand: 'Google', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'google-pixel-7a', name: 'Pixel 7a', family: 'Pixel', category: 'phone', brand: 'Google', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'google-pixel-8', name: 'Pixel 8', family: 'Pixel', category: 'phone', brand: 'Google', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['essentiel', 'android'] }),
  catalogProfile({ id: 'google-pixel-8-pro', name: 'Pixel 8 Pro', family: 'Pixel Pro', category: 'phone', brand: 'Google', width: 448, height: 998, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['grand', 'android'] }),
  catalogProfile({ id: 'google-pixel-9', name: 'Pixel 9', family: 'Pixel', category: 'phone', brand: 'Google', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),

  catalogProfile({ id: 'samsung-galaxy-s8', name: 'Galaxy S8', family: 'Galaxy S', category: 'phone', brand: 'Samsung', width: 360, height: 740, dpr: 4, touch: true, mobile: true, rotatable: true, tags: ['compact', 'android', 'ancien'] }),
  catalogProfile({ id: 'samsung-galaxy-s20', name: 'Galaxy S20', family: 'Galaxy S', category: 'phone', brand: 'Samsung', width: 360, height: 800, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-s21', name: 'Galaxy S21', family: 'Galaxy S', category: 'phone', brand: 'Samsung', width: 360, height: 800, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-s22', name: 'Galaxy S22', family: 'Galaxy S', category: 'phone', brand: 'Samsung', width: 360, height: 780, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-s23', name: 'Galaxy S23', family: 'Galaxy S', category: 'phone', brand: 'Samsung', width: 360, height: 780, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-s24', name: 'Galaxy S24', family: 'Galaxy S', category: 'phone', brand: 'Samsung', width: 360, height: 780, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['essentiel', 'android'] }),
  catalogProfile({ id: 'samsung-galaxy-s24-ultra', name: 'Galaxy S24 Ultra', family: 'Galaxy S Ultra', category: 'phone', brand: 'Samsung', width: 384, height: 824, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-a51', name: 'Galaxy A51', family: 'Galaxy A', category: 'phone', brand: 'Samsung', width: 412, height: 914, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-a54', name: 'Galaxy A54', family: 'Galaxy A', category: 'phone', brand: 'Samsung', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-note-20-ultra', name: 'Galaxy Note 20 Ultra', family: 'Galaxy Note', category: 'phone', brand: 'Samsung', width: 412, height: 883, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-m51', name: 'Galaxy M51', family: 'Galaxy M', category: 'phone', brand: 'Samsung', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),

  catalogProfile({ id: 'oneplus-11', name: 'OnePlus 11', family: 'OnePlus', category: 'phone', brand: 'OnePlus', width: 412, height: 919, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'oneplus-nord-2', name: 'OnePlus Nord 2', family: 'OnePlus Nord', category: 'phone', brand: 'OnePlus', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'xiaomi-13', name: 'Xiaomi 13', family: 'Xiaomi', category: 'phone', brand: 'Xiaomi', width: 393, height: 873, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'xiaomi-redmi-note-12', name: 'Redmi Note 12', family: 'Redmi Note', category: 'phone', brand: 'Xiaomi', width: 393, height: 873, dpr: 2.75, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'fairphone-5', name: 'Fairphone 5', family: 'Fairphone', category: 'phone', brand: 'Fairphone', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'nothing-phone-2', name: 'Nothing Phone (2)', family: 'Nothing Phone', category: 'phone', brand: 'Nothing', width: 412, height: 915, dpr: 2.625, touch: true, mobile: true, rotatable: true, tags: ['android'] }),

  catalogProfile({ id: 'apple-ipad-mini-6', name: 'iPad mini', family: 'iPad mini', category: 'tablet', brand: 'Apple', width: 744, height: 1133, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['compact', 'ipados'] }),
  catalogProfile({ id: 'apple-ipad-9', name: 'iPad 9', family: 'iPad', category: 'tablet', brand: 'Apple', width: 810, height: 1080, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['ipados'] }),
  catalogProfile({ id: 'apple-ipad-10', name: 'iPad 10', family: 'iPad', category: 'tablet', brand: 'Apple', width: 820, height: 1180, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['essentiel', 'ipados'] }),
  catalogProfile({ id: 'apple-ipad-air-5', name: 'iPad Air', family: 'iPad Air', category: 'tablet', brand: 'Apple', width: 820, height: 1180, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['ipados'] }),
  catalogProfile({ id: 'apple-ipad-pro-11', name: 'iPad Pro 11″', family: 'iPad Pro', category: 'tablet', brand: 'Apple', width: 834, height: 1194, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['ipados'] }),
  catalogProfile({ id: 'apple-ipad-pro-13', name: 'iPad Pro 13″', family: 'iPad Pro', category: 'tablet', brand: 'Apple', width: 1024, height: 1366, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['grand', 'ipados'] }),
  catalogProfile({ id: 'samsung-galaxy-tab-s8', name: 'Galaxy Tab S8', family: 'Galaxy Tab', category: 'tablet', brand: 'Samsung', width: 800, height: 1280, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'samsung-galaxy-tab-s9', name: 'Galaxy Tab S9', family: 'Galaxy Tab', category: 'tablet', brand: 'Samsung', width: 800, height: 1280, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'google-pixel-tablet', name: 'Pixel Tablet', family: 'Pixel Tablet', category: 'tablet', brand: 'Google', width: 800, height: 1280, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['android'] }),
  catalogProfile({ id: 'microsoft-surface-go-3', name: 'Surface Go 3', family: 'Surface Go', category: 'tablet', brand: 'Microsoft', width: 800, height: 1280, dpr: 1.5, touch: true, mobile: true, rotatable: true, tags: ['windows'] }),
  catalogProfile({ id: 'lenovo-tab-p12', name: 'Lenovo Tab P12', family: 'Lenovo Tab', category: 'tablet', brand: 'Lenovo', width: 960, height: 1440, dpr: 2, touch: true, mobile: true, rotatable: true, tags: ['android'] }),

  catalogProfile({ id: 'samsung-z-flip-5', name: 'Galaxy Z Flip 5', family: 'Galaxy Z Flip', category: 'foldable', brand: 'Samsung', width: 360, height: 880, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['plié', 'android'] }),
  catalogProfile({ id: 'samsung-z-fold-5-cover', name: 'Galaxy Z Fold 5 · externe', family: 'Galaxy Z Fold', category: 'foldable', brand: 'Samsung', width: 344, height: 882, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['externe', 'android'] }),
  catalogProfile({ id: 'samsung-z-fold-5-open', name: 'Galaxy Z Fold 5 · ouvert', family: 'Galaxy Z Fold', category: 'foldable', brand: 'Samsung', width: 884, height: 1104, dpr: 2.5, touch: true, mobile: true, rotatable: true, tags: ['ouvert', 'android'] }),
  catalogProfile({ id: 'google-pixel-fold-open', name: 'Pixel Fold · ouvert', family: 'Pixel Fold', category: 'foldable', brand: 'Google', width: 841, height: 673, dpr: 2.5, touch: true, mobile: true, rotatable: true, tags: ['ouvert', 'android'] }),
  catalogProfile({ id: 'google-pixel-9-pro-fold-open', name: 'Pixel 9 Pro Fold · ouvert', family: 'Pixel Fold', category: 'foldable', brand: 'Google', width: 862, height: 798, dpr: 2.5, touch: true, mobile: true, rotatable: true, tags: ['ouvert', 'android'] }),
  catalogProfile({ id: 'oneplus-open', name: 'OnePlus Open · ouvert', family: 'OnePlus Open', category: 'foldable', brand: 'OnePlus', width: 744, height: 992, dpr: 2.5, touch: true, mobile: true, rotatable: true, tags: ['ouvert', 'android'] }),
  catalogProfile({ id: 'motorola-razr-40', name: 'Motorola Razr 40', family: 'Motorola Razr', category: 'foldable', brand: 'Motorola', width: 384, height: 858, dpr: 3, touch: true, mobile: true, rotatable: true, tags: ['android'] }),

  catalogProfile({ id: 'laptop-hd', name: 'Portable HD', family: 'Portable', category: 'laptop', brand: 'Générique', width: 1366, height: 768, dpr: 1, touch: false, mobile: false, rotatable: false, tags: ['essentiel', 'windows'] }),
  catalogProfile({ id: 'apple-macbook-air-13', name: 'MacBook Air 13″', family: 'MacBook Air', category: 'laptop', brand: 'Apple', width: 1440, height: 900, dpr: 2, touch: false, mobile: false, rotatable: false, tags: ['essentiel', 'macos'] }),
  catalogProfile({ id: 'apple-macbook-pro-14', name: 'MacBook Pro 14″', family: 'MacBook Pro', category: 'laptop', brand: 'Apple', width: 1512, height: 982, dpr: 2, touch: false, mobile: false, rotatable: false, tags: ['macos'] }),
  catalogProfile({ id: 'apple-macbook-pro-16', name: 'MacBook Pro 16″', family: 'MacBook Pro', category: 'laptop', brand: 'Apple', width: 1728, height: 1117, dpr: 2, touch: false, mobile: false, rotatable: false, tags: ['macos'] }),
  catalogProfile({ id: 'microsoft-surface-laptop-5', name: 'Surface Laptop 5', family: 'Surface Laptop', category: 'laptop', brand: 'Microsoft', width: 1536, height: 1024, dpr: 1.5, touch: true, mobile: false, rotatable: false, tags: ['windows'] }),
  catalogProfile({ id: 'microsoft-surface-pro-9', name: 'Surface Pro 9', family: 'Surface Pro', category: 'laptop', brand: 'Microsoft', width: 1368, height: 912, dpr: 2, touch: true, mobile: false, rotatable: true, tags: ['windows', 'hybride'] }),
  catalogProfile({ id: 'desktop-1440', name: 'Bureau 1440', family: 'Bureau', category: 'desktop', brand: 'Générique', width: 1440, height: 900, dpr: 1, touch: false, mobile: false, rotatable: false, tags: ['essentiel'] }),
  catalogProfile({ id: 'desktop-full-hd', name: 'Bureau Full HD', family: 'Bureau', category: 'desktop', brand: 'Générique', width: 1920, height: 1080, dpr: 1, touch: false, mobile: false, rotatable: false, tags: ['full-hd'] }),
  catalogProfile({ id: 'desktop-qhd', name: 'Bureau QHD', family: 'Bureau', category: 'desktop', brand: 'Générique', width: 2560, height: 1440, dpr: 1, touch: false, mobile: false, rotatable: false, tags: ['qhd'] }),
  catalogProfile({ id: 'desktop-ultrawide', name: 'Bureau ultralarge', family: 'Bureau', category: 'desktop', brand: 'Générique', width: 2560, height: 1080, dpr: 1, touch: false, mobile: false, rotatable: false, tags: ['ultralarge'] })
])

export const DEFAULT_DEVICE_SUITES: readonly DeviceSuite[] = Object.freeze([
  Object.freeze({ id: 'suite-essential', name: 'Essentiels', deviceIds: Object.freeze(['apple-iphone-15', 'apple-ipad-10', 'apple-macbook-air-13']), builtIn: true }),
  Object.freeze({ id: 'suite-mobile', name: 'Couverture mobile', deviceIds: Object.freeze(['apple-iphone-se-2', 'apple-iphone-15', 'google-pixel-8', 'samsung-galaxy-s24', 'samsung-z-fold-5-cover']), builtIn: true }),
  Object.freeze({ id: 'suite-cross-platform', name: 'Multi-plateforme', deviceIds: Object.freeze(['apple-iphone-15', 'google-pixel-8', 'samsung-galaxy-s24', 'apple-ipad-10', 'desktop-1440']), builtIn: true }),
  Object.freeze({ id: 'suite-workstations', name: 'Portables et bureaux', deviceIds: Object.freeze(['laptop-hd', 'apple-macbook-air-13', 'apple-macbook-pro-14', 'desktop-full-hd', 'desktop-qhd']), builtIn: true })
])

export const DEFAULT_DEVICE_SUITE_ID = DEFAULT_DEVICE_SUITES[0].id

const BUILT_IN_DEVICE_IDS = new Set(DEVICE_CATALOG.map((profile) => profile.id))
const BUILT_IN_SUITE_IDS = new Set(DEFAULT_DEVICE_SUITES.map((suite) => suite.id))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.toLocaleLowerCase('fr-FR')
    if (!seen.has(key)) {
      seen.add(key)
      result.push(value)
    }
  }
  return result
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value
    .map((tag) => sanitizeText(tag, MAX_TAG_LENGTH))
    .filter(Boolean))
    .slice(0, MAX_TAGS)
}

function isCategory(value: unknown): value is DeviceCategory {
  return typeof value === 'string' && CATEGORIES.includes(value as DeviceCategory)
}

function isBoundedNumber(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
}

function slug(value: string): string {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'appareil'
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function validCustomId(value: unknown): value is string {
  return typeof value === 'string' && /^custom-[a-z0-9][a-z0-9-]{2,56}$/.test(value)
}

function validSuiteId(value: unknown): value is string {
  return typeof value === 'string' && /^suite-[a-z0-9][a-z0-9-]{2,56}$/.test(value)
}

export function validateCustomDeviceProfile(value: unknown): string[] {
  if (!isRecord(value)) return ['Le profil doit être un objet.']
  const errors: string[] = []
  if (!sanitizeText(value.name, MAX_NAME_LENGTH)) errors.push('Le nom est obligatoire.')
  if (!isCategory(value.category)) errors.push('La catégorie est inconnue.')
  if (!isBoundedNumber(value.width, DEVICE_WIDTH_LIMITS.min, DEVICE_WIDTH_LIMITS.max, true)) {
    errors.push(`La largeur doit être un entier compris entre ${DEVICE_WIDTH_LIMITS.min} et ${DEVICE_WIDTH_LIMITS.max} px.`)
  }
  if (!isBoundedNumber(value.height, DEVICE_HEIGHT_LIMITS.min, DEVICE_HEIGHT_LIMITS.max, true)) {
    errors.push(`La hauteur doit être un entier compris entre ${DEVICE_HEIGHT_LIMITS.min} et ${DEVICE_HEIGHT_LIMITS.max} px.`)
  }
  if (value.dpr !== undefined && !isBoundedNumber(value.dpr, DEVICE_DPR_LIMITS.min, DEVICE_DPR_LIMITS.max)) {
    errors.push(`Le DPR doit être compris entre ${DEVICE_DPR_LIMITS.min} et ${DEVICE_DPR_LIMITS.max}.`)
  }
  for (const property of ['touch', 'mobile', 'rotatable'] as const) {
    if (value[property] !== undefined && typeof value[property] !== 'boolean') errors.push(`Le champ ${property} doit être booléen.`)
  }
  if (value.id !== undefined && !validCustomId(value.id)) errors.push('L’identifiant personnalisé est invalide.')
  if (value.tags !== undefined && !Array.isArray(value.tags)) errors.push('Les tags doivent être une liste.')
  return errors
}

export function createCustomDeviceProfile(input: CustomDeviceProfileInput): DeviceProfile {
  const errors = validateCustomDeviceProfile(input)
  if (errors.length) throw new TypeError(errors.join(' '))

  const name = sanitizeText(input.name, MAX_NAME_LENGTH)
  const family = sanitizeText(input.family, MAX_FAMILY_LENGTH) || name
  const brand = sanitizeText(input.brand, MAX_BRAND_LENGTH) || 'Personnalisé'
  const dpr = Math.round((input.dpr ?? 1) * 100) / 100
  const touch = input.touch ?? (input.category !== 'laptop' && input.category !== 'desktop')
  const mobile = input.mobile ?? (input.category === 'phone' || input.category === 'tablet' || input.category === 'foldable')
  const rotatable = input.rotatable ?? input.category !== 'desktop'
  const fingerprint = `${name}|${input.category}|${input.width}|${input.height}|${dpr}`
  const id = input.id ?? `custom-${slug(name)}-${stableHash(fingerprint)}`
  if (BUILT_IN_DEVICE_IDS.has(id)) throw new TypeError('Cet identifiant est réservé au catalogue intégré.')

  return {
    id,
    name,
    family,
    category: input.category,
    brand,
    width: input.width,
    height: input.height,
    dpr,
    touch,
    mobile,
    rotatable,
    tags: normalizeTags(input.tags),
    source: 'custom'
  }
}

function customDeviceFromUnknown(value: unknown): DeviceProfile | null {
  if (!isRecord(value)) return null
  try {
    return createCustomDeviceProfile({
      id: value.id as string | undefined,
      name: value.name as string,
      family: value.family as string | undefined,
      category: value.category as DeviceCategory,
      brand: value.brand as string | undefined,
      width: value.width as number,
      height: value.height as number,
      dpr: value.dpr as number | undefined,
      touch: value.touch as boolean | undefined,
      mobile: value.mobile as boolean | undefined,
      rotatable: value.rotatable as boolean | undefined,
      tags: value.tags as readonly string[] | undefined
    })
  } catch {
    return null
  }
}

function normalizeAvailableIds(availableDeviceIds: Iterable<string>): Set<string> {
  return new Set([...availableDeviceIds].filter((id) => typeof id === 'string'))
}

export function normalizeDeviceSuite(value: unknown, availableDeviceIds: Iterable<string> = BUILT_IN_DEVICE_IDS): DeviceSuite | null {
  if (!isRecord(value)) return null
  const name = sanitizeText(value.name, MAX_NAME_LENGTH)
  if (!name || !Array.isArray(value.deviceIds)) return null

  const available = normalizeAvailableIds(availableDeviceIds)
  const deviceIds = uniqueStrings(value.deviceIds
    .filter((id): id is string => typeof id === 'string' && available.has(id)))
    .slice(0, MAX_ACTIVE_DEVICES)
  if (!deviceIds.length) return null

  const generatedId = `suite-${slug(name)}-${stableHash(`${name}|${deviceIds.join('|')}`)}`
  const id = validSuiteId(value.id) && !BUILT_IN_SUITE_IDS.has(value.id) ? value.id : generatedId
  if (BUILT_IN_SUITE_IDS.has(id)) return null
  return { id, name, deviceIds, builtIn: false }
}

export function createDeviceSuite(input: DeviceSuiteInput, availableDeviceIds: Iterable<string> = BUILT_IN_DEVICE_IDS): DeviceSuite {
  const suite = normalizeDeviceSuite(input, availableDeviceIds)
  if (!suite) throw new TypeError(`Une suite doit contenir entre 1 et ${MAX_ACTIVE_DEVICES} appareils connus.`)
  return suite
}

function cloneBuiltInSuites(): DeviceSuite[] {
  return DEFAULT_DEVICE_SUITES.map((suite) => ({ ...suite, deviceIds: [...suite.deviceIds] }))
}

export function createDefaultDeviceCatalogState(): DeviceCatalogState {
  return {
    version: DEVICE_CATALOG_SCHEMA_VERSION,
    customDevices: [],
    suites: cloneBuiltInSuites(),
    activeSuiteId: DEFAULT_DEVICE_SUITE_ID
  }
}

interface NormalizedCatalogResult {
  state: DeviceCatalogState
  warnings: string[]
}

function normalizeStateWithWarnings(value: unknown): NormalizedCatalogResult {
  const fallback = createDefaultDeviceCatalogState()
  if (!isRecord(value) || value.version !== DEVICE_CATALOG_SCHEMA_VERSION) {
    return { state: fallback, warnings: ['Le format du catalogue est absent ou incompatible.'] }
  }

  const warnings: string[] = []
  const rawCustomDevices = Array.isArray(value.customDevices) ? value.customDevices : []
  if (rawCustomDevices.length > MAX_CUSTOM_DEVICES) warnings.push(`Seuls les ${MAX_CUSTOM_DEVICES} premiers appareils personnalisés ont été examinés.`)

  const customDevices: DeviceProfile[] = []
  const deviceIds = new Set(BUILT_IN_DEVICE_IDS)
  for (const rawProfile of rawCustomDevices.slice(0, MAX_CUSTOM_DEVICES)) {
    const profile = customDeviceFromUnknown(rawProfile)
    if (!profile) {
      warnings.push('Un appareil personnalisé invalide a été ignoré.')
      continue
    }
    if (deviceIds.has(profile.id)) {
      warnings.push(`L’appareil « ${profile.name} » a été ignoré car son identifiant existe déjà.`)
      continue
    }
    customDevices.push(profile)
    deviceIds.add(profile.id)
  }

  const builtInSuites = cloneBuiltInSuites()
  const customSuites: DeviceSuite[] = []
  const suiteIds = new Set(BUILT_IN_SUITE_IDS)
  const rawSuites = Array.isArray(value.suites)
    ? value.suites.filter((suite) => !isRecord(suite) || !BUILT_IN_SUITE_IDS.has(String(suite.id ?? '')))
    : []
  if (rawSuites.length > MAX_CUSTOM_SUITES) warnings.push(`Seules les ${MAX_CUSTOM_SUITES} premières suites personnelles ont été examinées.`)

  for (const rawSuite of rawSuites.slice(0, MAX_CUSTOM_SUITES)) {
    const suite = normalizeDeviceSuite(rawSuite, deviceIds)
    if (!suite) {
      warnings.push('Une suite invalide ou vide a été ignorée.')
      continue
    }
    if (suiteIds.has(suite.id)) {
      warnings.push(`La suite « ${suite.name} » a été ignorée car son identifiant existe déjà.`)
      continue
    }
    customSuites.push(suite)
    suiteIds.add(suite.id)
  }

  const activeSuiteId = typeof value.activeSuiteId === 'string' && suiteIds.has(value.activeSuiteId)
    ? value.activeSuiteId
    : DEFAULT_DEVICE_SUITE_ID
  return {
    state: {
      version: DEVICE_CATALOG_SCHEMA_VERSION,
      customDevices,
      suites: [...builtInSuites, ...customSuites],
      activeSuiteId
    },
    warnings
  }
}

export function normalizeDeviceCatalogState(value: unknown): DeviceCatalogState {
  return normalizeStateWithWarnings(value).state
}

export function allDeviceProfiles(state?: Pick<DeviceCatalogState, 'customDevices'>): readonly DeviceProfile[] {
  return state ? [...DEVICE_CATALOG, ...state.customDevices] : DEVICE_CATALOG
}

export function findDeviceProfile(id: string, state?: Pick<DeviceCatalogState, 'customDevices'>): DeviceProfile | null {
  return allDeviceProfiles(state).find((profile) => profile.id === id) ?? null
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function serializeDeviceCatalogState(value: unknown): string {
  const state = normalizeDeviceCatalogState(value)
  const serialized = JSON.stringify({
    version: state.version,
    customDevices: state.customDevices,
    suites: state.suites.filter((suite) => !suite.builtIn),
    activeSuiteId: state.activeSuiteId
  })
  if (utf8ByteLength(serialized) > MAX_DEVICE_CATALOG_IMPORT_BYTES) {
    throw new RangeError('Le catalogue dépasse la taille maximale autorisée.')
  }
  return serialized
}

export function parseDeviceCatalogState(serialized: string): DeviceCatalogImportResult {
  if (typeof serialized !== 'string' || utf8ByteLength(serialized) > MAX_DEVICE_CATALOG_IMPORT_BYTES) {
    return { ok: false, state: createDefaultDeviceCatalogState(), warnings: [], error: 'Le fichier dépasse la taille maximale autorisée.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return { ok: false, state: createDefaultDeviceCatalogState(), warnings: [], error: 'Le fichier JSON est illisible.' }
  }
  if (!isRecord(parsed) || parsed.version !== DEVICE_CATALOG_SCHEMA_VERSION) {
    return { ok: false, state: createDefaultDeviceCatalogState(), warnings: [], error: 'Cette version de catalogue n’est pas prise en charge.' }
  }
  const normalized = normalizeStateWithWarnings(parsed)
  return { ok: true, state: normalized.state, warnings: normalized.warnings, error: null }
}
