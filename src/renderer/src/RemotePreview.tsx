import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { RemoteAuditResult, RemotePageState } from '../../shared/contracts'

interface RemoteDevice {
  id: string
  width: number
  height: number
  family: 'smartphone' | 'tablet' | 'computer'
  name: string
}

type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

interface RemotePreviewProps {
  projectId: string
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

export default function RemotePreview({ projectId, device, visible, allowUpscale = false, embedded = false, automaticAudit = true, onResize, onAudit, onState, onNotice }: RemotePreviewProps): ReactElement {
  const stage = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)
  const auditedRoutes = useRef(new Set<string>())
  const [scale, setScale] = useState(0.7)
  const [autoFit, setAutoFit] = useState(true)
  const [resizing, setResizing] = useState(false)
  const [state, setState] = useState<RemotePageState | null>(null)
  const [address, setAddress] = useState('')
  const [auditing, setAuditing] = useState(false)

  const publishBounds = (): void => {
    const element = host.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    void window.responsiver.setRemoteBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      scale,
      visible,
      viewport: { width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.family !== 'computer', touch: device.family !== 'computer' }
    }).catch(() => undefined)
  }

  useEffect(() => {
    if (!autoFit || resizing || !stage.current) return
    const element = stage.current
    const update = (): void => setScale(Math.min(allowUpscale ? 1.5 : 1, Math.max(0.1, (element.clientWidth - 54) / (device.width + 14)), Math.max(0.1, (element.clientHeight - 54) / (device.height + 14))))
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [allowUpscale, autoFit, device.height, device.width, resizing])

  useEffect(() => {
    if (!visible) {
      void window.responsiver.setRemoteBounds({ x: 0, y: 0, width: 1, height: 1, scale: 1, visible: false, viewport: { width: device.width, height: device.height } }).catch(() => undefined)
      return
    }
    const observer = new ResizeObserver(publishBounds)
    if (host.current) observer.observe(host.current)
    window.addEventListener('resize', publishBounds)
    window.addEventListener('scroll', publishBounds, true)
    const animation = window.requestAnimationFrame(publishBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publishBounds)
      window.removeEventListener('scroll', publishBounds, true)
      window.cancelAnimationFrame(animation)
      void window.responsiver.setRemoteBounds({ x: 0, y: 0, width: 1, height: 1, scale: 1, visible: false, viewport: { width: device.width, height: device.height } }).catch(() => undefined)
    }
  }, [device.family, device.height, device.width, scale, visible])

  useEffect(() => {
    const off = window.responsiver.onRemoteState((next) => {
      setState(next)
      setAddress(next.url)
      onState(next)
    })
    void window.responsiver.getRemoteState().then((next) => {
      setState(next)
      setAddress(next.url)
      onState(next)
    }).catch(() => undefined)
    return off
  }, [projectId])

  const audit = async (automatic = false): Promise<void> => {
    if (auditing) return
    const routeKey = state?.path || '/'
    if (automatic && auditedRoutes.current.has(routeKey)) return
    if (automatic) auditedRoutes.current.add(routeKey)
    setAuditing(true)
    try {
      const result = await window.responsiver.auditRemote(sweepViewports)
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
    if (!automaticAudit || !visible || state?.loading || !state?.path || auditedRoutes.current.has(state.path)) return
    const timer = window.setTimeout(() => { void audit(true) }, 850)
    return () => window.clearTimeout(timer)
  }, [automaticAudit, projectId, state?.loading, state?.path, visible])

  const navigate = async (action: 'back' | 'forward' | 'reload' | 'url', value?: string): Promise<void> => {
    try {
      const next = await window.responsiver.navigateRemote(action, value)
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
    <div className="remote-stage" ref={stage}>
      <div className="remote-device-space" style={{ width: width + 14, height: height + 14 }}>
        <div className="remote-device-frame" style={{ width: width + 14, height: height + 14 }}>
          <div className="remote-view-host" ref={host} style={{ width, height }} aria-label={`Aperçu distant ${device.name}`} />
          {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as ResizeEdge[]).map((edge) => <button key={edge} className={`resize-handle resize-handle--${edge}`} onPointerDown={(event) => beginResize(edge, event)} aria-label={`Redimensionner la preview depuis ${edge}`} />)}
        </div>
      </div>
      {auditing && <div className="remote-audit-overlay" role="status"><span /><strong>Analyse visuelle multi-viewport</strong><small>Géométrie, texte, médias, contraste et interactions</small></div>}
    </div>
    <footer><strong>{device.name}</strong><code>{device.width} × {device.height} CSS px</code><span>{state?.loading ? 'Chargement…' : 'Navigable'}</span><button onClick={() => setAutoFit(true)} disabled={autoFit}>Ajuster à la zone</button></footer>
  </section>
}
