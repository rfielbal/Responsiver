import type { ReactElement } from 'react'
import { PREVIEW_ZOOM_MAX, PREVIEW_ZOOM_MIN, zoomPercentage } from './preview-zoom'

interface PreviewZoomControlsProps {
  scale: number
  autoFit: boolean
  onZoomOut: () => void
  onZoomIn: () => void
  onActualSize: () => void
  onFit: () => void
}

export default function PreviewZoomControls({ scale, autoFit, onZoomOut, onZoomIn, onActualSize, onFit }: PreviewZoomControlsProps): ReactElement {
  const percentage = zoomPercentage(scale)
  return <div className="preview-zoom-controls" role="group" aria-label="Zoom de la prévisualisation" title="Ctrl + molette ou pincement pour zoomer sous le pointeur">
    <button type="button" onClick={onZoomOut} disabled={scale <= PREVIEW_ZOOM_MIN + .001} aria-label="Réduire le zoom">−</button>
    <button type="button" className={autoFit ? 'zoom-value is-auto' : 'zoom-value'} onClick={onActualSize} aria-label={`Afficher à 100 %, zoom actuel ${percentage} %`} title="Afficher à la taille réelle (100 %)">{percentage}%</button>
    <button type="button" onClick={onZoomIn} disabled={scale >= PREVIEW_ZOOM_MAX - .001} aria-label="Agrandir le zoom">+</button>
    <button type="button" className="zoom-fit" onClick={onFit} disabled={autoFit} aria-label="Ajuster à la zone">Ajuster</button>
  </div>
}
