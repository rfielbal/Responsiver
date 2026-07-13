export const PREVIEW_ZOOM_MIN = 0.1
export const PREVIEW_ZOOM_MAX = 2

export function clampPreviewScale(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return clampPreviewScale(fallback, 1)
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value))
}

export function stepPreviewScale(value: number, direction: -1 | 1): number {
  const current = clampPreviewScale(value)
  const next = Math.round((current + direction * 0.1) * 100) / 100
  return clampPreviewScale(next)
}

export function wheelPreviewScale(value: number, deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampPreviewScale(value)
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1)
  const bounded = Math.min(160, Math.max(-160, pixels))
  return clampPreviewScale(value * Math.exp(-bounded * 0.0017))
}

export function zoomPercentage(value: number): number {
  return Math.round(clampPreviewScale(value) * 100)
}
