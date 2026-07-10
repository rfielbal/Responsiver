export type RemoteAuditSeverity = 'info' | 'warning' | 'error'
export type RemoteAuditCategory = 'layout' | 'interaction' | 'media' | 'accessibility' | 'runtime'
export type RemoteAuditRule =
  | 'responsive.missing-viewport'
  | 'layout.viewport-overflow'
  | 'layout.clipped-content'
  | 'layout.truncated-text'
  | 'typography.mobile-readability'
  | 'interaction.small-target'
  | 'layout.fixed-obstruction'
  | 'media.image-error'
  | 'media.image-distortion'
  | 'accessibility.low-contrast'
  | 'runtime.page-error'

export interface RemoteAuditViewport {
  width: number
  height: number
  deviceScaleFactor: number
}

export interface RemoteAuditRoute {
  url: string
  pathname: string
  /** pathname, query et hash de la route auditée. */
  path: string
}

export interface RemoteAuditRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RemoteAuditEvidence {
  kind: 'geometry' | 'style' | 'resource' | 'runtime'
  summary: string
  observed?: string | number | boolean
  expected?: string | number | boolean
}

export interface RemoteAuditFinding {
  id: string
  rule: RemoteAuditRule
  category: RemoteAuditCategory
  severity: RemoteAuditSeverity
  title: string
  description: string
  route: RemoteAuditRoute
  viewport: RemoteAuditViewport
  selector: string
  rect: RemoteAuditRect
  style: Readonly<Record<string, string>>
  evidence: readonly RemoteAuditEvidence[]
  confidence: number
}

export interface RemoteAuditResult {
  version: 1
  route: RemoteAuditRoute
  viewport: RemoteAuditViewport
  scannedNodes: number
  truncated: boolean
  maxNodes: number
  maxFindings: number
  findings: readonly RemoteAuditFinding[]
}

export interface RemoteAuditScriptOptions {
  maxNodes?: number
  maxFindings?: number
  maxRuntimeErrors?: number
  minimumTargetSize?: number
  minimumContrast?: number
  minimumLargeTextContrast?: number
  mobile?: boolean
  expectedViewportWidth?: number
}

export interface SanitizeRemoteAuditContext {
  /** URL approuvée par url-policy.ts, jamais une valeur fournie par la page. */
  url: string
  viewport: { width: number; height: number; deviceScaleFactor?: number }
  maxFindings?: number
  maxScannedNodes?: number
}

const ruleMetadata: Readonly<Record<RemoteAuditRule, { category: RemoteAuditCategory; severity: RemoteAuditSeverity }>> = {
  'responsive.missing-viewport': { category: 'layout', severity: 'error' },
  'layout.viewport-overflow': { category: 'layout', severity: 'error' },
  'layout.clipped-content': { category: 'layout', severity: 'warning' },
  'layout.truncated-text': { category: 'layout', severity: 'warning' },
  'typography.mobile-readability': { category: 'accessibility', severity: 'warning' },
  'interaction.small-target': { category: 'interaction', severity: 'warning' },
  'layout.fixed-obstruction': { category: 'layout', severity: 'warning' },
  'media.image-error': { category: 'media', severity: 'error' },
  'media.image-distortion': { category: 'media', severity: 'warning' },
  'accessibility.low-contrast': { category: 'accessibility', severity: 'warning' },
  'runtime.page-error': { category: 'runtime', severity: 'error' }
}

const allowedStyleKeys = new Set([
  'position', 'display', 'overflow', 'overflowX', 'overflowY', 'whiteSpace', 'textOverflow',
  'lineClamp', 'width', 'height', 'minWidth', 'maxWidth', 'objectFit', 'color', 'backgroundColor',
  'fontSize', 'fontWeight', 'lineHeight', 'zIndex', 'pointerEvents'
])

const DEFAULT_MAX_FINDINGS = 180
const ABSOLUTE_MAX_FINDINGS = 320
const ABSOLUTE_MAX_NODES = 5_000
const MAX_SELECTOR_LENGTH = 320
const MAX_TEXT_LENGTH = 280
const MAX_STYLE_VALUE_LENGTH = 120
const MAX_EVIDENCE_PER_FINDING = 5

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback
}

