import { useEffect, useRef, useState, type FormEvent, type ReactElement, type WheelEvent } from 'react'
import type { RemoteAuditResult, RemotePageState, RemoteViewBounds, RemoteViewport } from '../../shared/contracts'
import PreviewZoomControls from './PreviewZoomControls'
import { clampPreviewScale, stepPreviewScale, wheelPreviewScale } from './preview-zoom'

interface RemoteDevice {
  id: string
  width: number
  height: number
  family: 'smartphone' | 'tablet' | 'computer'
  name: string
  dpr?: number
  mobile?: boolean
  touch?: boolean
}

type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

interface RemotePreviewProps {
  projectId: string
  /** Identité stable d'une vue Studio. Absente = preview distante historique. */
  viewId?: string
  device: RemoteDevice
  visible: boolean
  allowUpscale?: boolean
  embedded?: boolean
  automaticAudit?: boolean
  onResize: (width: number, height: number) => void
  onAudit: (result: RemoteAuditResult) => void
  onState: (state: RemotePageState) => void
  onNotice: (message: string) => void
}

const sweepViewports = [
  { width: 360, height: 800, deviceScaleFactor: 1, mobile: true, touch: true },
  { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, touch: true },
  { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true, touch: true },
  { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false, touch: true },
  { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, touch: false }
]

export interface RemoteClipRectangle {
  left: number
  top: number
  right: number
  bottom: number
}

export interface RemoteClipConstraint {
  rectangle: RemoteClipRectangle
  horizontal: boolean
  vertical: boolean
}

const CLIPPING_OVERFLOWS = new Set(['auto', 'clip', 'hidden', 'overlay', 'scroll'])
const BOUNDS_RETRY_DELAYS = [70, 180] as const

export function intersectRemoteClipBounds(base: RemoteClipRectangle, constraints: readonly RemoteClipConstraint[]): RemoteClipRectangle | null {
  let left = base.left
  let top = base.top
  let right = base.right
  let bottom = base.bottom
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null
  for (const constraint of constraints) {
    const rectangle = constraint.rectangle
    if (![rectangle.left, rectangle.top, rectangle.right, rectangle.bottom].every(Number.isFinite)) return null
    if (constraint.horizontal) {
      left = Math.max(left, rectangle.left)
      right = Math.min(right, rectangle.right)
    }
    if (constraint.vertical) {
      top = Math.max(top, rectangle.top)
      bottom = Math.min(bottom, rectangle.bottom)
    }
    if (right <= left || bottom <= top) return null
  }
  return { left, top, right, bottom }
}

function domRectangle(value: DOMRect): RemoteClipRectangle {
  return { left: value.left, top: value.top, right: value.right, bottom: value.bottom }
}

function clippedStageRectangle(element: HTMLElement): RemoteClipRectangle | null {
  const constraints: RemoteClipConstraint[] = [{
    rectangle: { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight },
    horizontal: true,
    vertical: true
  }]
  let ancestor = element.parentElement
  while (ancestor) {
    const style = window.getComputedStyle(ancestor)
    const horizontal = CLIPPING_OVERFLOWS.has(style.overflowX)
    const vertical = CLIPPING_OVERFLOWS.has(style.overflowY)
    if (horizontal || vertical) constraints.push({ rectangle: domRectangle(ancestor.getBoundingClientRect()), horizontal, vertical })
    ancestor = ancestor.parentElement
  }
  return intersectRemoteClipBounds(domRectangle(element.getBoundingClientRect()), constraints)
}

function remoteViewport(device: RemoteDevice): RemoteViewport {
  return {
    width: device.width,
    height: device.height,
    deviceScaleFactor: device.dpr ?? 1,
    mobile: device.mobile ?? device.family !== 'computer',
    touch: device.touch ?? device.family !== 'computer'
  }
}

