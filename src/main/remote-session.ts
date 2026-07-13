import { randomUUID, createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { basename } from 'node:path'
import { BrowserWindow, View, WebContentsView, type MouseWheelInputEvent, type Rectangle } from 'electron'
import type {
  ProjectIssue,
  ProjectSnapshot,
  RemoteAuditMode,
  RemoteAuditResult as SharedRemoteAuditResult,
  RemoteFocusResult,
  RemoteInspectorSelection,
  RemoteInspectorState,
  RemoteOpenRequest,
  RemotePageState,
  RemoteViewBounds,
  RemoteViewport,
  RemoteVisualStyleResult
} from '../shared/contracts'
import { compileVisualEditCss, type VisualEditOperation } from '../shared/visual-editor'
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

export const REMOTE_INSPECTOR_LIMITS = Object.freeze({
  maxCssBytes: 64 * 1024,
  maxSelectorLength: 320,
  maxRouteLength: 2_048,
  maxTextLength: 180,
  maxClasses: 16,
  maxClassLength: 80,
  maxStyleProperties: 64,
  maxStyleValueLength: 240,
  maxOccurrences: 10_000,
  maxCoordinate: 100_000
})

const inspectorStyleProperties = Object.freeze([
  'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
  'grid-template-columns', 'grid-template-rows', 'font-family', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'text-align', 'color', 'background-color', 'border-color', 'border-width', 'border-style',
  'border-radius', 'box-shadow', 'opacity', 'overflow', 'object-fit', 'visibility'
])

const inspectorStylePropertySet = new Set<string>(inspectorStyleProperties)

const remoteInspectorPayloadFunction = `function () {
  const element = this;
  if (!(element instanceof Element)) return null;
  const clean = (value, maximum) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, maximum);
  const segmentFor = (target, positional) => {
    const parts = [];
    let current = target;
    while (current instanceof Element && parts.length < 6) {
      const parent = current.parentNode;
      const siblings = parent && 'children' in parent ? Array.from(parent.children) : [];
      const index = siblings.indexOf(current);
      if (positional) {
        parts.unshift(index >= 0 ? '*:nth-child(' + (index + 1) + ')' : '*');
      } else {
        if (current.id && current.id.length <= 120) {
          parts.unshift('#' + CSS.escape(current.id));
          break;
        }
        let part = current.tagName.toLowerCase();
        const classes = Array.from(current.classList).filter((name) => name.length <= 80).slice(0, 2);
        if (classes.length) part += '.' + classes.map((name) => CSS.escape(name)).join('.');
        const sameTags = siblings.filter((sibling) => sibling.tagName === current.tagName);
        if (sameTags.length > 1) part += ':nth-of-type(' + (sameTags.indexOf(current) + 1) + ')';
        parts.unshift(part);
      }
      current = current.parentElement;
    }
    return parts.join(' > ') || '*';
  };
  const selectorFor = (positional) => {
    const segments = [];
    let current = element;
    while (current instanceof Element && segments.length < 4) {
      segments.unshift(segmentFor(current, positional));
      const root = current.getRootNode();
      if (!(root instanceof ShadowRoot)) break;
      current = root.host;
    }
    return segments.join(' >>> ');
  };
  const preferred = selectorFor(false);
  const positional = preferred.length <= ${REMOTE_INSPECTOR_LIMITS.maxSelectorLength} ? preferred : selectorFor(true);
  const selector = clean(positional.length <= ${REMOTE_INSPECTOR_LIMITS.maxSelectorLength} ? positional : '*', ${REMOTE_INSPECTOR_LIMITS.maxSelectorLength});
  const rectangle = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const styles = {};
  for (const property of ${JSON.stringify(inspectorStyleProperties)}) styles[property] = clean(style.getPropertyValue(property), ${REMOTE_INSPECTOR_LIMITS.maxStyleValueLength});
  const tag = clean(element.tagName, 32).toLowerCase();
  const excludesEditableText = /^(?:input|option|select|textarea)$/.test(tag) || Boolean(element.closest('[contenteditable]'));
  let occurrences = 1;
  if (!selector.includes(' >>> ')) {
    try { occurrences = Math.min(${REMOTE_INSPECTOR_LIMITS.maxOccurrences}, Math.max(1, document.querySelectorAll(selector).length)); } catch {}
  }
  return {
    selector,
    tag,
    classes: Array.from(element.classList).slice(0, ${REMOTE_INSPECTOR_LIMITS.maxClasses}).map((name) => clean(name, ${REMOTE_INSPECTOR_LIMITS.maxClassLength})),
    role: clean(element.getAttribute('role'), 80) || null,
    ariaLabel: clean(element.getAttribute('aria-label'), 160) || null,
    rect: { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height },
    styles,
    occurrences,
    insideFrame: window.top !== window,
    text: excludesEditableText ? '' : clean(element.innerText || element.textContent, ${REMOTE_INSPECTOR_LIMITS.maxTextLength})
  };
}`

function cleanInspectorText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : ''
}