function normalizeScriptOptions(options: RemoteAuditScriptOptions): Required<RemoteAuditScriptOptions> {
  return {
    maxNodes: clampInteger(options.maxNodes, 100, ABSOLUTE_MAX_NODES, 2_500),
    maxFindings: clampInteger(options.maxFindings, 10, ABSOLUTE_MAX_FINDINGS, DEFAULT_MAX_FINDINGS),
    maxRuntimeErrors: clampInteger(options.maxRuntimeErrors, 0, 50, 20),
    minimumTargetSize: clampInteger(options.minimumTargetSize, 24, 64, 44),
    minimumContrast: typeof options.minimumContrast === 'number'
      ? Math.min(7, Math.max(1, options.minimumContrast))
      : 4.5,
    minimumLargeTextContrast: typeof options.minimumLargeTextContrast === 'number'
      ? Math.min(7, Math.max(1, options.minimumLargeTextContrast))
      : 3,
    mobile: options.mobile === true,
    expectedViewportWidth: clampInteger(options.expectedViewportWidth, 240, 3_840, 393)
  }
}

/**
 * À enregistrer avec Page.addScriptToEvaluateOnNewDocument (CDP) avant la
 * navigation. Un appel executeJavaScript après le chargement reste possible,
 * mais ne pourra naturellement pas récupérer les erreurs déjà émises.
 */
export const REMOTE_AUDIT_BOOTSTRAP_SCRIPT = String.raw`(() => {
  const STORE = '__responsiverRuntimeErrorsV1';
  const INSTALLED = '__responsiverRuntimeCaptureInstalledV1';
  if (!Array.isArray(window[STORE])) {
    Object.defineProperty(window, STORE, { value: [], configurable: false, enumerable: false, writable: false });
  }
  if (window[INSTALLED]) return true;
  Object.defineProperty(window, INSTALLED, { value: true, configurable: false, enumerable: false, writable: false });
  const clean = (value) => {
    let text = '';
    try { text = typeof value === 'string' ? value : String(value && value.message ? value.message : value); } catch {}
    return text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 280);
  };
  const push = (kind, message, source, line, column) => {
    const store = window[STORE];
    if (!Array.isArray(store) || store.length >= 50) return;
    store.push({ kind, message: clean(message), source: clean(source), line: Number(line) || 0, column: Number(column) || 0 });
  };
  addEventListener('error', (event) => push('error', event.message || event.error, event.filename, event.lineno, event.colno), true);
  addEventListener('unhandledrejection', (event) => push('unhandledrejection', event.reason, '', 0, 0), true);
  const blocksLocalFileDrop = (event) => {
    try {
      if (Array.from(event.dataTransfer && event.dataTransfer.types || []).includes('Files')) event.preventDefault();
    } catch {}
  };
  addEventListener('dragover', blocksLocalFileDrop, true);
  addEventListener('drop', blocksLocalFileDrop, true);
  return true;
})()`

