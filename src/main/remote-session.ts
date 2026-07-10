import { randomUUID, createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { basename } from 'node:path'
import { BrowserWindow, WebContentsView, type Rectangle } from 'electron'
import type {
  ProjectIssue,
  ProjectSnapshot,
  RemoteAuditMode,
  RemoteAuditResult as SharedRemoteAuditResult,
  RemoteFocusResult,
  RemoteOpenRequest,
  RemotePageState,
  RemoteViewBounds,
  RemoteViewport
} from '../shared/contracts'
import {
  REMOTE_AUDIT_BOOTSTRAP_SCRIPT,
  buildRemoteAuditScript,
  consolidateRemoteAuditFindings,
  sanitizeRemoteAuditResult,
  type RemoteAuditFinding
} from './remote-audit'
import {
  authorizeAuditRedirect,
  authorizeAuditUrl,
  classifyIpAddress,
  isAuditResourceRequestAllowed,
  normalizeAuditUrl,
  type NormalizedAuditUrl
} from './url-policy'

const navigationTimeoutMs = 30_000
const dnsTimeoutMs = 6_000
const scriptTimeoutMs = 12_000
const screenshotTimeoutMs = 10_000
const auditSettlingMs = 260
const maxScreenshotDataUrlLength = 12 * 1024 * 1024
const maxResourceHostnames = 256
const maxConcurrentResourceHostChecks = 16
const resourceHostCacheMs = 10_000
const maxAuditNodesPerViewport = 5_000
const maxAuditFindingsPerViewport = 60
const maxAuditFindingsTotal = 20
const defaultViewport: RemoteViewport = { width: 393, height: 852, deviceScaleFactor: 1, mobile: true, touch: true }

export interface RemoteSessionCallbacks {
  onState?: (state: RemotePageState) => void
  onBlockedNavigation?: (url: string, detail: string) => void
}

export interface RemoteSessionCreateOptions extends RemoteSessionCallbacks {
  owner: BrowserWindow
  request: RemoteOpenRequest
  linkedRoot?: string | null
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeViewport(value: RemoteViewport): RemoteViewport {
  const width = clampInteger(value.width, 240, 3_840, defaultViewport.width)
  const height = clampInteger(value.height, 320, 3_000, defaultViewport.height)
  return {
    width,
    height,
    deviceScaleFactor: typeof value.deviceScaleFactor === 'number' && Number.isFinite(value.deviceScaleFactor)
      ? Math.min(4, Math.max(0.5, value.deviceScaleFactor))
      : 1,
    mobile: typeof value.mobile === 'boolean' ? value.mobile : width < 700,
    touch: typeof value.touch === 'boolean' ? value.touch : width < 1_100
  }
}

function sanitizeBounds(value: RemoteViewBounds, owner: BrowserWindow): { bounds: Rectangle; scale: number; viewport: RemoteViewport; visible: boolean } {
  const contentBounds = owner.getContentBounds()
  const x = clampInteger(value.x, 0, Math.max(0, contentBounds.width - 1), 0)
  const y = clampInteger(value.y, 0, Math.max(0, contentBounds.height - 1), 0)
  const width = clampInteger(value.width, 1, Math.max(1, contentBounds.width - x), 1)
  const height = clampInteger(value.height, 1, Math.max(1, contentBounds.height - y), 1)
  const scale = typeof value.scale === 'number' && Number.isFinite(value.scale) ? Math.min(2, Math.max(0.1, value.scale)) : 1
  const viewport = value.viewport && typeof value.viewport === 'object' ? value.viewport : defaultViewport
  return { bounds: { x, y, width, height }, scale, viewport: normalizeViewport(viewport), visible: value.visible === true }
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  if (classifyIpAddress(hostname) !== 'reserved' || hostname === 'localhost') return []
  const records = await withTimeout(
    lookup(hostname, { all: true, verbatim: true }),
    dnsTimeoutMs,
    'La résolution DNS initiale a dépassé le délai autorisé.'
  )
  return [...new Set(records.map((record) => record.address))]
}

async function authorizeInput(input: string, mode: RemoteAuditMode): Promise<NormalizedAuditUrl> {
  const normalized = normalizeAuditUrl(input, mode)
  if (normalized.resolutionValidated) return authorizeAuditUrl(normalized.href, mode)
  return authorizeAuditUrl(normalized.href, mode, { resolvedAddresses: await resolveAddresses(normalized.hostname) })
}

function routeLabel(url: URL): string {
  const last = basename(url.pathname.replace(/\/$/, ''))
  return last || url.hostname
}

function themeProfile(): ProjectSnapshot['theme'] {
  return { detected: 'unknown', hasDark: false, hasLight: false, evidence: ['Le thème sera mesuré sur le rendu distant.'], variables: [] }
}

function pageReadiness(): ProjectSnapshot['previewReadiness'] {
  return { status: 'ready', strategy: 'source', summary: 'La page distante est chargée dans une session Chromium isolée.', diagnostics: [] }
}

function mapSeverity(finding: RemoteAuditFinding): ProjectIssue['severity'] {
  if (finding.rule === 'runtime.page-error' || finding.rule === 'media.image-error') return 'attention'
  return finding.severity === 'info' ? 'information' : 'attention'
}

function proposalFor(finding: RemoteAuditFinding): string {
  const proposals: Record<RemoteAuditFinding['rule'], string> = {
    'layout.viewport-overflow': 'Identifier la contrainte de largeur ou le contenu qui déborde, puis vérifier une règle fluide au viewport concerné.',
    'responsive.missing-viewport': 'Ajouter une balise meta viewport déclarant width=device-width, puis vérifier le rendu sur un appareil mobile réel.',
    'layout.clipped-content': 'Réviser la taille du conteneur et sa règle overflow sans dévoiler un contenu volontairement masqué.',
    'layout.truncated-text': 'Autoriser un retour à la ligne ou dimensionner explicitement la zone de texte à ce breakpoint.',
    'layout.navigation-wrap': 'À ce breakpoint, préférer une navigation repliable ou équilibrer explicitement les rangées avec flex-wrap, gap et des zones tactiles suffisantes.',
    'layout.element-overlap': 'Supprimer la superposition involontaire en rétablissant le flux, le gap ou la grille du conteneur avant de modifier les z-index.',
    'layout.density-hierarchy': 'Réduire le nombre de commandes visibles dans ce groupe ou augmenter gap et padding pour rétablir une hiérarchie claire.',
    'layout.useful-area-overflow': 'Contraindre ce bloc avec max-inline-size: 100%, min-inline-size: 0 et un retour à la ligne au breakpoint concerné.',
    'typography.disproportionate': 'Borner le titre avec font-size: clamp(...) et une line-height cohérente, puis contrôler ses métriques avec la police réellement chargée.',
    'typography.mobile-readability': 'Augmenter le corps ou l’interlignage du texte concerné, puis contrôler sa densité sur un petit écran.',
    'interaction.small-target': 'Porter la zone interactive à au moins 44 × 44 CSS px ou augmenter son espacement tactile.',
    'layout.fixed-obstruction': 'Réduire, déplacer ou rendre temporaire cet élément fixe sur les petits viewports.',
    'media.image-error': 'Vérifier l’URL, le chargement et les variantes responsive de cette image.',
    'media.image-distortion': 'Préserver le ratio naturel avec height: auto ou un object-fit adapté.',
    'accessibility.low-contrast': 'Ajuster les rôles de couleur afin d’atteindre le contraste requis sans modifier la hiérarchie visuelle.',
    'runtime.page-error': 'Corriger l’erreur d’exécution ou la ressource concernée, puis relancer l’audit de la route.'
  }
  return proposals[finding.rule]
}

function mapFinding(finding: RemoteAuditFinding, affectedViewports: readonly RemoteAuditFinding['viewport'][] = [finding.viewport]): ProjectIssue {
  const evidenceText = finding.evidence.map((entry) => {
    const observed = entry.observed === undefined ? '' : ` · observé : ${String(entry.observed)}`
    const expected = entry.expected === undefined ? '' : ` · attendu : ${String(entry.expected)}`
    return `${entry.summary}${observed}${expected}`
  }).join(' ')
  const width = finding.viewport.width
  const height = finding.viewport.height
  const viewportList = affectedViewports.map((viewport) => `${viewport.width} × ${viewport.height}`)
  const viewportLabel = viewportList.length === 1
    ? viewportList[0]
    : `${Math.min(...affectedViewports.map((viewport) => viewport.width))}–${Math.max(...affectedViewports.map((viewport) => viewport.width))} px · ${viewportList.length} vues`
  const affectedText = viewportList.length > 1 ? ` Observé sur ${viewportList.join(', ')}.` : ''
  return {
    id: finding.id,
    title: finding.title,
    description: `${[finding.description, evidenceText].filter(Boolean).join(' ')}${affectedText}`,
    severity: mapSeverity(finding),
    coverage: finding.confidence >= 0.9 ? 'standard' : 'heuristique',
    viewport: viewportLabel,
    routePath: finding.route.path,
    rule: finding.rule,
    proposal: proposalFor(finding),
    confidence: finding.confidence >= 0.9 ? 'certain' : finding.confidence >= 0.7 ? 'probable' : 'review',
    evidence: {
      selector: finding.selector,
      route: finding.route.path,
      viewport: { width, height },
      rectangle: finding.rect,
      measurements: Object.fromEntries([
        ...Object.entries(finding.style).slice(0, 20),
        ['confidence', Math.round(finding.confidence * 100)],
        ['affectedViewports', viewportList.join(', ')],
        ['viewportCount', viewportList.length]
      ]),
      screenshotDataUrl: null
    }
  }
}

function uniqueIssues(issues: ProjectIssue[]): { issues: ProjectIssue[]; truncated: boolean } {
  const unique = new Map<string, ProjectIssue>()
  for (const issue of issues) unique.set(issue.id, issue)
  const severityScore: Record<ProjectIssue['severity'], number> = { bloquant: 60, attention: 40, information: 20 }
  const rulePriority: Record<string, number> = {
    'layout.element-overlap': 100,
    'layout.useful-area-overflow': 96,
    'media.image-error': 94,
    'runtime.page-error': 93,
    'layout.viewport-overflow': 92,
    'layout.navigation-wrap': 88,
    'typography.disproportionate': 86,
    'layout.density-hierarchy': 82,
    'layout.fixed-obstruction': 80,
    'layout.truncated-text': 76,
    'layout.clipped-content': 72,
    'interaction.small-target': 70,
    'typography.mobile-readability': 68,
    'media.image-distortion': 66,
    'responsive.missing-viewport': 64,
    'accessibility.low-contrast': 40
  }
  const confidenceScore = (issue: ProjectIssue): number => issue.confidence === 'certain' ? 6 : issue.confidence === 'probable' ? 3 : 0
  const values = [...unique.values()].sort((left, right) =>
    (rulePriority[right.rule] ?? 50) + severityScore[right.severity] + confidenceScore(right) -
    ((rulePriority[left.rule] ?? 50) + severityScore[left.severity] + confidenceScore(left)))
  const perRule = new Map<string, number>()
  const selected: ProjectIssue[] = []
  for (const issue of values) {
    if (selected.length >= maxAuditFindingsTotal) break
    const count = perRule.get(issue.rule) ?? 0
    const cap = issue.rule === 'layout.viewport-overflow' || issue.rule === 'layout.element-overlap' ? 5 : 3
    if (count >= cap) continue
    selected.push(issue)
    perRule.set(issue.rule, count + 1)
  }
  return { issues: selected, truncated: selected.length < values.length }
}

export class RemoteBrowserSession {
  readonly owner: BrowserWindow
  readonly view: WebContentsView
  readonly mode: RemoteAuditMode
  readonly initial: NormalizedAuditUrl
  private readonly callbacks: RemoteSessionCallbacks
  private linkedSourceRoot: string | null
  private currentApproved: NormalizedAuditUrl
  private currentViewport = defaultViewport
  private currentScale = 1
  private closed = false
  private auditRunning = false
  private workspaceCssKey: string | null = null
  private readonly allowedHostnames = new Set<string>()
  private readonly resourceHostCache = new Map<string, { allowed: boolean; expiresAt: number }>()
  private readonly resourceHostnames = new Set<string>()
  private readonly resourceHostInflight = new Map<string, Promise<boolean>>()
  private pendingViewSettings: { viewport: RemoteViewport; scale: number } | null = null
  private viewportQueue: Promise<void> = Promise.resolve()

  private constructor(options: RemoteSessionCreateOptions, initial: NormalizedAuditUrl) {
    this.owner = options.owner
    this.mode = options.request.mode
    this.linkedSourceRoot = options.linkedRoot ?? null
    this.callbacks = options
    this.initial = initial
    this.currentApproved = initial
    this.allowedHostnames.add(initial.hostname)
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        enableWebSQL: false,
        navigateOnDragDrop: false,
        webviewTag: false,
        disableDialogs: true,
        spellcheck: false,
        partition: `responsiver-remote-${randomUUID()}`,
        autoplayPolicy: 'document-user-activation-required'
      }
    })
    this.view.setBackgroundColor('#ffffff')
    this.view.setBorderRadius(7)
    this.view.setVisible(false)
    this.owner.contentView.addChildView(this.view)
    this.configureSecurity()
  }

  static async create(options: RemoteSessionCreateOptions): Promise<RemoteBrowserSession> {
    if (options.request.mode !== 'public' && options.request.mode !== 'localhost') throw new Error('Le mode d’audit URL est invalide.')
    const initial = await authorizeInput(options.request.url, options.request.mode)
    const session = new RemoteBrowserSession(options, initial)
    try {
      // Un WebContentsView neuf n’a pas encore de cible Page CDP. Le document
      // interne vide initialise son renderer sans effectuer aucun accès réseau.
      await withTimeout(
        session.view.webContents.loadURL('about:blank'),
        5_000,
        'L’initialisation du renderer isolé a dépassé le délai autorisé.'
      )
      await session.attachDebugger()
      // Le premier contrôle utilise le résolveur système avant toute création de
      // contenu. Celui-ci utilise ensuite le résolveur Chromium de la partition,
      // au plus près de la connexion réellement effectuée.
      const chromiumApproved = await session.authorizeWithChromium(initial.href)
      await session.load(chromiumApproved)
      return session
    } catch (error) {
      await session.close()
      throw error
    }
  }

  private configureSecurity(): void {
    const contents = this.view.webContents
    contents.setWindowOpenHandler((details) => {
      if (details.postBody) {
        this.callbacks.onBlockedNavigation?.(details.url.slice(0, 4_096), 'Les formulaires ouverts dans une nouvelle fenêtre sont bloqués en mode audit.')
      } else {
        void this.requestNavigation(details.url)
      }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (details) => {
      if (!details.isMainFrame) return
      // Sur localhost, une navigation déjà bornée au même hôte peut continuer
      // nativement afin de conserver les formulaires POST. En mode public, toute
      // navigation est rejouée en GET après validation : la session reste vraiment
      // en lecture seule.
      if (this.mode === 'localhost' && this.isKnownNavigationTarget(details.url) && !this.auditRunning) return
      details.preventDefault()
      void this.requestNavigation(details.url)
    })
    contents.on('will-redirect', (details) => {
      if (!details.isMainFrame) return
      if (this.auditRunning) {
        details.preventDefault()
        this.callbacks.onBlockedNavigation?.(details.url.slice(0, 4_096), 'La redirection est suspendue pendant l’audit multi-viewport.')
        return
      }
      try {
        const target = normalizeAuditUrl(details.url, this.mode)
        if (this.mode === 'public') {
          // Interrompre ici casserait la promesse loadURL et les chaînes de 30x.
          // onBeforeRequest revalide ensuite le protocole, la méthode et la DNS
          // Chromium avant que la requête redirigée parte effectivement.
          this.allowedHostnames.add(target.hostname)
          this.resourceHostCache.delete(target.hostname)
          return
        }
        if (this.sameAuditScope(target)) {
          this.resourceHostCache.delete(target.hostname)
          return
        }
      } catch {
        // La redirection non conforme est bloquée ci-dessous et expliquée par
        // requestRedirect avec le même moteur de politique.
      }
      details.preventDefault()
      void this.requestRedirect(details.url)
    })
    contents.on('did-start-loading', () => this.emitState())
    contents.on('did-stop-loading', () => this.emitState())
    contents.on('did-navigate', (_event, url) => {
      this.adoptNavigatedUrl(url)
      this.emitState()
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) {
        this.adoptNavigatedUrl(url)
        this.emitState()
      }
    })
    contents.on('page-title-updated', () => this.emitState())
    contents.on('will-prevent-unload', (event) => event.preventDefault())
    contents.on('login', (event, _details, _authInfo, callback) => {
      event.preventDefault()
      callback()
    })
    contents.on('unresponsive', () => {
      this.callbacks.onBlockedNavigation?.(this.safeCurrentUrl(), 'La page distante ne répond plus.')
    })
    contents.on('render-process-gone', (_event, details) => {
      this.callbacks.onBlockedNavigation?.(this.currentApproved.href, `Le rendu distant s’est arrêté (${details.reason}).`)
    })
    contents.session.setPermissionCheckHandler(() => false)
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    contents.session.on('will-download', (event) => event.preventDefault())
    contents.session.webRequest.onBeforeRequest((details, callback) => {
      try {
        const target = new URL(details.url)
        if (!isAuditResourceRequestAllowed(this.mode, target.protocol, details.method)) return callback({ cancel: true })
        if (['data:', 'blob:', 'about:'].includes(target.protocol)) return callback({ cancel: false })
        if (details.resourceType === 'mainFrame') this.resourceHostCache.delete(target.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''))
        void this.allowResourceHost(target.hostname).then((allowed) => callback({ cancel: !allowed }), () => callback({ cancel: true }))
      } catch {
        callback({ cancel: true })
      }
    })
  }

  private async allowResourceHost(value: string): Promise<boolean> {
    const hostname = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    const cached = this.resourceHostCache.get(hostname)
    if (cached && cached.expiresAt > Date.now()) return cached.allowed
    const inflight = this.resourceHostInflight.get(hostname)
    if (inflight) return inflight
    if (this.resourceHostInflight.size >= maxConcurrentResourceHostChecks) return false
    if (!this.resourceHostnames.has(hostname)) {
      if (this.resourceHostnames.size >= maxResourceHostnames) return false
      this.resourceHostnames.add(hostname)
    }
    const check = this.checkResourceHost(hostname)
    this.resourceHostInflight.set(hostname, check)
    try {
      const allowed = await check
      this.resourceHostCache.set(hostname, { allowed, expiresAt: Date.now() + resourceHostCacheMs })
      return allowed
    } finally {
      this.resourceHostInflight.delete(hostname)
    }
  }

  private async checkResourceHost(hostname: string): Promise<boolean> {
    const literalScope = classifyIpAddress(hostname)
    if (literalScope !== 'reserved') {
      return this.mode === 'public' ? literalScope === 'public' : literalScope === 'public' || literalScope === 'loopback'
    }
    if (hostname === 'localhost') return this.mode === 'localhost'
    if (!hostname.includes('.') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return false
    }
    const addresses = await this.resolveWithChromium(hostname)
    return addresses.length > 0 && addresses.length <= 16 && addresses.every((address) => {
      const scope = classifyIpAddress(address)
      return this.mode === 'public' ? scope === 'public' : scope === 'public' || scope === 'loopback'
    })
  }

  private async resolveWithChromium(hostname: string): Promise<string[]> {
    const result = await withTimeout(
      this.view.webContents.session.resolveHost(hostname, { source: 'any', cacheUsage: 'disallowed' }),
      dnsTimeoutMs,
      'La résolution DNS Chromium a dépassé le délai autorisé.'
    )
    return [...new Set(result.endpoints.map((endpoint) => endpoint.address))]
  }

  private async authorizeWithChromium(value: string): Promise<NormalizedAuditUrl> {
    const normalized = normalizeAuditUrl(value, this.mode)
    if (normalized.resolutionValidated) return authorizeAuditUrl(normalized.href, this.mode)
    return authorizeAuditUrl(normalized.href, this.mode, { resolvedAddresses: await this.resolveWithChromium(normalized.hostname) })
  }

  private async attachDebugger(): Promise<void> {
    const debuggerApi = this.view.webContents.debugger
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
    await this.sendDebuggerCommand('Page.enable')
    await this.sendDebuggerCommand('Runtime.enable')
    await this.sendDebuggerCommand('Page.setInterceptFileChooserDialog', { enabled: true })
    await this.sendDebuggerCommand('Page.addScriptToEvaluateOnNewDocument', { source: REMOTE_AUDIT_BOOTSTRAP_SCRIPT })
    await this.applyViewport(this.currentViewport, this.currentScale)
  }

  private async sendDebuggerCommand(method: string, commandParams?: Record<string, unknown>): Promise<unknown> {
    return withTimeout(
      this.view.webContents.debugger.sendCommand(method, commandParams),
      6_000,
      `La commande Chromium ${method} a dépassé le délai autorisé.`
    )
  }

  private sameAuditScope(target: NormalizedAuditUrl): boolean {
    return this.allowedHostnames.has(target.hostname)
  }

  private isKnownNavigationTarget(value: string): boolean {
    try {
      return this.sameAuditScope(normalizeAuditUrl(value, this.mode))
    } catch {
      return false
    }
  }

  private adoptNavigatedUrl(value: string): void {
    if (!value || value.length > 4_096) return
    try {
      const normalized = normalizeAuditUrl(value, this.mode)
      if (this.sameAuditScope(normalized)) this.currentApproved = { ...normalized, resolutionValidated: true }
    } catch {
      // Un état de page non conforme ne devient jamais une URL approuvée.
    }
  }

  private async requestNavigation(value: string): Promise<void> {
    try {
      if (this.auditRunning) {
        this.callbacks.onBlockedNavigation?.(value.slice(0, 4_096), 'La navigation est suspendue pendant l’audit multi-viewport.')
        return
      }
      const normalized = normalizeAuditUrl(value, this.mode)
      if (!this.sameAuditScope(normalized)) {
        this.callbacks.onBlockedNavigation?.(normalized.href, 'Le lien quitte le site actuellement audité.')
        return
      }
      const target = await this.authorizeWithChromium(normalized.href)
      await this.load(target)
    } catch (error) {
      this.callbacks.onBlockedNavigation?.(value.slice(0, 4_096), error instanceof Error ? error.message : 'Navigation refusée.')
    }
  }

  private async requestRedirect(value: string): Promise<void> {
    try {
      if (this.auditRunning) {
        this.callbacks.onBlockedNavigation?.(value.slice(0, 4_096), 'La redirection est suspendue pendant l’audit multi-viewport.')
        return
      }
      const raw = normalizeAuditUrl(value, this.mode)
      const resolvedAddresses = raw.resolutionValidated ? undefined : await this.resolveWithChromium(raw.hostname)
      const target = authorizeAuditRedirect(this.currentApproved, value, resolvedAddresses ? { resolvedAddresses } : {})
      if (this.mode === 'public') this.allowedHostnames.add(target.hostname)
      if (!this.sameAuditScope(target)) {
        this.callbacks.onBlockedNavigation?.(target.href, 'La redirection quitte le site actuellement audité.')
        return
      }
      await this.load(target)
    } catch (error) {
      this.callbacks.onBlockedNavigation?.(value.slice(0, 4_096), error instanceof Error ? error.message : 'Redirection refusée.')
    }
  }

  private async load(target: NormalizedAuditUrl): Promise<void> {
    if (this.closed) throw new Error('La session distante est fermée.')
    const previous = this.currentApproved
    this.currentApproved = target
    const contents = this.view.webContents
    try {
      await withTimeout(
        contents.loadURL(target.href),
        navigationTimeoutMs,
        'Le site n’a pas terminé son chargement dans le délai autorisé.'
      )
    } catch (error) {
      contents.stop()
      this.currentApproved = previous
      throw error
    }
    await contents.executeJavaScript(REMOTE_AUDIT_BOOTSTRAP_SCRIPT).catch(() => undefined)
    this.emitState()
  }

  private safeCurrentUrl(): string {
    const candidate = this.view.webContents.getURL()
    if (!candidate || candidate.length > 4_096) return this.currentApproved.href
    try {
      const normalized = normalizeAuditUrl(candidate, this.mode)
      return this.sameAuditScope(normalized) ? normalized.href : this.currentApproved.href
    } catch {
      return this.currentApproved.href
    }
  }

  private state(): RemotePageState {
    const contents = this.view.webContents
    const safeUrl = this.safeCurrentUrl()
    let path = '/'
    try {
      const current = new URL(safeUrl)
      path = `${current.pathname}${current.search}${current.hash}`
    } catch { /* conserve la route racine */ }
    return {
      url: safeUrl,
      title: (contents.getTitle() || this.initial.hostname).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512),
      path,
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward()
    }
  }

  private emitState(): void {
    if (!this.closed) this.callbacks.onState?.(this.state())
  }

  getState(): RemotePageState {
    return this.state()
  }

  get linkedRoot(): string | null {
    return this.linkedSourceRoot
  }

  associateLinkedRoot(root: string): void {
    if (this.closed) throw new Error('La session distante est fermée.')
    if (this.mode !== 'localhost') throw new Error('Des sources locales ne peuvent être associées qu’à une session localhost.')
    this.linkedSourceRoot = root
  }

  projectSnapshot(issues: ProjectIssue[] = []): ProjectSnapshot {
    const state = this.state()
    const current = new URL(state.url)
    const linked = Boolean(this.linkedRoot)
    return {
      id: `remote-${createHash('sha256').update(`${this.mode}\u001f${this.initial.origin}\u001f${this.linkedRoot ?? ''}`).digest('hex').slice(0, 16)}`,
      name: state.title || current.hostname,
      root: this.linkedRoot ?? this.initial.origin,
      kind: linked ? `Localhost lié · ${current.hostname}` : this.mode === 'localhost' ? 'Localhost · lecture seule' : 'Audit d’URL publique · lecture seule',
      files: 0,
      analyzedAt: new Date().toISOString(),
      source: {
        kind: linked ? 'linked-localhost' : 'remote-url',
        readOnly: !linked,
        url: state.url,
        localRoot: this.linkedRoot,
        network: this.mode
      },
      issues,
      previewHtml: null,
      previewOrigin: null,
      previewBasePath: null,
      previewReadiness: pageReadiness(),
      entryPath: `${current.pathname}${current.search}${current.hash}`,
      routes: [{ path: `${current.pathname}${current.search}${current.hash}`, label: routeLabel(current), title: state.title, theme: 'unknown' }],
      theme: themeProfile(),
      capabilities: { interactive: true, staging: false, framework: linked ? 'Serveur local associé' : null, packageManager: null, buildRequired: false, previewStrategy: 'source' },
      analysis: { truncated: false, scannedFiles: 0, scannedStyles: 0 }
    }
  }

  async setViewBounds(value: RemoteViewBounds): Promise<void> {
    if (this.closed) return
    const normalized = sanitizeBounds(value, this.owner)
    this.view.setBounds(normalized.bounds)
    this.view.setVisible(normalized.visible)
    if (this.auditRunning) {
      this.pendingViewSettings = { viewport: normalized.viewport, scale: normalized.scale }
      return
    }
    await this.applyViewport(normalized.viewport, normalized.scale)
  }

  private async applyViewport(viewportValue: RemoteViewport, scale: number): Promise<void> {
    const operation = this.viewportQueue.then(() => this.applyViewportNow(viewportValue, scale))
    this.viewportQueue = operation.catch(() => undefined)
    return operation
  }

  private takePendingViewSettings(): { viewport: RemoteViewport; scale: number } | null {
    const pending = this.pendingViewSettings
    this.pendingViewSettings = null
    return pending
  }

  private async applyViewportNow(viewportValue: RemoteViewport, scale: number): Promise<void> {
    const viewport = normalizeViewport(viewportValue)
    this.currentViewport = viewport
    this.currentScale = scale
    if (!this.view.webContents.debugger.isAttached()) {
      throw new Error('Le moteur d’émulation Chromium n’est plus attaché à la session.')
    }
    await this.sendDebuggerCommand('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      mobile: viewport.mobile ?? false,
      scale,
      screenOrientation: { type: viewport.width > viewport.height ? 'landscapePrimary' : 'portraitPrimary', angle: viewport.width > viewport.height ? 90 : 0 }
    })
    await this.sendDebuggerCommand('Emulation.setTouchEmulationEnabled', { enabled: viewport.touch ?? false, maxTouchPoints: viewport.touch ? 5 : 1 })
  }

  async navigate(action: 'back' | 'forward' | 'reload' | 'url', value?: string): Promise<RemotePageState> {
    if (this.closed) throw new Error('La session distante est fermée.')
    if (this.auditRunning) throw new Error('La navigation est indisponible pendant l’audit multi-viewport.')
    const history = this.view.webContents.navigationHistory
    if (action === 'back' && history.canGoBack()) history.goBack()
    else if (action === 'forward' && history.canGoForward()) history.goForward()
    else if (action === 'reload') this.view.webContents.reload()
    else if (action === 'url' && value) await this.requestNavigation(value)
    return this.state()
  }

  async focusSelector(selectorValue: unknown): Promise<RemoteFocusResult> {
    const fallbackPath = (() => {
      try {
        const url = new URL(this.currentApproved.href)
        return `${url.pathname}${url.search}${url.hash}`
      } catch {
        return '/'
      }
    })()
    if (this.closed || this.auditRunning) return { found: false, selector: null, path: fallbackPath }
    const selector = typeof selectorValue === 'string'
      ? selectorValue.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
      : ''
    if (!selector || selector.length > 320) return { found: false, selector: null, path: this.state().path }
    const found = Boolean(await this.view.webContents.executeJavaScript(`(() => {
      const selector = ${JSON.stringify(selector)};
      let target = null;
      try { target = document.querySelector(selector); } catch { return false; }
      document.querySelectorAll('[data-responsiver-remote-target]').forEach((element) => element.removeAttribute('data-responsiver-remote-target'));
      if (!target) return false;
      target.setAttribute('data-responsiver-remote-target', '');
      let style = document.querySelector('style[data-responsiver-remote-focus]');
      if (!style) { style = document.createElement('style'); style.setAttribute('data-responsiver-remote-focus', ''); document.head.append(style); }
      style.textContent = '[data-responsiver-remote-target]{outline:3px solid #b94d32!important;outline-offset:4px!important;scroll-margin:80px!important}';
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      return true;
    })()`).catch(() => false))
    return { found, selector, path: this.state().path }
  }

  async setWorkspaceCss(css: string): Promise<void> {
    if (this.closed) throw new Error('La session distante est fermée.')
    if (this.auditRunning) throw new Error('La prévisualisation du code est suspendue pendant l’audit multi-viewport.')
    if (this.workspaceCssKey) {
      await this.view.webContents.removeInsertedCSS(this.workspaceCssKey).catch(() => undefined)
      this.workspaceCssKey = null
    }
    if (css.trim()) this.workspaceCssKey = await this.view.webContents.insertCSS(css, { cssOrigin: 'author' })
  }

  async audit(viewportValues: RemoteViewport[]): Promise<SharedRemoteAuditResult> {
    if (this.closed) throw new Error('La session distante est fermée.')
    if (this.auditRunning) throw new Error('Un audit distant est déjà en cours.')
    this.auditRunning = true
    const originalViewport = this.currentViewport
    const originalScale = this.currentScale
    const requested = (viewportValues.length ? viewportValues : [originalViewport]).slice(0, 8).map(normalizeViewport)
    const auditUrl = this.safeCurrentUrl()
    const rawFindings: RemoteAuditFinding[] = []
    let scannedNodes = 0
    let truncated = false
    let screenshotDataUrl: string | null = null
    try {
      for (const viewport of requested) {
        await this.applyViewport(viewport, Math.min(1, originalScale))
        await new Promise((resolve) => setTimeout(resolve, auditSettlingMs))
        const approvedUrl = this.safeCurrentUrl()
        if (approvedUrl !== auditUrl) throw new Error('La page a changé de route pendant l’audit. Relancez l’analyse sur la nouvelle route.')
        const raw = await withTimeout(
          this.view.webContents.executeJavaScript(buildRemoteAuditScript({
            maxNodes: maxAuditNodesPerViewport,
            maxFindings: maxAuditFindingsPerViewport,
            mobile: viewport.mobile === true,
            touch: viewport.touch === true,
            expectedViewportWidth: viewport.width
          })),
          scriptTimeoutMs,
          'L’analyse du rendu a dépassé le délai autorisé.'
        )
        const result = sanitizeRemoteAuditResult(raw, {
          url: approvedUrl,
          viewport,
          maxFindings: maxAuditFindingsPerViewport,
          maxScannedNodes: maxAuditNodesPerViewport
        })
        scannedNodes += result.scannedNodes
        truncated ||= result.truncated
        rawFindings.push(...result.findings)
      }
      const image = await withTimeout(
        this.view.webContents.capturePage(),
        screenshotTimeoutMs,
        'La capture du rendu a dépassé le délai autorisé.'
      ).catch(() => null)
      if (image && !image.isEmpty()) {
        const size = image.getSize()
        const ratio = Math.min(1, 1_920 / Math.max(1, size.width), 1_200 / Math.max(1, size.height))
        const safeImage = ratio < 1
          ? image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'good' })
          : image
        const png = safeImage.toPNG()
        const estimatedDataUrlLength = 22 + Math.ceil(png.length / 3) * 4
        if (estimatedDataUrlLength <= maxScreenshotDataUrlLength) screenshotDataUrl = `data:image/png;base64,${png.toString('base64')}`
      }
    } finally {
      const restore = this.takePendingViewSettings() ?? { viewport: originalViewport, scale: originalScale }
      await this.applyViewport(restore.viewport, restore.scale).catch(() => undefined)
      this.auditRunning = false
      const lateSettings = this.takePendingViewSettings()
      if (lateSettings) await this.applyViewport(lateSettings.viewport, lateSettings.scale).catch(() => undefined)
    }
    const state = this.state()
    const groupedFindings = consolidateRemoteAuditFindings(rawFindings)
    const consolidated = uniqueIssues(groupedFindings.map((group) => mapFinding(group.finding, group.viewports)))
    return {
      url: state.url,
      path: state.path,
      generatedAt: new Date().toISOString(),
      viewports: requested,
      findings: consolidated.issues,
      screenshotDataUrl,
      truncated: truncated || consolidated.truncated,
      scannedNodes,
      maxNodes: maxAuditNodesPerViewport,
      maxFindings: maxAuditFindingsPerViewport,
      maxTotalFindings: maxAuditFindingsTotal
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.pendingViewSettings = null
    this.resourceHostCache.clear()
    this.resourceHostnames.clear()
    this.resourceHostInflight.clear()
    try { this.view.setVisible(false) } catch { /* la fenêtre propriétaire peut déjà être détruite */ }
    try { this.owner.contentView.removeChildView(this.view) } catch { /* idem */ }
    const contents = this.view.webContents
    if (contents.isDestroyed()) return
    contents.session.webRequest.onBeforeRequest(null)
    if (this.workspaceCssKey) await contents.removeInsertedCSS(this.workspaceCssKey).catch(() => undefined)
    try { if (contents.debugger.isAttached()) contents.debugger.detach() } catch { /* détachement concurrent */ }
    await withTimeout(Promise.all([
      contents.session.clearStorageData(),
      contents.session.clearCache(),
      contents.session.clearAuthCache()
    ]), 5_000, 'Nettoyage de session expiré.').catch(() => undefined)
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
  }
}
