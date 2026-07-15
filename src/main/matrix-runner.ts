import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import type {
  MatrixJob,
  MatrixObservation,
  MatrixRunProgress,
  MatrixScenarioResult,
  MatrixSnapshot,
  MatrixStateId,
  RuntimeAudit,
  RuntimeAuditFinding,
  RuntimeAuditRule
} from '../shared/contracts'
import { createMatrixJobs, matrixCellStatus } from '../shared/regression-matrix'
import type { CanonicalDeviceProfile } from '../shared/device-profiles'
import { buildRemoteAuditScript, REMOTE_AUDIT_BOOTSTRAP_SCRIPT, sanitizeRemoteAuditResult } from './remote-audit'

const CELL_TIMEOUT_MS = 12_000
const MAX_MATRIX_CELLS = 120

interface MatrixRunnerOptions {
  projectId: string
  role: MatrixSnapshot['role']
  origin: string
  routes: readonly string[]
  devices: readonly CanonicalDeviceProfile[]
  states: readonly MatrixStateId[]
  onProgress?: (progress: Omit<MatrixRunProgress, 'runId'>) => void
}

function withTimeout<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout) })
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

function safeMatrixUrl(origin: string, route: string): string {
  const base = new URL(origin)
  const target = new URL(route, `${base.origin}/`)
  if (target.origin !== base.origin) throw new Error('Une route de matrice sort du runner local autorisé.')
  target.username = ''
  target.password = ''
  return target.href
}

const STABILIZE_SCRIPT = String.raw`(() => new Promise((resolve) => {
  let style = document.querySelector('style[data-responsiver-matrix-stability]');
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('data-responsiver-matrix-stability', '');
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
    document.documentElement.append(style);
  }
  const fonts = document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => undefined) : Promise.resolve();
  const images = Promise.all(Array.from(document.images || []).slice(0, 120).map((image) => image.complete ? undefined : new Promise((done) => {
    const finish = () => done(undefined);
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    setTimeout(finish, 1200);
  })));
  Promise.all([fonts, images]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(true), 120))));
}))()`

function scenarioScript(state: MatrixStateId, requestId: string): string {
  const encodedState = JSON.stringify(state)
  const encodedRequest = JSON.stringify(requestId)
  return String.raw`(async () => {
    const state = ${encodedState};
    const requestId = ${encodedRequest};
    const result = { requestId, state, supported: true, label: state === 'initial' ? 'Initial' : state === 'navigation-open' ? 'Navigation ouverte' : 'Focus clavier', target: null, detail: null };
    if (state === 'initial') return result;
    if (state === 'keyboard-focus') {
      const target = Array.from(document.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .find((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
      if (!(target instanceof HTMLElement)) return { ...result, supported: false, detail: 'Aucune cible clavier visible.' };
      target.focus({ preventScroll: true });
      result.target = target.id ? '#' + CSS.escape(target.id) : target.tagName.toLowerCase();
      await new Promise((done) => requestAnimationFrame(() => done(undefined)));
      return result;
    }
    const explicit = Array.from(document.querySelectorAll('[aria-controls][aria-expanded], button[data-bs-toggle="collapse"], .navbar-toggler, .menu-toggle, .hamburger'));
    const labelled = Array.from(document.querySelectorAll('button:not([disabled]), [role="button"][aria-label]')).filter((element) => /menu|navigation/i.test((element.getAttribute('aria-label') || '') + ' ' + (element.textContent || '')));
    const target = [...explicit, ...labelled].find((element) => {
      if (!(element instanceof HTMLElement) || !element.isConnected || !element.getClientRects().length) return false;
      if (element.closest('form') && ((element instanceof HTMLButtonElement && element.type !== 'button') || element instanceof HTMLInputElement)) return false;
      return !element.closest('a[href], [contenteditable="true"]');
    });
    if (!(target instanceof HTMLElement)) return { ...result, supported: false, detail: 'Aucun déclencheur de navigation sûr.' };
    const selector = target.id ? '#' + CSS.escape(target.id) : target.classList.length ? target.tagName.toLowerCase() + '.' + CSS.escape(target.classList[0]) : target.tagName.toLowerCase();
    result.target = selector;
    const expandedBefore = target.getAttribute('aria-expanded');
    if (expandedBefore !== 'true') target.click();
    await new Promise((done) => setTimeout(done, 220));
    const controlledId = target.getAttribute('aria-controls');
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    const expandedAfter = target.getAttribute('aria-expanded');
    const visibleControlled = controlled instanceof HTMLElement && controlled.getClientRects().length > 0 && getComputedStyle(controlled).visibility !== 'hidden';
    if (expandedBefore !== 'true' && expandedAfter !== 'true' && !visibleControlled) return { ...result, supported: false, detail: 'Le déclencheur n’a pas produit un état ouvert vérifiable.' };
    return result;
  })()`
}