const REMOTE_AUDIT_COLLECTOR_TEMPLATE = String.raw`(() => {
  'use strict';
  const options = __RESPONSIVER_OPTIONS__;
  const viewport = {
    width: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1)),
    height: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1)),
    deviceScaleFactor: Math.max(0.1, Math.min(8, Number(window.devicePixelRatio) || 1))
  };
  const route = {
    url: String(location.href).slice(0, 4096),
    pathname: String(location.pathname).slice(0, 2048),
    path: String(location.pathname + location.search + location.hash).slice(0, 4096)
  };
  const findings = [];
  let truncated = false;
  let scannedNodes = 0;

  const clean = (value, max = 280) => {
    let text = '';
    try { text = String(value == null ? '' : value); } catch {}
    return text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  };
  const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const rectOf = (element) => {
    const rect = element && element.getBoundingClientRect ? element.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    return { x: round(rect.x), y: round(rect.y), width: Math.max(0, round(rect.width)), height: Math.max(0, round(rect.height)) };
  };
  const escapeCss = (value) => window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const selectorOf = (element) => {
    if (!element || element === document.documentElement) return ':root';
    if (element.id) return clean('#' + escapeCss(element.id), 320);
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement && parts.length < 4) {
      let part = current.localName || 'element';
      const classes = Array.from(current.classList || []).filter((name) => /^[a-zA-Z0-9_-]{1,60}$/.test(name)).slice(0, 2);
      if (classes.length) part += '.' + classes.map(escapeCss).join('.');
      if (!classes.length && current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter((item) => item.localName === current.localName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return clean(parts.join(' > ') || ':root', 320);
  };
  const styleSnapshot = (style, keys) => {
    const output = {};
    for (const key of keys) {
      const value = clean(style[key], 120);
      if (value) output[key] = value;
    }
    return output;
  };
  const hash = (text) => {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(16).padStart(8, '0');
  };
  const add = (rule, element, title, description, style, evidence, confidence, severity, category) => {
    if (findings.length >= options.maxFindings) { truncated = true; return; }
    const selector = selectorOf(element);
    findings.push({
      id: 'remote-' + hash(rule + '\u001f' + route.url + '\u001f' + selector),
      rule, category, severity, title: clean(title), description: clean(description), route, viewport,
      selector, rect: rectOf(element), style,
      evidence: (Array.isArray(evidence) ? evidence : []).slice(0, 5).map((item) => ({
        kind: clean(item.kind, 20), summary: clean(item.summary),
        ...(item.observed !== undefined ? { observed: typeof item.observed === 'number' || typeof item.observed === 'boolean' ? item.observed : clean(item.observed) } : {}),
        ...(item.expected !== undefined ? { expected: typeof item.expected === 'number' || typeof item.expected === 'boolean' ? item.expected : clean(item.expected) } : {})
      })),
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0))
    });
  };
  const visible = (element, style, rect) => rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  const parseRgb = (value) => {
    const match = String(value).match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?))?\s*\)$/i);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isFinite(alpha) || alpha < 0.98) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const backgroundOf = (element) => {
    let current = element;
    while (current && current.nodeType === 1) {
      const parsed = parseRgb(getComputedStyle(current).backgroundColor);
      if (parsed) return parsed;
      current = current.parentElement;
    }
    return parseRgb(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255];
  };
  const luminance = (rgb) => {
    const channels = rgb.map((value) => {
      const normalized = Math.max(0, Math.min(255, value)) / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (left, right) => {
    const a = luminance(left); const b = luminance(right);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const hasOwnText = (element) => Array.from(element.childNodes || []).some((node) => node.nodeType === 3 && String(node.nodeValue || '').trim().length > 0);
  const targetSelector = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
  const fixedCandidates = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);

  if (options.mobile) {
    const viewportMeta = document.querySelector('meta[name="viewport" i]');
    const viewportContent = clean(viewportMeta && viewportMeta.getAttribute('content'), 280).toLowerCase();
    const declaresDeviceWidth = /(?:^|[,;\s])width\s*=\s*device-width(?:\s|[,;]|$)/i.test(viewportContent);
    if (!viewportMeta || !declaresDeviceWidth) {
      add('responsive.missing-viewport', document.documentElement, 'Viewport mobile non déclaré',
        viewportMeta ? 'La balise viewport ne déclare pas width=device-width.' : 'La page ne possède aucune balise meta viewport.',
        {}, [
          { kind: 'style', summary: 'Déclaration viewport', observed: viewportMeta ? viewportContent || 'contenu vide' : 'absente', expected: 'width=device-width' },
          { kind: 'geometry', summary: 'Largeur de mise en page observée', observed: viewport.width, expected: options.expectedViewportWidth }
        ], viewportMeta ? 0.93 : 0.99, 'error', 'layout');
    }
  }

  let element = walker.currentNode;
  for (; element && scannedNodes < options.maxNodes; element = walker.nextNode()) {
    if (findings.length >= options.maxFindings) { truncated = true; break; }
    scannedNodes += 1;
    const style = getComputedStyle(element);
    const domRect = element.getBoundingClientRect();
    if (!visible(element, style, domRect)) continue;

    const beyondViewport = domRect.right > viewport.width + 1 || domRect.left < -1;
    const scrollOverflow = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
    if (beyondViewport && style.position !== 'fixed' && style.position !== 'sticky') {
      add('layout.viewport-overflow', element, 'Élément hors du viewport', 'Le rendu dépasse horizontalement la largeur testée.',
        styleSnapshot(style, ['display', 'position', 'width', 'minWidth', 'maxWidth', 'overflowX']),
        [{ kind: 'geometry', summary: 'Bord horizontal en dehors du viewport', observed: round(Math.max(domRect.right - viewport.width, -domRect.left)), expected: 0 }],
        0.94, 'error', 'layout');
    } else if (scrollOverflow && style.overflowX === 'visible' && element !== document.documentElement && element !== document.body) {
      add('layout.viewport-overflow', element, 'Contenu horizontal débordant', 'Le contenu est plus large que son conteneur sans mécanisme de défilement.',
        styleSnapshot(style, ['display', 'width', 'minWidth', 'maxWidth', 'overflowX']),
        [{ kind: 'geometry', summary: 'Largeur de défilement supérieure au conteneur', observed: element.scrollWidth, expected: element.clientWidth }],
        0.82, 'warning', 'layout');
    }

    const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
    const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
    const clipped = (clipsX && element.scrollWidth > element.clientWidth + 1) || (clipsY && element.scrollHeight > element.clientHeight + 1);
    if (clipped) {
      const text = String(element.textContent || '').trim();
      const truncationStyle = style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap' || style.webkitLineClamp !== 'none';
      if (text && truncationStyle) {
        add('layout.truncated-text', element, 'Texte potentiellement tronqué', 'Le contenu textuel dépasse une zone qui le masque.',
          styleSnapshot(style, ['overflowX', 'overflowY', 'whiteSpace', 'textOverflow', 'lineClamp', 'width', 'height']),
          [{ kind: 'geometry', summary: 'Contenu supérieur à la boîte visible', observed: Math.max(element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight), expected: 0 }],
          style.textOverflow === 'ellipsis' ? 0.9 : 0.78, 'warning', 'layout');
      } else {
        add('layout.clipped-content', element, 'Contenu masqué par son conteneur', 'Une règle overflow masque une partie mesurable du contenu.',
          styleSnapshot(style, ['overflowX', 'overflowY', 'width', 'height', 'maxWidth']),
          [{ kind: 'geometry', summary: 'Différence entre taille complète et taille visible', observed: Math.max(element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight), expected: 0 }],
          0.75, 'warning', 'layout');
      }
    }

    if (element.matches(targetSelector) && !element.hasAttribute('disabled') && style.pointerEvents !== 'none') {
      if (domRect.width < options.minimumTargetSize || domRect.height < options.minimumTargetSize) {
        add('interaction.small-target', element, 'Cible tactile trop petite', 'La zone interactive risque d’être difficile à activer sur écran tactile.',
          styleSnapshot(style, ['display', 'width', 'height', 'pointerEvents']),
          [{ kind: 'geometry', summary: 'Dimensions de la cible', observed: round(domRect.width) + ' × ' + round(domRect.height) + ' px', expected: options.minimumTargetSize + ' × ' + options.minimumTargetSize + ' px' }],
          0.8, 'warning', 'interaction');
      }
    }

    if (style.position === 'fixed' || style.position === 'sticky') fixedCandidates.push({ element, style, rect: domRect });

    if (element.localName === 'img') {
      const image = element;
      if (image.complete && image.naturalWidth === 0) {
        add('media.image-error', element, 'Image impossible à charger', 'La ressource image est terminée mais ne possède aucune dimension naturelle.',
          styleSnapshot(style, ['display', 'width', 'height', 'objectFit']),
          [{ kind: 'resource', summary: 'Dimensions naturelles absentes', observed: 0, expected: 'supérieur à 0' }],
          0.99, 'error', 'media');
      } else if (image.complete && image.naturalWidth > 0 && domRect.width > 1 && domRect.height > 1 && (style.objectFit === 'fill' || style.objectFit === 'none')) {
        const naturalRatio = image.naturalWidth / image.naturalHeight;
        const renderedRatio = domRect.width / domRect.height;
        const delta = Math.abs(renderedRatio / naturalRatio - 1);
        if (delta > 0.08) {
          add('media.image-distortion', element, 'Proportions d’image déformées', 'Le ratio affiché diffère sensiblement du ratio de la ressource.',
            styleSnapshot(style, ['width', 'height', 'objectFit']),
            [{ kind: 'geometry', summary: 'Écart de ratio', observed: round(delta * 100) + ' %', expected: 'inférieur à 8 %' }],
            0.91, 'warning', 'media');
        }
      }
    }

    if (hasOwnText(element)) {
      const ownTextLength = Array.from(element.childNodes || [])
        .filter((node) => node.nodeType === 3)
        .reduce((total, node) => total + String(node.nodeValue || '').trim().length, 0);
      if (options.mobile && ownTextLength >= 8 && !element.closest('[aria-hidden="true"]')) {
        const fontSize = Number.parseFloat(style.fontSize) || 16;
        const lineHeight = style.lineHeight === 'normal' ? null : Number.parseFloat(style.lineHeight);
        const bodyTextElement = element.matches('p,li,dd,dt,blockquote,label,figcaption,small');
        const undersized = fontSize < 12 && (bodyTextElement || ownTextLength >= 24);
        const denseParagraph = bodyTextElement && ownTextLength >= 80 && lineHeight !== null && Number.isFinite(lineHeight) && lineHeight / fontSize < 1.15;
        if (undersized || denseParagraph) {
          const evidence = [];
          if (undersized) evidence.push({ kind: 'style', summary: 'Taille du texte', observed: round(fontSize) + ' px', expected: 'au moins 12 px pour ce contenu' });
          if (denseParagraph) evidence.push({ kind: 'style', summary: 'Rapport hauteur de ligne / corps', observed: round(lineHeight / fontSize), expected: 'au moins 1,15 pour un texte long' });
          add('typography.mobile-readability', element, 'Texte difficile à lire sur mobile',
            undersized ? 'Un contenu textuel significatif utilise un corps inférieur à 12 CSS px.' : 'Un texte long possède un interlignage particulièrement serré.',
            styleSnapshot(style, ['fontSize', 'fontWeight', 'lineHeight', 'width', 'color']), evidence,
            undersized ? 0.78 : 0.7, 'warning', 'accessibility');
        }
      }
      const foreground = parseRgb(style.color);
      const background = backgroundOf(element);
      if (foreground && background) {
        const ratio = contrast(foreground, background);
        const fontSize = Number.parseFloat(style.fontSize) || 16;
        const weight = Number.parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
        const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
        const minimum = large ? options.minimumLargeTextContrast : options.minimumContrast;
        if (ratio < minimum) {
          add('accessibility.low-contrast', element, 'Contraste de texte insuffisant', 'Le contraste calculé est inférieur au seuil WCAG configuré.',
            styleSnapshot(style, ['color', 'backgroundColor', 'fontSize', 'fontWeight']),
            [{ kind: 'style', summary: 'Ratio de contraste', observed: round(ratio), expected: minimum }],
            0.86, 'warning', 'accessibility');
        }
      }
    }
  }
  if (element) truncated = true;

  for (const candidate of fixedCandidates) {
    if (findings.length >= options.maxFindings) { truncated = true; break; }
    const { element, style, rect } = candidate;
    const areaRatio = (rect.width * rect.height) / Math.max(1, viewport.width * viewport.height);
    const horizontalBand = rect.width >= viewport.width * 0.8 && rect.height >= viewport.height * 0.12;
    const coversCenter = rect.left <= viewport.width / 2 && rect.right >= viewport.width / 2 && rect.top <= viewport.height / 2 && rect.bottom >= viewport.height / 2;
    const stacking = style.zIndex !== 'auto' && Number(style.zIndex) >= 1;
    if ((horizontalBand || areaRatio >= 0.22 || coversCenter) && stacking && style.pointerEvents !== 'none') {
      add('layout.fixed-obstruction', element, 'Élément fixe potentiellement obstructif', 'Un élément fixé occupe une part importante du viewport et peut masquer le contenu.',
        styleSnapshot(style, ['position', 'zIndex', 'width', 'height', 'pointerEvents']),
        [{ kind: 'geometry', summary: 'Part du viewport couverte', observed: round(areaRatio * 100) + ' %', expected: 'inférieure à 12 % ou non obstructive' }],
        horizontalBand || coversCenter ? 0.8 : 0.7, 'warning', 'layout');
    }
  }

  const runtimeErrors = Array.isArray(window.__responsiverRuntimeErrorsV1) ? window.__responsiverRuntimeErrorsV1.slice(0, options.maxRuntimeErrors) : [];
  for (const runtimeError of runtimeErrors) {
    add('runtime.page-error', document.documentElement, 'Erreur d’exécution dans la page', 'La page a émis une erreur JavaScript pendant cette session.',
      {}, [{ kind: 'runtime', summary: clean(runtimeError.message || runtimeError.kind), observed: clean(runtimeError.source || '') }],
      0.98, 'error', 'runtime');
  }

  return { version: 1, route, viewport, scannedNodes, truncated, maxNodes: options.maxNodes, maxFindings: options.maxFindings, findings };
})()`