function boundedInspectorNumber(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(Math.min(maximum, Math.max(minimum, value)) * 100) / 100
}

export function sanitizeRemoteInspectorSelection(
  value: unknown,
  options: { route: string; editable: boolean }
): Omit<RemoteInspectorSelection, 'projectId'> | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const selector = cleanInspectorText(candidate.selector, REMOTE_INSPECTOR_LIMITS.maxSelectorLength)
  const tag = cleanInspectorText(candidate.tag, 32).toLowerCase()
  if (!selector || !/^[a-z][a-z\d-]*$/i.test(tag)) return null
  const rawRectangle = candidate.rect && typeof candidate.rect === 'object' ? candidate.rect as Record<string, unknown> : null
  if (!rawRectangle) return null
  const x = boundedInspectorNumber(rawRectangle.x, -REMOTE_INSPECTOR_LIMITS.maxCoordinate, REMOTE_INSPECTOR_LIMITS.maxCoordinate)
  const y = boundedInspectorNumber(rawRectangle.y, -REMOTE_INSPECTOR_LIMITS.maxCoordinate, REMOTE_INSPECTOR_LIMITS.maxCoordinate)
  const width = boundedInspectorNumber(rawRectangle.width, 0, REMOTE_INSPECTOR_LIMITS.maxCoordinate)
  const height = boundedInspectorNumber(rawRectangle.height, 0, REMOTE_INSPECTOR_LIMITS.maxCoordinate)
  if (x === null || y === null || width === null || height === null) return null
  const styles: Record<string, string> = {}
  if (candidate.styles && typeof candidate.styles === 'object') {
    for (const [property, rawValue] of Object.entries(candidate.styles as Record<string, unknown>).slice(0, REMOTE_INSPECTOR_LIMITS.maxStyleProperties)) {
      if (!inspectorStylePropertySet.has(property) || typeof rawValue !== 'string') continue
      styles[property] = cleanInspectorText(rawValue, REMOTE_INSPECTOR_LIMITS.maxStyleValueLength)
    }
  }
  const classes = Array.isArray(candidate.classes)
    ? candidate.classes
      .map((entry) => cleanInspectorText(entry, REMOTE_INSPECTOR_LIMITS.maxClassLength))
      .filter(Boolean)
      .slice(0, REMOTE_INSPECTOR_LIMITS.maxClasses)
    : []
  const rawOccurrences = typeof candidate.occurrences === 'number' && Number.isSafeInteger(candidate.occurrences)
    ? candidate.occurrences
    : 1
  const insideFrame = candidate.insideFrame === true
  return {
    selector,
    tag,
    classes,
    role: cleanInspectorText(candidate.role, 80) || null,
    ariaLabel: cleanInspectorText(candidate.ariaLabel, 160) || null,
    rect: { x, y, width, height },
    styles,
    occurrences: Math.min(REMOTE_INSPECTOR_LIMITS.maxOccurrences, Math.max(1, rawOccurrences)),
    route: cleanInspectorText(options.route, REMOTE_INSPECTOR_LIMITS.maxRouteLength) || '/',
    text: cleanInspectorText(candidate.text, REMOTE_INSPECTOR_LIMITS.maxTextLength),
    insideFrame,
    editable: options.editable && selector !== '*' && !insideFrame && !selector.includes(' >>> ')
  }
}