function runtimeAuditFromRemote(raw: ReturnType<typeof sanitizeRemoteAuditResult>, mobile: boolean): RuntimeAudit {
  const viewport = { width: raw.viewport.width, height: raw.viewport.height, mobile }
  const findings: RuntimeAuditFinding[] = raw.findings.map((finding) => ({
    id: finding.id,
    rule: finding.rule as RuntimeAuditRule,
    severity: finding.severity === 'error' ? 'error' : 'warning',
    title: finding.title,
    description: finding.description,
    proposal: finding.evidence[0]?.summary ?? 'Réviser cette zone dans le Laboratoire.',
    confidence: finding.confidence,
    selector: finding.selector,
    tag: finding.selector.split(/[.#[:\s>+~]/)[0] || 'element',
    label: finding.title,
    rect: finding.rect,
    route: raw.route.path,
    viewport
  }))
  const overflows = findings.filter((finding) => finding.rule === 'layout.viewport-overflow').slice(0, 8).map((finding) => ({
    selector: finding.selector,
    tag: finding.tag,
    label: finding.label,
    left: finding.rect.x,
    right: finding.rect.x + finding.rect.width,
    width: finding.rect.width
  }))
  return {
    version: 2,
    path: raw.route.path,
    route: raw.route.path,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    viewport,
    documentWidth: viewport.width + Math.max(0, ...overflows.map((overflow) => overflow.right - viewport.width)),
    overflowCount: overflows.length,
    overflows,
    findingCount: findings.length,
    findings,
    inspectedNodes: raw.scannedNodes,
    truncated: raw.truncated,
    limits: {
      maxNodes: raw.maxNodes,
      maxFindings: raw.maxFindings,
      maxFindingsPerRule: raw.maxFindings,
      maxLegacyOverflows: 8,
      maxContrastChecks: raw.maxNodes
    }
  }
}

function sanitizeScenarioResult(value: unknown, job: MatrixJob): MatrixScenarioResult {
  const candidate = value && typeof value === 'object' ? value as Partial<MatrixScenarioResult> : {}
  const clean = (entry: unknown, limit: number): string | null => {
    if (typeof entry !== 'string') return null
    const normalized = entry.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    return normalized ? normalized.slice(0, limit) : null
  }
  return {
    requestId: job.id,
    state: job.state,
    supported: candidate.supported === true,
    label: job.state === 'initial' ? 'Initial' : job.state === 'navigation-open' ? 'Navigation ouverte' : 'Focus clavier',
    target: clean(candidate.target, 320),
    detail: clean(candidate.detail, 280)
  }
}

async function collectCell(window: BrowserWindow, origin: string, job: MatrixJob): Promise<MatrixObservation> {
  const startedAt = Date.now()
  const target = safeMatrixUrl(origin, job.route)
  try {
    window.setContentSize(job.width, job.height)
    await withTimeout(window.loadURL(target), CELL_TIMEOUT_MS, 'Chargement de cellule expiré.')
    await window.webContents.executeJavaScript(REMOTE_AUDIT_BOOTSTRAP_SCRIPT).catch(() => undefined)
    await withTimeout(window.webContents.executeJavaScript(STABILIZE_SCRIPT), 4_000, 'Stabilisation de cellule expirée.')
    const scenario = sanitizeScenarioResult(await withTimeout(window.webContents.executeJavaScript(scenarioScript(job.state, job.id)), 3_000, 'État de cellule expiré.'), job)
    if (!scenario?.supported) {
      return { job, status: 'unsupported', audit: null, scenario: scenario ?? null, durationMs: Date.now() - startedAt, detail: scenario?.detail ?? 'État non disponible.' }
    }
    await withTimeout(window.webContents.executeJavaScript(STABILIZE_SCRIPT), 4_000, 'Stabilisation après état expirée.')
    const raw = await withTimeout(window.webContents.executeJavaScript(buildRemoteAuditScript({
      maxNodes: 2_500,
      maxFindings: 120,
      maxRuntimeErrors: 20,
      mobile: job.width < 1_100,
      touch: job.width < 1_100,
      expectedViewportWidth: job.width
    })), 5_000, 'Audit de cellule expiré.')
    const sanitized = sanitizeRemoteAuditResult(raw, { url: target, viewport: { width: job.width, height: job.height, deviceScaleFactor: 1 }, maxFindings: 120, maxScannedNodes: 2_500 })
    const audit = runtimeAuditFromRemote(sanitized, job.width < 1_100)
    return {
      job,
      status: audit.truncated ? 'error' : matrixCellStatus(audit),
      audit,
      scenario,
      durationMs: Date.now() - startedAt,
      detail: audit.truncated ? 'L’audit a atteint sa limite de sécurité.' : null
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'La cellule n’a pas pu être rendue.'
    return { job, status: /chargement|rendu|ERR_/i.test(detail) ? 'render-failed' : 'timeout', audit: null, scenario: null, durationMs: Date.now() - startedAt, detail }
  }
}

export async function runProjectMatrix(options: MatrixRunnerOptions): Promise<MatrixSnapshot> {
  const jobs = createMatrixJobs(options.routes, options.devices, options.states)
  if (!jobs.length || jobs.length > MAX_MATRIX_CELLS) throw new Error('Le plan de matrice est vide ou dépasse 120 cellules.')
  const runPartition = `responsiver-matrix-${randomUUID()}`
  const isolatedSession = session.fromPartition(runPartition, { cache: false })
  const allowedOrigin = new URL(options.origin).origin
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url)
      const methodAllowed = details.method === 'GET' || details.method === 'HEAD'
      const sourceAllowed = url.origin === allowedOrigin || url.protocol === 'data:' || url.protocol === 'blob:'
      const fontAllowed = url.protocol === 'https:' && (
        url.hostname === 'fonts.googleapis.com' && details.resourceType === 'stylesheet' ||
        url.hostname === 'fonts.gstatic.com' && details.resourceType === 'font'
      )
      callback({ cancel: !methodAllowed || !sourceAllowed && !fontAllowed })
    } catch {
      callback({ cancel: true })
    }
  })
  const worker = new BrowserWindow({
    show: false,
    frame: false,
    width: 393,
    height: 852,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: runPartition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      webviewTag: false,
      spellcheck: false
    }
  })
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  worker.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== allowedOrigin) event.preventDefault() } catch { event.preventDefault() }
  })
  const observations: MatrixObservation[] = []
  try {
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index]!
      options.onProgress?.({ phase: options.role === 'source' ? 'source' : 'candidate', completed: index, total: jobs.length, current: job })
      await isolatedSession.clearStorageData()
      await isolatedSession.clearCache()
      observations.push(await collectCell(worker, options.origin, job))
    }
    options.onProgress?.({ phase: options.role === 'source' ? 'source' : 'candidate', completed: jobs.length, total: jobs.length, current: null })
  } finally {
    if (!worker.isDestroyed()) worker.destroy()
    await isolatedSession.clearStorageData().catch(() => undefined)
    await isolatedSession.clearCache().catch(() => undefined)
  }
  return {
    id: randomUUID(),
    projectId: options.projectId,
    role: options.role,
    createdAt: new Date().toISOString(),
    observations
  }
}