/** Script autonome à exécuter dans le monde de la page après stabilisation du rendu. */
export function buildRemoteAuditScript(options: RemoteAuditScriptOptions = {}): string {
  return REMOTE_AUDIT_COLLECTOR_TEMPLATE.replace('__RESPONSIVER_OPTIONS__', JSON.stringify(normalizeScriptOptions(options)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown, maximum = MAX_TEXT_LENGTH): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maximum)
    : ''
}

function finiteNumber(value: unknown, minimum: number, maximum: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

function stableFindingId(rule: string, url: string, selector: string): string {
  let hash = 2_166_136_261
  const value = `${rule}\u001f${url}\u001f${selector}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `remote-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function sanitizeRect(value: unknown): RemoteAuditRect {
  const record = isRecord(value) ? value : {}
  return {
    x: finiteNumber(record.x, -1_000_000, 1_000_000),
    y: finiteNumber(record.y, -1_000_000, 1_000_000),
    width: finiteNumber(record.width, 0, 1_000_000),
    height: finiteNumber(record.height, 0, 1_000_000)
  }
}

function sanitizeStyle(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {}
  const output: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedStyleKeys.has(key) || typeof entry !== 'string') continue
    output[key] = cleanString(entry, MAX_STYLE_VALUE_LENGTH)
  }
  return output
}

function sanitizePrimitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return finiteNumber(value, -1_000_000_000, 1_000_000_000)
  if (typeof value === 'string') return cleanString(value)
  return undefined
}

function sanitizeEvidence(value: unknown): RemoteAuditEvidence[] {
  if (!Array.isArray(value)) return []
  const output: RemoteAuditEvidence[] = []
  for (const entry of value.slice(0, MAX_EVIDENCE_PER_FINDING)) {
    if (!isRecord(entry)) continue
    const kind = cleanString(entry.kind, 20)
    if (kind !== 'geometry' && kind !== 'style' && kind !== 'resource' && kind !== 'runtime') continue
    const summary = cleanString(entry.summary)
    if (!summary) continue
    const observed = sanitizePrimitive(entry.observed)
    const expected = sanitizePrimitive(entry.expected)
    output.push({
      kind,
      summary,
      ...(observed !== undefined ? { observed } : {}),
      ...(expected !== undefined ? { expected } : {})
    })
  }
  return output
}

/**
 * Traite le résultat JavaScript comme une entrée non fiable. La route et le
 * viewport sont remplacés par le contexte approuvé du processus principal.
 */
export function sanitizeRemoteAuditResult(raw: unknown, context: SanitizeRemoteAuditContext): RemoteAuditResult {
  const source = isRecord(raw) ? raw : {}
  const width = clampInteger(context.viewport.width, 1, 16_384, 1)
  const height = clampInteger(context.viewport.height, 1, 16_384, 1)
  const deviceScaleFactor = typeof context.viewport.deviceScaleFactor === 'number'
    ? finiteNumber(context.viewport.deviceScaleFactor, 0.1, 8, 1)
    : 1
  const trustedUrl = new URL(context.url)
  const route: RemoteAuditRoute = {
    url: trustedUrl.href.slice(0, 4_096),
    pathname: trustedUrl.pathname.slice(0, 2_048),
    path: `${trustedUrl.pathname}${trustedUrl.search}${trustedUrl.hash}`.slice(0, 4_096)
  }
  const viewport: RemoteAuditViewport = { width, height, deviceScaleFactor }
  const maximum = clampInteger(context.maxFindings, 1, ABSOLUTE_MAX_FINDINGS, DEFAULT_MAX_FINDINGS)
  const rawFindings = Array.isArray(source.findings) ? source.findings : []
  const findings: RemoteAuditFinding[] = []

  for (const entry of rawFindings.slice(0, maximum)) {
    if (!isRecord(entry) || typeof entry.rule !== 'string' || !(entry.rule in ruleMetadata)) continue
    const rule = entry.rule as RemoteAuditRule
    const selector = cleanString(entry.selector, MAX_SELECTOR_LENGTH) || ':root'
    const metadata = ruleMetadata[rule]
    findings.push({
      id: stableFindingId(rule, route.url, selector),
      rule,
      category: metadata.category,
      severity: metadata.severity,
      title: cleanString(entry.title) || rule,
      description: cleanString(entry.description),
      route,
      viewport,
      selector,
      rect: sanitizeRect(entry.rect),
      style: sanitizeStyle(entry.style),
      evidence: sanitizeEvidence(entry.evidence),
      confidence: finiteNumber(entry.confidence, 0, 1)
    })
  }

  const maxScannedNodes = clampInteger(context.maxScannedNodes, 100, ABSOLUTE_MAX_NODES, ABSOLUTE_MAX_NODES)
  return {
    version: 1,
    route,
    viewport,
    scannedNodes: clampInteger(source.scannedNodes, 0, maxScannedNodes, 0),
    truncated: source.truncated === true || rawFindings.length > maximum,
    maxNodes: maxScannedNodes,
    maxFindings: maximum,
    findings
  }
}