export interface RemoteSessionCallbacks {
  onState?: (state: RemotePageState) => void
  onBlockedNavigation?: (url: string, detail: string) => void
  onInspectorSelection?: (selection: Omit<RemoteInspectorSelection, 'projectId'>) => void
  onInspectorShortcut?: () => void
  onInspectorCanceled?: () => void
  onInspectorReady?: () => void
  onZoomGesture?: (gesture: { deltaY: number; x: number; y: number }) => void
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

function sanitizeBounds(value: RemoteViewBounds, owner: BrowserWindow): { clipBounds: Rectangle; viewBounds: Rectangle; scale: number; viewport: RemoteViewport; visible: boolean } {
  const contentBounds = owner.getContentBounds()
  const rawClip = value.clip && typeof value.clip === 'object' ? value.clip : value
  const clipX = clampInteger(rawClip.x, 0, Math.max(0, contentBounds.width - 1), 0)
  const clipY = clampInteger(rawClip.y, 0, Math.max(0, contentBounds.height - 1), 0)
  const clipWidth = clampInteger(rawClip.width, 1, Math.max(1, contentBounds.width - clipX), 1)
  const clipHeight = clampInteger(rawClip.height, 1, Math.max(1, contentBounds.height - clipY), 1)
  const nativeLimit = 8_192
  const x = clampInteger(value.x, -nativeLimit, contentBounds.width + nativeLimit, clipX)
  const y = clampInteger(value.y, -nativeLimit, contentBounds.height + nativeLimit, clipY)
  const width = clampInteger(value.width, 1, nativeLimit, 1)
  const height = clampInteger(value.height, 1, nativeLimit, 1)
  const scale = typeof value.scale === 'number' && Number.isFinite(value.scale) ? Math.min(2, Math.max(0.1, value.scale)) : 1
  const viewport = value.viewport && typeof value.viewport === 'object' ? value.viewport : defaultViewport
  return {
    clipBounds: { x: clipX, y: clipY, width: clipWidth, height: clipHeight },
    viewBounds: { x: x - clipX, y: y - clipY, width, height },
    scale,
    viewport: normalizeViewport(viewport),
    visible: value.visible === true
  }
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
  private readonly clipView: View
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
  private workspaceCss: string | null = null
  private visualPreviewCssKey: string | null = null
  private visualPreviewCss: string | null = null
  private inspectorActive = false
  private inspectorRequested = false
  private inspectorSelectionSequence = 0
  private inspectorOperationEpoch = 0
  private navigationVisualToolsReset: Promise<void> = Promise.resolve()
  private visualToolsRestoreQueue: Promise<void> = Promise.resolve()
  private readonly allowedHostnames = new Set<string>()
  private readonly resourceHostCache = new Map<string, { allowed: boolean; expiresAt: number }>()
  private readonly resourceHostnames = new Set<string>()
  private readonly resourceHostInflight = new Map<string, Promise<boolean>>()
  private pendingViewSettings: { viewport: RemoteViewport; scale: number } | null = null
  private viewportQueue: Promise<void> = Promise.resolve()
  private lastViewportRequest: { key: string; promise: Promise<void> } | null = null
  private readonly debuggerMessageHandler = (_event: unknown, method: string, params: unknown): void => {
    if (method === 'Overlay.inspectModeCanceled') {
      if (!this.inspectorRequested || !this.inspectorActive || this.auditRunning || this.closed) return
      this.inspectorRequested = false
      this.inspectorActive = false
      this.inspectorOperationEpoch += 1
      this.inspectorSelectionSequence += 1
      this.callbacks.onInspectorCanceled?.()
      return
    }
    if (method !== 'Overlay.inspectNodeRequested' || !this.inspectorActive || this.auditRunning || this.closed) return
    const backendNodeId = params && typeof params === 'object' ? (params as { backendNodeId?: unknown }).backendNodeId : null
    if (typeof backendNodeId !== 'number' || !Number.isSafeInteger(backendNodeId) || backendNodeId <= 0) return
    const sequence = ++this.inspectorSelectionSequence
    void this.resolveInspectorSelection(backendNodeId, sequence)
  }
  private readonly debuggerDetachHandler = (): void => {
    if (this.closed || (!this.inspectorRequested && !this.inspectorActive)) return
    this.inspectorRequested = false
    this.inspectorActive = false
    this.inspectorOperationEpoch += 1
    this.inspectorSelectionSequence += 1
    this.callbacks.onInspectorCanceled?.()
  }

  private constructor(options: RemoteSessionCreateOptions, initial: NormalizedAuditUrl) {
    this.owner = options.owner
    this.mode = options.request.mode
    this.linkedSourceRoot = options.linkedRoot ?? null
    this.callbacks = options
    this.initial = initial
    this.currentApproved = initial
    this.allowedHostnames.add(initial.hostname)
    this.clipView = new View()
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
    this.clipView.setVisible(false)
    this.clipView.addChildView(this.view)
    this.owner.contentView.addChildView(this.clipView)
    this.view.webContents.debugger.on('message', this.debuggerMessageHandler)
    this.view.webContents.debugger.on('detach', this.debuggerDetachHandler)
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
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.navigationVisualToolsReset = this.resetVisualToolsForNavigation()
    })
    contents.on('did-start-loading', () => this.emitState())
    contents.on('did-stop-loading', () => {
      this.emitState()
      const reset = this.navigationVisualToolsReset
      void this.enqueueVisualToolsOperation(async () => {
        await reset
        await this.restoreVisualToolsAfterNavigation()
      }).catch(() => undefined)
    })
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
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      const shortcut = input.key === 'F12' || ((input.meta || input.control) && input.alt && key === 'i') || ((input.meta || input.control) && input.shift && key === 'c')
      if (!shortcut) return
      event.preventDefault()
      this.callbacks.onInspectorShortcut?.()
    })
    contents.on('before-mouse-event', (event, mouse) => {
      if (mouse.type !== 'mouseWheel') return
      const modifiers = mouse.modifiers ?? []
      if (!modifiers.some((modifier) => modifier === 'control' || modifier === 'ctrl' || modifier === 'meta' || modifier === 'command' || modifier === 'cmd')) return
      event.preventDefault()
      const wheel = mouse as MouseWheelInputEvent
      const rawDelta = typeof wheel.deltaY === 'number' && Number.isFinite(wheel.deltaY)
        ? wheel.deltaY
        : typeof wheel.wheelTicksY === 'number' && Number.isFinite(wheel.wheelTicksY) ? -wheel.wheelTicksY * 53 : 0
      this.callbacks.onZoomGesture?.({
        deltaY: Math.min(1_000, Math.max(-1_000, rawDelta)),
        x: clampInteger(mouse.x, 0, 8_192, 0),
        y: clampInteger(mouse.y, 0, 8_192, 0)
      })
    })
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

  private get canPreviewVisualStyle(): boolean {
    return this.mode === 'localhost' && Boolean(this.linkedSourceRoot)
  }

  private inspectorState(): RemoteInspectorState {
    return {
      active: this.inspectorActive,
      editable: this.canPreviewVisualStyle,
      path: this.state().path
    }
  }

  private async setInspectorMode(active: boolean): Promise<void> {
    if (!this.view.webContents.debugger.isAttached()) {
      if (!active) return
      throw new Error('Le moteur d’inspection Chromium n’est plus attaché à la session.')
    }
    await this.sendDebuggerCommand('DOM.enable')
    await this.sendDebuggerCommand('Overlay.enable')
    const highlightConfig = {
      showInfo: true,
      showStyles: true,
      showAccessibilityInfo: true,
      contentColor: { r: 59, g: 130, b: 160, a: 0.09 },
      paddingColor: { r: 185, g: 77, b: 50, a: 0.12 },
      borderColor: { r: 185, g: 77, b: 50, a: 0.92 },
      marginColor: { r: 185, g: 77, b: 50, a: 0.08 }
    }
    await this.sendDebuggerCommand('Overlay.setInspectMode', {
      mode: active ? 'searchForNode' : 'none',
      highlightConfig
    })
    if (!active) await this.sendDebuggerCommand('Overlay.hideHighlight').catch(() => undefined)
  }

  private async resolveInspectorSelection(backendNodeId: number, sequence: number): Promise<void> {
    let objectId: string | null = null
    try {
      const resolved = await this.sendDebuggerCommand('DOM.resolveNode', { backendNodeId, objectGroup: 'responsiver-inspector' }) as {
        object?: { objectId?: unknown }
      }
      objectId = typeof resolved.object?.objectId === 'string' ? resolved.object.objectId : null
      if (!objectId) return
      const evaluated = await this.sendDebuggerCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: remoteInspectorPayloadFunction,
        returnByValue: true,
        silent: true
      }) as { result?: { value?: unknown }; exceptionDetails?: unknown }
      if (evaluated.exceptionDetails || sequence !== this.inspectorSelectionSequence || !this.inspectorActive || this.auditRunning || this.closed) return
      const selection = sanitizeRemoteInspectorSelection(evaluated.result?.value, {
        route: this.state().path,
        editable: this.canPreviewVisualStyle
      })
      if (selection) this.callbacks.onInspectorSelection?.(selection)
    } catch {
      // Une page hostile ou en navigation peut invalider le nœud entre le clic
      // et sa résolution. Aucune donnée partielle n’est alors remontée.
    } finally {
      if (objectId && this.view.webContents.debugger.isAttached()) {
        await this.sendDebuggerCommand('Runtime.releaseObject', { objectId }).catch(() => undefined)
      }
      if (this.inspectorRequested && this.inspectorActive && !this.auditRunning && !this.closed) {
        await this.setInspectorMode(true).catch(() => undefined)
      }
    }
  }

  private enqueueVisualToolsOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.visualToolsRestoreQueue.catch(() => undefined).then(operation)
    this.visualToolsRestoreQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async resetVisualToolsForNavigation(): Promise<void> {
    const inspectorWasActive = this.inspectorActive
    this.inspectorActive = false
    this.inspectorSelectionSequence += 1
    return this.enqueueVisualToolsOperation(async () => {
      await this.removeWorkspaceCss()
      await this.removeVisualPreviewCss()
      if (inspectorWasActive) await this.setInspectorMode(false).catch(() => undefined)
    })
  }

  private async removeVisualPreviewCss(): Promise<void> {
    const cssKey = this.visualPreviewCssKey
    this.visualPreviewCssKey = null
    if (cssKey && !this.view.webContents.isDestroyed()) {
      await this.view.webContents.removeInsertedCSS(cssKey).catch(() => undefined)
    }
  }

  private async removeWorkspaceCss(): Promise<void> {
    const cssKey = this.workspaceCssKey
    this.workspaceCssKey = null
    if (cssKey && !this.view.webContents.isDestroyed()) {
      await this.view.webContents.removeInsertedCSS(cssKey).catch(() => undefined)
    }
  }

  private async restoreVisualToolsAfterNavigation(): Promise<void> {
    const current = (): boolean => !this.closed && !this.auditRunning && !this.view.webContents.isDestroyed() && !this.view.webContents.isLoading()
    if (!current()) return
    const workspaceCss = this.workspaceCss
    const css = this.visualPreviewCss
    // Une insertion demandée pendant le chargement peut encore viser l’ancien
    // document tout en produisant une clé valide. Après chaque navigation, les
    // clés sont donc invalidées puis les états désirés sont réinjectés.
    await this.removeWorkspaceCss()
    await this.removeVisualPreviewCss()
    if (!current()) return
    if (workspaceCss && this.workspaceCss === workspaceCss) {
      const key = await this.view.webContents.insertCSS(workspaceCss, { cssOrigin: 'author' })
      if (!current() || this.workspaceCss !== workspaceCss) await this.view.webContents.removeInsertedCSS(key).catch(() => undefined)
      else this.workspaceCssKey = key
    }
    if (css && this.canPreviewVisualStyle && this.visualPreviewCss === css) {
      if (!current()) return
      const key = await this.view.webContents.insertCSS(css, { cssOrigin: 'author' })
      if (!current() || this.visualPreviewCss !== css) await this.view.webContents.removeInsertedCSS(key).catch(() => undefined)
      else this.visualPreviewCssKey = key
    }
    if (this.inspectorRequested && current()) {
      try {
        await this.setInspectorMode(true)
        if (!current() || !this.inspectorRequested) {
          await this.setInspectorMode(false).catch(() => undefined)
          return
        }
        this.inspectorActive = true
        this.callbacks.onInspectorReady?.()
      } catch {
        if (this.inspectorRequested && !this.closed) {
          this.inspectorRequested = false
          this.inspectorActive = false
          this.callbacks.onInspectorCanceled?.()
        }
      }
    }
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
    await this.visualToolsRestoreQueue
    await contents.executeJavaScript(REMOTE_AUDIT_BOOTSTRAP_SCRIPT).catch(() => undefined)
    this.emitState()
  }

  private async performHistoryNavigation(action: () => void): Promise<void> {
    const contents = this.view.webContents
    let onLoadCompleted: (() => void) | null = null
    let onSameDocument: ((_event: unknown, _url: string, isMainFrame: boolean) => void) | null = null
    const completed = new Promise<'load' | 'same-document'>((resolve) => {
      onLoadCompleted = () => resolve('load')
      onSameDocument = (_event, _url, isMainFrame) => {
        if (isMainFrame) resolve('same-document')
      }
      contents.once('did-stop-loading', onLoadCompleted)
      contents.on('did-navigate-in-page', onSameDocument)
    })
    try {
      action()
      const result = await withTimeout(completed, navigationTimeoutMs, 'La navigation n’a pas terminé son chargement dans le délai autorisé.')
      if (result === 'load') await this.visualToolsRestoreQueue
    } finally {
      if (onLoadCompleted) contents.removeListener('did-stop-loading', onLoadCompleted)
      if (onSameDocument) contents.removeListener('did-navigate-in-page', onSameDocument)
    }
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

  async startInspector(): Promise<RemoteInspectorState> {
    if (this.closed) throw new Error('La session distante est fermée.')
    const epoch = ++this.inspectorOperationEpoch
    this.inspectorRequested = true
    if (this.auditRunning) return this.inspectorState()
    return this.enqueueVisualToolsOperation(async () => {
      try {
        await this.viewportQueue
        if (epoch !== this.inspectorOperationEpoch || !this.inspectorRequested || this.closed || this.auditRunning) return this.inspectorState()
        await this.setInspectorMode(true)
        if (epoch !== this.inspectorOperationEpoch || !this.inspectorRequested || this.closed || this.auditRunning) {
          await this.setInspectorMode(false).catch(() => undefined)
          return this.inspectorState()
        }
        this.inspectorActive = true
      } catch (error) {
        if (epoch === this.inspectorOperationEpoch) this.inspectorRequested = false
        throw error
      }
      return this.inspectorState()
    })
  }

  async stopInspector(): Promise<RemoteInspectorState> {
    if (this.closed) throw new Error('La session distante est fermée.')
    this.inspectorOperationEpoch += 1
    this.inspectorRequested = false
    this.inspectorActive = false
    this.inspectorSelectionSequence += 1
    return this.enqueueVisualToolsOperation(async () => {
      await this.setInspectorMode(false)
      return this.inspectorState()
    })
  }

  async previewVisualStyle(visualEdits: VisualEditOperation[], route: string): Promise<RemoteVisualStyleResult> {
    if (this.closed) throw new Error('La session distante est fermée.')
    if (this.auditRunning) throw new Error('La prévisualisation visuelle est suspendue pendant l’audit multi-viewport.')
    if (!this.canPreviewVisualStyle) {
      throw new Error('La prévisualisation CSS est réservée à un localhost associé à ses sources locales.')
    }
    const compiled = compileVisualEditCss(visualEdits, route)
    if (compiled.invalid.length || compiled.conflicts.length) {
      throw new Error(compiled.invalid[0]?.reason ?? compiled.conflicts[0]?.reason ?? 'Le plan visuel est invalide.')
    }
    const css = compiled.css
    const bytes = Buffer.byteLength(css, 'utf8')
    if (bytes > REMOTE_INSPECTOR_LIMITS.maxCssBytes) {
      throw new Error(`La feuille de prévisualisation dépasse ${REMOTE_INSPECTOR_LIMITS.maxCssBytes} octets.`)
    }
    this.visualPreviewCss = css.trim() ? css : null
    return this.enqueueVisualToolsOperation(async () => {
      await this.removeVisualPreviewCss()
      if (this.visualPreviewCss === css && css.trim()) this.visualPreviewCssKey = await this.view.webContents.insertCSS(css, { cssOrigin: 'author' })
      return { applied: Boolean(this.visualPreviewCssKey), bytes, path: this.state().path }
    })
  }

  async clearVisualStyle(): Promise<RemoteVisualStyleResult> {
    if (this.closed) throw new Error('La session distante est fermée.')
    this.visualPreviewCss = null
    return this.enqueueVisualToolsOperation(async () => {
      await this.removeVisualPreviewCss()
      return { applied: false, bytes: 0, path: this.state().path }
    })
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
      capabilities: { interactive: true, staging: linked, framework: linked ? 'Serveur local associé' : null, packageManager: null, buildRequired: false, previewStrategy: 'source' },
      analysis: { truncated: false, scannedFiles: 0, scannedStyles: 0 }
    }
  }

  async setViewBounds(value: RemoteViewBounds): Promise<void> {
    if (this.closed) return
    const normalized = sanitizeBounds(value, this.owner)
    this.clipView.setBounds(normalized.clipBounds)
    this.view.setBounds(normalized.viewBounds)
    this.view.setVisible(normalized.visible)
    this.clipView.setVisible(normalized.visible)
    if (this.auditRunning) {
      this.pendingViewSettings = { viewport: normalized.viewport, scale: normalized.scale }
      return
    }
    await this.applyViewport(normalized.viewport, normalized.scale)
  }

  private async applyViewport(viewportValue: RemoteViewport, scale: number): Promise<void> {
    const viewport = normalizeViewport(viewportValue)
    const normalizedScale = Math.min(2, Math.max(0.1, scale))
    const key = `${viewport.width}x${viewport.height}:${viewport.deviceScaleFactor ?? 1}:${viewport.mobile === true ? 1 : 0}:${viewport.touch === true ? 1 : 0}:${normalizedScale.toFixed(4)}`
    if (key === this.lastViewportRequest?.key) return this.lastViewportRequest.promise
    const operation = this.viewportQueue.then(() => this.applyViewportNow(viewport, normalizedScale))
    this.viewportQueue = operation.catch(() => {
      if (this.lastViewportRequest?.promise === operation) this.lastViewportRequest = null
    })
    this.lastViewportRequest = { key, promise: operation }
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
    if (action === 'back') {
      if (!history.canGoBack()) return this.state()
      await this.performHistoryNavigation(() => history.goBack())
    } else if (action === 'forward') {
      if (!history.canGoForward()) return this.state()
      await this.performHistoryNavigation(() => history.goForward())
    } else if (action === 'reload') {
      await this.performHistoryNavigation(() => this.view.webContents.reload())
    } else if (action === 'url' && value) await this.requestNavigation(value)
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
    this.workspaceCss = css.trim() ? css : null
    await this.enqueueVisualToolsOperation(async () => {
      await this.removeWorkspaceCss()
      if (this.workspaceCss === css && css.trim()) this.workspaceCssKey = await this.view.webContents.insertCSS(css, { cssOrigin: 'author' })
    })
  }

  async audit(viewportValues: RemoteViewport[]): Promise<SharedRemoteAuditResult> {
    if (this.closed) throw new Error('La session distante est fermée.')
    if (this.auditRunning) throw new Error('Un audit distant est déjà en cours.')
    const restoreInspector = this.inspectorRequested
    this.auditRunning = true
    await this.visualToolsRestoreQueue.catch(() => undefined)
    this.inspectorActive = false
    this.inspectorSelectionSequence += 1
    const originalViewport = this.currentViewport
    const originalScale = this.currentScale
    const requested = (viewportValues.length ? viewportValues : [originalViewport]).slice(0, 8).map(normalizeViewport)
    const auditUrl = this.safeCurrentUrl()
    const rawFindings: RemoteAuditFinding[] = []
    let scannedNodes = 0
    let truncated = false
    let screenshotDataUrl: string | null = null
    try {
      if (restoreInspector) await this.setInspectorMode(false)
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
      await this.enqueueVisualToolsOperation(() => this.restoreVisualToolsAfterNavigation()).catch(() => undefined)
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
    this.inspectorOperationEpoch += 1
    this.inspectorRequested = false
    this.inspectorActive = false
    this.inspectorSelectionSequence += 1
    this.pendingViewSettings = null
    this.resourceHostCache.clear()
    this.resourceHostnames.clear()
    this.resourceHostInflight.clear()
    try { this.view.setVisible(false) } catch { /* la fenêtre propriétaire peut déjà être détruite */ }
    try { this.clipView.setVisible(false) } catch { /* idem */ }
    try { this.clipView.removeChildView(this.view) } catch { /* idem */ }
    try { this.owner.contentView.removeChildView(this.clipView) } catch { /* idem */ }
    const contents = this.view.webContents
    contents.debugger.removeListener('message', this.debuggerMessageHandler)
    contents.debugger.removeListener('detach', this.debuggerDetachHandler)
    if (contents.isDestroyed()) return
    await this.visualToolsRestoreQueue.catch(() => undefined)
    contents.session.webRequest.onBeforeRequest(null)
    if (contents.debugger.isAttached()) await this.setInspectorMode(false).catch(() => undefined)
    if (this.workspaceCssKey) await contents.removeInsertedCSS(this.workspaceCssKey).catch(() => undefined)
    if (this.visualPreviewCssKey) await contents.removeInsertedCSS(this.visualPreviewCssKey).catch(() => undefined)
    this.workspaceCssKey = null
    this.workspaceCss = null
    this.visualPreviewCssKey = null
    this.visualPreviewCss = null
    try { if (contents.debugger.isAttached()) contents.debugger.detach() } catch { /* détachement concurrent */ }
    await withTimeout(Promise.all([
      contents.session.clearStorageData(),
      contents.session.clearCache(),
      contents.session.clearAuthCache()
    ]), 5_000, 'Nettoyage de session expiré.').catch(() => undefined)
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
  }
}