export default function RemotePreview({ projectId, viewId, device, visible, allowUpscale = false, embedded = false, automaticAudit, onResize, onAudit, onState, onNotice }: RemotePreviewProps): ReactElement {
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const boundsFrame = useRef<number | null>(null)
  const boundsRetryTimer = useRef<number | null>(null)
  const boundsRequestSequence = useRef(0)
  const unmounted = useRef(false)
  const viewportRef = useRef<RemoteViewport>(remoteViewport(device))
  const resizeCleanup = useRef<(() => void) | null>(null)
  const auditedRoutes = useRef(new Set<string>())
  const [scale, setScale] = useState(0.7)
  const scaleRef = useRef(scale)
  const [autoFit, setAutoFit] = useState(true)
  const [resizing, setResizing] = useState(false)
  const [state, setState] = useState<RemotePageState | null>(null)
  const [address, setAddress] = useState('')
  const [auditing, setAuditing] = useState(false)
  scaleRef.current = scale
  viewportRef.current = remoteViewport(device)

  const queueRemoteBounds = (request: RemoteViewBounds): void => {
    const sequence = ++boundsRequestSequence.current
    if (boundsRetryTimer.current !== null) window.clearTimeout(boundsRetryTimer.current)
    boundsRetryTimer.current = null
    const dispatch = (attempt: number): void => {
      void window.responsiver.setRemoteBounds(request).catch(() => {
        if (unmounted.current || sequence !== boundsRequestSequence.current || attempt >= BOUNDS_RETRY_DELAYS.length) return
        boundsRetryTimer.current = window.setTimeout(() => {
          boundsRetryTimer.current = null
          if (!unmounted.current && sequence === boundsRequestSequence.current) dispatch(attempt + 1)
        }, BOUNDS_RETRY_DELAYS[attempt])
      })
    }
    dispatch(0)
  }

  const hiddenBounds = (): RemoteViewBounds => ({
    projectId,
    viewId,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    scale: 1,
    visible: false,
    viewport: viewportRef.current
  })

  const publishBounds = (): void => {
    if (boundsFrame.current !== null) return
    boundsFrame.current = window.requestAnimationFrame(() => {
      boundsFrame.current = null
      const element = host.current
      const clip = stage.current
      if (!element || !clip) return
      const rect = element.getBoundingClientRect()
      const clipRect = clippedStageRectangle(clip)
      const paintedRect = clipRect ? intersectRemoteClipBounds(domRectangle(rect), [{ rectangle: clipRect, horizontal: true, vertical: true }]) : null
      if (!visible || !clipRect || !paintedRect) {
        queueRemoteBounds(hiddenBounds())
        return
      }
      const clipLeft = Math.ceil(clipRect.left)
      const clipTop = Math.ceil(clipRect.top)
      const clipRight = Math.floor(clipRect.right)
      const clipBottom = Math.floor(clipRect.bottom)
      if (clipRight <= clipLeft || clipBottom <= clipTop) {
        queueRemoteBounds(hiddenBounds())
        return
      }
      queueRemoteBounds({
        projectId,
        viewId,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        clip: {
          x: clipLeft,
          y: clipTop,
          width: clipRight - clipLeft,
          height: clipBottom - clipTop
        },
        scale: scaleRef.current,
        visible: true,
        viewport: viewportRef.current
      })
    })
  }

  useEffect(() => {
    if (!autoFit || resizing || !stage.current) return
    const element = stage.current
    const update = (): void => {
      const next = clampPreviewScale(Math.min(allowUpscale ? 1.5 : 1, Math.max(0.1, (element.clientWidth - 54) / (device.width + 14)), Math.max(0.1, (element.clientHeight - 54) / (device.height + 14))))
      scaleRef.current = next
      setScale(next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [allowUpscale, autoFit, device.height, device.width, resizing])

  useEffect(() => {
    if (!visible) {
      queueRemoteBounds(hiddenBounds())
      return
    }
    const observer = new ResizeObserver(publishBounds)
    const observed = new Set<Element>()
    let observedElement: HTMLElement | null = host.current
    while (observedElement) {
      if (!observed.has(observedElement)) {
        observed.add(observedElement)
        observer.observe(observedElement)
      }
      observedElement = observedElement.parentElement
    }
    window.addEventListener('resize', publishBounds)
    window.addEventListener('scroll', publishBounds, true)
    publishBounds()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publishBounds)
      window.removeEventListener('scroll', publishBounds, true)
      if (boundsFrame.current !== null) window.cancelAnimationFrame(boundsFrame.current)
      boundsFrame.current = null
    }
  }, [device.dpr, device.family, device.height, device.mobile, device.touch, device.width, projectId, scale, viewId, visible])

  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      boundsRequestSequence.current += 1
      if (boundsRetryTimer.current !== null) window.clearTimeout(boundsRetryTimer.current)
      boundsRetryTimer.current = null
      if (boundsFrame.current !== null) window.cancelAnimationFrame(boundsFrame.current)
      boundsFrame.current = null
      void window.responsiver.setRemoteBounds({
        projectId,
        viewId,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        scale: 1,
        visible: false,
        viewport: viewportRef.current
      }).catch(() => undefined)
      if (viewId) void window.responsiver.releaseRemoteView({ projectId, viewId }).catch(() => undefined)
    }
  }, [projectId, viewId])

  const stageCenter = (): { x: number; y: number } | undefined => {
    const element = stage.current
    if (!element) return undefined
    const rectangle = element.getBoundingClientRect()
    return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 }
  }

  const applyManualZoom = (nextValue: number, anchor = stageCenter()): void => {
    const previous = scaleRef.current
    const next = clampPreviewScale(nextValue, previous)
    if (Math.abs(next - previous) < .0001) {
      setAutoFit(false)
      return
    }
    const scrollHost = stage.current
    const deviceFrame = frame.current
    const before = anchor && deviceFrame ? deviceFrame.getBoundingClientRect() : null
    const ratioX = before && before.width > 0 ? (anchor!.x - before.left) / before.width : .5
    const ratioY = before && before.height > 0 ? (anchor!.y - before.top) / before.height : .5
    setAutoFit(false)
    scaleRef.current = next
    setScale(next)
    if (!scrollHost || !deviceFrame || !anchor || !before) return
    window.requestAnimationFrame(() => {
      const after = deviceFrame.getBoundingClientRect()
      scrollHost.scrollLeft += after.left + after.width * ratioX - anchor.x
      scrollHost.scrollTop += after.top + after.height * ratioY - anchor.y
      publishBounds()
    })
  }

  const handleZoomWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    applyManualZoom(wheelPreviewScale(scaleRef.current, event.deltaY, event.deltaMode), { x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    const off = window.responsiver.onRemoteState((next) => {
      if ((next.viewId ?? undefined) !== viewId) return
      setState(next)
      setAddress(next.url)
      onState(next)
    })
    void window.responsiver.getRemoteState(viewId ? { projectId, viewId } : undefined).then((next) => {
      setState(next)
      setAddress(next.url)
      onState(next)
    }).catch(() => undefined)
    return off
  }, [projectId, viewId])

  useEffect(() => window.responsiver.onRemoteZoomGesture((gesture) => {
    if (!visible || gesture.projectId !== projectId || (gesture.viewId ?? undefined) !== viewId) return
    const rectangle = host.current?.getBoundingClientRect()
    const anchor = rectangle ? { x: rectangle.left + gesture.x, y: rectangle.top + gesture.y } : stageCenter()
    applyManualZoom(wheelPreviewScale(scaleRef.current, gesture.deltaY), anchor)
  }), [device.family, device.height, device.width, projectId, viewId, visible])

  const audit = async (automatic = false): Promise<void> => {
    if (auditing) return
    const routeKey = state?.path || '/'
    if (automatic && auditedRoutes.current.has(routeKey)) return
    if (automatic) auditedRoutes.current.add(routeKey)
    setAuditing(true)
    try {
      const result = await window.responsiver.auditRemote(sweepViewports, viewId ? { projectId, viewId } : undefined)
      auditedRoutes.current.add(result.path)
      onAudit(result)
      onNotice(result.truncated
        ? `${result.findings.length} constat${result.findings.length > 1 ? 's' : ''} mesuré${result.findings.length > 1 ? 's' : ''} sur cette route. Les limites de sécurité ont été atteintes : le résultat est partiel.`
        : `${result.findings.length} constat${result.findings.length > 1 ? 's' : ''} visuel${result.findings.length > 1 ? 's' : ''} mesuré${result.findings.length > 1 ? 's' : ''} sur cette route et cinq largeurs.`)
    } catch {
      if (automatic) auditedRoutes.current.delete(routeKey)
      onNotice('L’audit visuel n’a pas pu terminer toutes les mesures.')
    } finally {
      setAuditing(false)
      window.requestAnimationFrame(publishBounds)
    }
  }

  useEffect(() => {
    auditedRoutes.current.clear()
  }, [projectId])

  useEffect(() => {
    const shouldAuditAutomatically = automaticAudit ?? !viewId
    if (!shouldAuditAutomatically || !visible || state?.loading || !state?.path || auditedRoutes.current.has(state.path)) return
    const timer = window.setTimeout(() => { void audit(true) }, 850)
    return () => window.clearTimeout(timer)
  }, [automaticAudit, projectId, state?.loading, state?.path, viewId, visible])

  const navigate = async (action: 'back' | 'forward' | 'reload' | 'url', value?: string): Promise<void> => {
    try {
      const next = await window.responsiver.navigateRemote(action, value, viewId ? { projectId, viewId } : undefined)
      setState(next)
      setAddress(next.url)
      onState(next)
    } catch { onNotice('Cette navigation a été refusée par la politique de sécurité de la session.') }
  }

  const submitAddress = (event: FormEvent): void => {
    event.preventDefault()
    void navigate('url', address)
  }

  const beginResize = (edge: ResizeEdge, event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const target = event.currentTarget
    const pointer = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = device.width
    const startHeight = device.height
    target.setPointerCapture(pointer)
    setAutoFit(false)
    setResizing(true)
    const move = (next: PointerEvent): void => {
      const horizontal = edge.includes('e') ? next.clientX - startX : edge.includes('w') ? startX - next.clientX : 0
      const vertical = edge.includes('s') ? next.clientY - startY : edge.includes('n') ? startY - next.clientY : 0
      onResize(Math.min(3_840, Math.max(240, Math.round(startWidth + horizontal / Math.max(scale, 0.1)))), Math.min(3_000, Math.max(320, Math.round(startHeight + vertical / Math.max(scale, 0.1)))))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      if (target.isConnected && target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer)
      setResizing(false)
      resizeCleanup.current = null
    }
    resizeCleanup.current?.()
    resizeCleanup.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  useEffect(() => () => resizeCleanup.current?.(), [])

  const width = Math.round(device.width * scale)
  const height = Math.round(device.height * scale)
  return <section className={`remote-preview${resizing ? ' is-resizing' : ''}${embedded ? ' is-embedded' : ''}`}>
    <div className="remote-browser-bar">
      <div><button onClick={() => void navigate('back')} disabled={!state?.canGoBack} aria-label="Page précédente">←</button><button onClick={() => void navigate('forward')} disabled={!state?.canGoForward} aria-label="Page suivante">→</button><button onClick={() => void navigate('reload')} aria-label="Recharger">↻</button></div>
      <form onSubmit={submitAddress}><span>URL</span><input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Adresse de la page distante" /></form>
      <span className="remote-session-badge"><i /> Session éphémère</span>
      <button className="remote-audit-button" onClick={() => void audit(false)} disabled={auditing}>{auditing ? 'Analyse…' : 'Analyser cette route'}</button>
    </div>
    <div className="remote-stage" ref={stage} onWheel={handleZoomWheel}>
      <div className="remote-device-space" style={{ width: width + 14, height: height + 14 }}>
        <div ref={frame} className="remote-device-frame" style={{ width: width + 14, height: height + 14 }}>
          <div className="remote-view-host" ref={host} style={{ width, height }} aria-label={`Aperçu distant ${device.name}`} />
          {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as ResizeEdge[]).map((edge) => <button key={edge} className={`resize-handle resize-handle--${edge}`} onPointerDown={(event) => beginResize(edge, event)} aria-label={`Redimensionner la preview depuis ${edge}`} />)}
        </div>
      </div>
      {auditing && <div className="remote-audit-overlay" role="status"><span /><strong>Analyse visuelle multi-viewport</strong><small>Géométrie, texte, médias, contraste et interactions</small></div>}
    </div>
    <footer><strong>{device.name}</strong><code>{device.width} × {device.height} CSS px</code><span>{state?.loading ? 'Chargement…' : 'Navigable'}</span><PreviewZoomControls scale={scale} autoFit={autoFit} onZoomOut={() => applyManualZoom(stepPreviewScale(scaleRef.current, -1))} onZoomIn={() => applyManualZoom(stepPreviewScale(scaleRef.current, 1))} onActualSize={() => applyManualZoom(1)} onFit={() => setAutoFit(true)} /></footer>
  </section>
}
