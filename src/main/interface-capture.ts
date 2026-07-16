import type { InterfaceCaptureRegion, InterfaceCaptureRequest } from '../shared/contracts'

export interface CaptureViewportBounds {
  width: number
  height: number
}

const MAX_CAPTURE_COORDINATE = 100_000
const MAX_CAPTURE_NAME_LENGTH = 96

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_CAPTURE_COORDINATE) return null
  return value
}

function positiveDimension(value: unknown): number | null {
  const coordinate = finiteCoordinate(value)
  return coordinate !== null && coordinate > 0 ? coordinate : null
}

/**
 * Convertit un rectangle provenant de getBoundingClientRect() en rectangle DIP
 * entier attendu par webContents.capturePage(). Le scale factor de l'écran ne
 * doit pas être appliqué ici : Electron l'encode dans la NativeImage retournée.
 */
export function clampInterfaceCaptureRegion(
  value: unknown,
  viewport: CaptureViewportBounds
): InterfaceCaptureRegion | null {
  if (!value || typeof value !== 'object') return null
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return null

  const candidate = value as Record<string, unknown>
  const x = finiteCoordinate(candidate.x)
  const y = finiteCoordinate(candidate.y)
  const width = positiveDimension(candidate.width)
  const height = positiveDimension(candidate.height)
  if (x === null || y === null || width === null || height === null) return null

  const viewportWidth = Math.floor(viewport.width)
  const viewportHeight = Math.floor(viewport.height)
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const right = Math.min(viewportWidth, Math.ceil(x + width))
  const bottom = Math.min(viewportHeight, Math.ceil(y + height))
  if (right <= left || bottom <= top) return null

  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function sanitizeInterfaceCaptureName(value: unknown): string {
  if (typeof value !== 'string') return 'responsiver-studio.png'
  const withoutExtension = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.png$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, MAX_CAPTURE_NAME_LENGTH)
    .replace(/[.\s-]+$/g, '')
  return `${withoutExtension || 'responsiver-studio'}.png`
}

export function normalizeInterfaceCaptureRequest(
  value: unknown,
  viewport: CaptureViewportBounds
): InterfaceCaptureRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const region = clampInterfaceCaptureRegion(candidate.region, viewport)
  if (!region) return null
  if (candidate.suggestedName !== undefined && typeof candidate.suggestedName !== 'string') return null
  if (typeof candidate.suggestedName === 'string' && candidate.suggestedName.length > 512) return null
  return {
    region,
    suggestedName: sanitizeInterfaceCaptureName(candidate.suggestedName)
  }
}

export function normalizeCaptureScaleFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(4, Math.max(1, value))
}
