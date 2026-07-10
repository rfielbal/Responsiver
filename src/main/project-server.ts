import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, normalize, posix, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'

export interface ProjectServerOptions {
  mode?: 'source' | 'proposal' | 'staged'
  overrides?: ReadonlyMap<string, Buffer | string>
  injectedCss?: string
  previewBasePath?: string
}

export interface ProjectServer {
  origin: string
  mode: 'source' | 'proposal' | 'staged'
  close: () => Promise<void>
}

interface ResolvedResource {
  absolutePath: string | null
  body: Buffer | null
  relativePath: string
}

const mimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.aac': 'audio/aac',
  '.apng': 'image/apng',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.manifest': 'application/manifest+json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.stl': 'model/stl',
  '.svg': 'image/svg+xml',
  '.text': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.vtt': 'text/vtt; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
}

const previewCsp = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ')

/** Bornes du collecteur injecté dans les previews locales. */
export const LOCAL_RUNTIME_AUDIT_LIMITS = Object.freeze({
  maxNodes: 2_500,
  maxFindings: 120,
  maxFindingsPerRule: 24,
  maxLegacyOverflows: 12,
  maxContrastChecks: 600
})

const bridge = `<style data-responsiver-bridge-style>
[data-responsiver-reveal-target] {
  outline: 3px solid #b94d32 !important;
  outline-offset: 4px !important;
  scroll-margin: 72px !important;
}
</style><script data-responsiver-bridge>
(() => {
  const channel = 'responsiver-preview';
  const revealAttribute = 'data-responsiver-reveal-target';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUDIT_MAX_NODES = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxNodes};
  const AUDIT_MAX_FINDINGS = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxFindings};
  const AUDIT_MAX_FINDINGS_PER_RULE = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxFindingsPerRule};
  const AUDIT_MAX_LEGACY_OVERFLOWS = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxLegacyOverflows};
  const AUDIT_MAX_CONTRAST_CHECKS = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxContrastChecks};
  const AUDIT_MOBILE_MAX_WIDTH = 768;
  const AUDIT_MIN_TARGET_SIZE = 44;
  let originalThemeState = null;
  let mutationObserver = null;
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = nativeAttachShadow.call(this, init);
    queueMicrotask(() => {
      mutationObserver?.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'content', 'data-theme', 'data-color-scheme'], childList: true, subtree: true });
      schedule();
    });
    return root;
  };
  const message = (type, payload = {}) => parent.postMessage({ channel, type, ...payload }, '*');
  const runtimeErrors = [];
  const recordRuntimeError = (type, value, url = '', line = 0) => {
    if (runtimeErrors.length >= 12) return;
    const detail = String(value || 'Erreur inconnue').replace(/\s+/g, ' ').trim().slice(0, 240);
    runtimeErrors.push({ type, detail, url: String(url || '').slice(0, 500), line: Number(line) || 0 });
    queueMicrotask(() => schedule());
  };
  addEventListener('error', (event) => {
    const target = event.target;
    if (target instanceof Element && target !== window) {
      const url = target.getAttribute('src') || target.getAttribute('href') || target.currentSrc || '';
      recordRuntimeError('resource', target.tagName.toLowerCase() + ' indisponible', url);
      return;
    }
    recordRuntimeError('javascript', event.message, event.filename, event.lineno);
  }, true);
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : event.reason;
    recordRuntimeError('promise', reason);
  });
  const transparent = (value) => !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
  const luminance = (value) => {
    const match = value.match(/[\\d.]+/g);
    if (!match || match.length < 3) return null;
    const components = match.slice(0, 3).map((part) => Number(part) / 255).map((part) => part <= .03928 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4);
    return .2126 * components[0] + .7152 * components[1] + .0722 * components[2];
  };
  const themeState = () => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const bodyBackground = bodyStyle?.backgroundColor ?? '';
    const background = transparent(bodyBackground) ? rootStyle.backgroundColor : bodyBackground;
    const declaredScheme = rootStyle.colorScheme || document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') || '';
    const surfaceLuminance = luminance(background);
    const declaresDark = /dark/i.test(declaredScheme);
    const declaresLight = /light/i.test(declaredScheme);
    const detected = surfaceLuminance !== null
      ? surfaceLuminance < .42 ? 'dark' : surfaceLuminance > .58 ? 'light' : 'unknown'
      : declaresDark && !declaresLight ? 'dark' : declaresLight && !declaresDark ? 'light' : 'unknown';
    return { background, color: bodyStyle?.color ?? rootStyle.color, declaredScheme, detected };
  };
  const state = () => {
    const theme = themeState();
    message('state', {
      path: location.pathname + location.search + location.hash,
      title: document.title,
      ...theme,
      theme
    });
  };
  const selectorFor = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      const classes = [...current.classList].slice(0, 2);
      if (classes.length) part += '.' + classes.map((name) => CSS.escape(name)).join('.');
      if (current.parentElement) {
        const siblings = [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ') || element.tagName.toLowerCase();
  };
  const composedElements = (root, limit) => {
    if (!root || limit <= 0) return [];
    const result = [];
    const scopes = [root];
    const visitedRoots = new Set();
    while (scopes.length && result.length < limit) {
      const scope = scopes.shift();
      if (!scope || visitedRoots.has(scope)) continue;
      visitedRoots.add(scope);
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
      let element = scope instanceof Element ? scope : walker.nextNode();
      while (element && result.length < limit) {
        result.push(element);
        if (element.shadowRoot && !visitedRoots.has(element.shadowRoot)) scopes.push(element.shadowRoot);
        element = walker.nextNode();
      }
    }
    return result;
  };
  const pseudoPainted = (element) => {
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(element, pseudo);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const content = style.content;
      const hasContent = Boolean(content && content !== 'none' && content !== 'normal' && content !== '""' && content !== "''");
      const hasSurface = !transparent(style.backgroundColor) || style.backgroundImage !== 'none' || parseFloat(style.borderTopWidth) > 0;
      if (hasContent || hasSurface) return true;
    }
    return false;
  };
  const audit = () => {
    const viewportWidth = document.documentElement.clientWidth || innerWidth;
    const viewportHeight = document.documentElement.clientHeight || innerHeight;
    const viewport = { width: viewportWidth, height: viewportHeight, mobile: viewportWidth <= AUDIT_MOBILE_MAX_WIDTH };
    const route = location.pathname + location.search + location.hash;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const sampledNodes = composedElements(document.body, AUDIT_MAX_NODES + 1);
    const nodes = sampledNodes.slice(0, AUDIT_MAX_NODES);
    const findings = [];
    const overflows = [];
    const findingsPerRule = new Map();
    const seenFindings = new Set();
    const seenOverflowElements = new Set();
    const seenLegacyOverflows = new Set();
    const fixedCandidates = [];
    let overflowCount = 0;
    let contrastChecks = 0;
    let truncated = sampledNodes.length > AUDIT_MAX_NODES;
    const clean = (value, limit = 240) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
    const rectangleOf = (rect) => ({ x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) });
    const labelOf = (element) => clean(element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || element.textContent, 80);
    const hash = (value) => {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0).toString(16).padStart(8, '0');
    };
    const addFinding = (rule, element, rect, severity, title, description, proposal, confidence) => {
      const selector = clean(selectorFor(element), 320);
      const key = rule + '|' + selector;
      if (seenFindings.has(key)) return false;
      const ruleCount = findingsPerRule.get(rule) || 0;
      if (findings.length >= AUDIT_MAX_FINDINGS || ruleCount >= AUDIT_MAX_FINDINGS_PER_RULE) {
        truncated = true;
        return false;
      }
      seenFindings.add(key);
      findingsPerRule.set(rule, ruleCount + 1);
      findings.push({
        id: 'runtime-' + hash(rule + '|' + route + '|' + selector),
        rule,
        severity,
        title: clean(title),
        description: clean(description, 420),
        proposal: clean(proposal, 420),
        confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
        selector,
        tag: element.tagName.toLowerCase(),
        label: labelOf(element),
        rect: rectangleOf(rect),
        route,
        viewport
      });
      return true;
    };
    const recordOverflow = (element, rect) => {
      if (seenOverflowElements.has(element)) return;
      seenOverflowElements.add(element);
      overflowCount += 1;
      const selector = clean(selectorFor(element), 320);
      if (overflows.length >= AUDIT_MAX_LEGACY_OVERFLOWS || seenLegacyOverflows.has(selector)) return;
      seenLegacyOverflows.add(selector);
      overflows.push({ selector, tag: element.tagName.toLowerCase(), label: labelOf(element), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) });
    };
    const visible = (style, rect) => rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    const hasOwnText = (element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && clean(node.nodeValue).length > 0);
    const parseOpaqueRgb = (value) => {
      const source = String(value || '');
      if (!source.toLowerCase().startsWith('rgb')) return null;
      const components = source.match(/[\\d.]+/g);
      if (!components || components.length < 3) return null;
      const alpha = components.length > 3 ? Number(components[3]) : 1;
      if (!Number.isFinite(alpha) || alpha < .98) return null;
      return components.slice(0, 3).map(Number);
    };
    const parentElementOf = (element) => {
      if (element.parentElement) return element.parentElement;
      const root = element.getRootNode();
      return root instanceof ShadowRoot ? root.host : null;
    };
    const backgroundOf = (element) => {
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.backgroundImage && style.backgroundImage !== 'none') return null;
        const color = parseOpaqueRgb(style.backgroundColor);
        if (color) return color;
        current = parentElementOf(current);
      }
      const rootStyle = getComputedStyle(document.documentElement);
      if (rootStyle.backgroundImage && rootStyle.backgroundImage !== 'none') return null;
      return parseOpaqueRgb(rootStyle.backgroundColor) || [255, 255, 255];
    };
    const relativeLuminance = (rgb) => {
      const values = rgb.map((value) => {
        const component = Math.max(0, Math.min(255, value)) / 255;
        return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
      });
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    const contrastRatio = (foreground, background) => {
      const foregroundLuminance = relativeLuminance(foreground);
      const backgroundLuminance = relativeLuminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + .05) / (Math.min(foregroundLuminance, backgroundLuminance) + .05);
    };
    const targetSelector = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';

    for (const element of nodes) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const displayed = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;

      if (element.localName === 'img' && displayed) {
        if (element.complete && element.naturalWidth === 0) {
          addFinding('media.image-error', element, rect, 'error', 'Image impossible à charger',
            'La ressource image a terminé son chargement sans fournir de dimensions naturelles.',
            'Vérifier le chemin, le fichier et le chargement de l’image, puis prévoir un contenu alternatif.', .99);
        } else if (element.complete && element.naturalWidth > 0 && element.naturalHeight > 0 && rect.width > 1 && rect.height > 1 && (style.objectFit === 'fill' || style.objectFit === 'none')) {
          const naturalRatio = element.naturalWidth / element.naturalHeight;
          const renderedRatio = rect.width / rect.height;
          const ratioDelta = Math.abs(renderedRatio / naturalRatio - 1);
          if (ratioDelta > .08) {
            addFinding('media.image-distortion', element, rect, 'warning', 'Proportions d’image déformées',
              'Le ratio affiché diffère de ' + Math.round(ratioDelta * 100) + ' % du ratio naturel de la ressource.',
              'Préserver le ratio de l’image avec une dimension automatique ou un object-fit adapté.', .91);
          }
        }
      }

      if (!visible(style, rect)) continue;

      const beyondViewport = rect.right > viewportWidth + 1 || rect.left < -1;
      const scrollOverflow = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
      if (beyondViewport && style.position !== 'fixed' && style.position !== 'sticky') {
        recordOverflow(element, rect);
        addFinding('layout.viewport-overflow', element, rect, 'error', 'Élément hors du viewport',
          'Le rendu dépasse horizontalement la largeur testée.',
          'Remplacer les dimensions rigides par des contraintes fluides et limiter la largeur au viewport.', .94);
      } else if (scrollOverflow && style.overflowX === 'visible' && element !== document.documentElement && element !== document.body) {
        recordOverflow(element, rect);
        addFinding('layout.viewport-overflow', element, rect, 'warning', 'Contenu horizontal débordant',
          'Le contenu est plus large que son conteneur sans mécanisme de défilement.',
          'Adapter les largeurs minimales, autoriser le retour à la ligne ou ajouter un défilement explicite.', .82);
      }

      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const clippedX = clipsX && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
      const clippedY = clipsY && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1;
      if (clippedX || clippedY) {
        const hasText = clean(element.textContent).length > 0;
        const lineClamp = style.webkitLineClamp;
        const truncationStyle = style.textOverflow === 'ellipsis' || clippedX && style.whiteSpace === 'nowrap' || Boolean(lineClamp && lineClamp !== 'none' && lineClamp !== '0');
        if (hasText && truncationStyle) {
          addFinding('layout.truncated-text', element, rect, 'warning', 'Texte potentiellement tronqué',
            'Le contenu textuel dépasse une zone qui le masque.',
            'Autoriser le retour à la ligne ou ajuster la limite de lignes et la taille du conteneur au breakpoint concerné.', style.textOverflow === 'ellipsis' ? .9 : .8);
        } else {
          addFinding('layout.clipped-content', element, rect, 'warning', 'Contenu rogné par son conteneur',
            'Une règle overflow masque une partie mesurable du contenu.',
            'Ajuster la taille du conteneur ou rendre le débordement accessible sans masquer l’information.', .78);
        }
      }

      if (viewport.mobile && element.matches(targetSelector) && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true' && style.pointerEvents !== 'none') {
        if (rect.width < AUDIT_MIN_TARGET_SIZE || rect.height < AUDIT_MIN_TARGET_SIZE) {
          addFinding('interaction.small-target', element, rect, 'warning', 'Cible tactile trop petite',
            'La zone interactive mesure ' + round(rect.width) + ' × ' + round(rect.height) + ' px sur ce viewport mobile.',
            'Porter la zone activable à au moins ' + AUDIT_MIN_TARGET_SIZE + ' × ' + AUDIT_MIN_TARGET_SIZE + ' CSS px, espacement compris.', .84);
        }
      }

      if ((style.position === 'fixed' || style.position === 'sticky') && style.pointerEvents !== 'none') fixedCandidates.push({ element, style, rect });

      if (hasOwnText(element)) {
        if (contrastChecks >= AUDIT_MAX_CONTRAST_CHECKS) {
          truncated = true;
        } else {
          contrastChecks += 1;
          const foreground = parseOpaqueRgb(style.color);
          const background = backgroundOf(element);
          if (foreground && background) {
            const ratio = contrastRatio(foreground, background);
            const fontSize = Number.parseFloat(style.fontSize) || 16;
            const fontWeight = Number.parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
            const largeText = fontSize >= 24 || fontSize >= 18.66 && fontWeight >= 700;
            const minimumRatio = largeText ? 3 : 4.5;
            if (ratio < minimumRatio) {
              addFinding('accessibility.low-contrast', element, rect, 'warning', 'Contraste de texte insuffisant',
                'Le contraste simple calculé est de ' + round(ratio) + ':1, sous le seuil de ' + minimumRatio + ':1.',
                'Choisir une couleur de texte ou de fond offrant un contraste suffisant dans ce thème.', .86);
            }
          }
        }
      }
    }

    if (documentWidth > viewportWidth + 1 && overflowCount === 0) {
      const rootRect = document.documentElement.getBoundingClientRect();
      recordOverflow(document.documentElement, rootRect);
      addFinding('layout.viewport-overflow', document.documentElement, rootRect, 'warning', 'Page plus large que le viewport',
        'La largeur du document dépasse le viewport sans qu’un élément unique puisse être isolé.',
        'Inspecter les largeurs minimales, marges et transformations des conteneurs de premier niveau.', .72);
    }

    for (const candidate of fixedCandidates) {
      const rect = candidate.rect;
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const areaRatio = visibleWidth * visibleHeight / Math.max(1, viewportWidth * viewportHeight);
      const horizontalBand = visibleWidth >= viewportWidth * .8 && visibleHeight >= viewportHeight * .12;
      const coversCenter = rect.left <= viewportWidth / 2 && rect.right >= viewportWidth / 2 && rect.top <= viewportHeight / 2 && rect.bottom >= viewportHeight / 2;
      if (areaRatio >= .22 || horizontalBand || coversCenter) {
        addFinding('layout.fixed-obstruction', candidate.element, rect, 'warning', 'Élément fixe potentiellement envahissant',
          'Cet élément fixe ou collant couvre environ ' + Math.round(areaRatio * 100) + ' % du viewport visible.',
          'Réduire son emprise, le rendre repliable ou réserver explicitement l’espace qu’il occupe.', coversCenter || horizontalBand ? .84 : .74);
      }
    }

    const audit = {
      version: 2,
      path: route,
      route,
      viewportWidth,
      viewportHeight,
      viewport,
      documentWidth,
      overflowCount,
      overflows,
      findingCount: findings.length,
      findings,
      inspectedNodes: nodes.length,
      truncated,
      limits: {
        maxNodes: AUDIT_MAX_NODES,
        maxFindings: AUDIT_MAX_FINDINGS,
        maxFindingsPerRule: AUDIT_MAX_FINDINGS_PER_RULE,
        maxLegacyOverflows: AUDIT_MAX_LEGACY_OVERFLOWS,
        maxContrastChecks: AUDIT_MAX_CONTRAST_CHECKS
      }
    };
    message('audit', { ...audit, audit });
  };
  const renderStatus = (stable) => {
    const body = document.body;
    let visible = false;
    let paintedElements = 0;
    let inspected = 0;
    for (const node of body?.childNodes || []) {
      if (node.nodeType !== 3 || !(node.textContent || '').replace(/\s+/g, ' ').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rectangle = range.getBoundingClientRect();
      range.detach();
      if (rectangle.width > 1 && rectangle.height > 1) {
        visible = true;
        paintedElements += 1;
        break;
      }
    }
    for (const element of composedElements(body, 2000)) {
      inspected += 1;
      if (inspected > 2000) break;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rectangle = element.getBoundingClientRect();
      if (rectangle.width <= 1 || rectangle.height <= 1) continue;
      if (pseudoPainted(element)) {
        paintedElements += 1;
        visible = true;
        if (paintedElements >= 12) break;
      }
      // Le fond du body seul n’est pas une interface, et son textContent peut
      // contenir le code d’un script. Ses pseudo-éléments, eux, sont bien peints.
      if (element === body) continue;
      const tag = element.tagName.toLowerCase();
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      const visualMedia = /^(?:audio|button|canvas|embed|hr|iframe|img|input|object|picture|select|svg|textarea|video)$/.test(tag);
      const paintedSurface = !transparent(style.backgroundColor) || style.backgroundImage !== 'none' || parseFloat(style.borderTopWidth) > 0;
      if (text || visualMedia || paintedSurface) {
        paintedElements += 1;
        visible = true;
        if (paintedElements >= 12) break;
      }
    }
    const status = {
      path: location.pathname + location.search + location.hash,
      state: visible ? 'visible' : 'empty',
      visible,
      stable,
      paintedElements,
      inspectedElements: inspected,
      errorCount: runtimeErrors.length,
      errors: runtimeErrors.slice()
    };
    message('render-status', { ...status, renderStatus: status });
  };
  let timer;
  let stableRenderTimer;
  const schedule = () => {
    clearTimeout(timer);
    clearTimeout(stableRenderTimer);
    timer = setTimeout(() => { state(); audit(); renderStatus(false); }, 120);
    stableRenderTimer = setTimeout(() => renderStatus(true), 1200);
  };
  const go = (value) => {
    try {
      const destination = new URL(value, location.href);
      if (destination.origin === location.origin) location.assign(destination.pathname + destination.search + destination.hash);
      else message('external-link', { url: destination.href });
    } catch { message('navigation-error', { value: String(value) }); }
  };
  const clearReveal = () => {
    for (const element of composedElements(document.documentElement, AUDIT_MAX_NODES)) {
      if (element.hasAttribute(revealAttribute)) element.removeAttribute(revealAttribute);
    }
  };
  const rememberThemeState = () => {
    if (originalThemeState) return;
    const root = document.documentElement;
    const body = document.body;
    originalThemeState = {
      attributes: ['data-theme', 'data-color-scheme', 'data-color-mode', 'theme'].map((name) => [name, root.getAttribute(name)]),
      rootDark: root.classList.contains('dark'),
      rootLight: root.classList.contains('light'),
      bodyDark: body?.classList.contains('dark') || false,
      bodyLight: body?.classList.contains('light') || false,
      colorScheme: root.style.colorScheme
    };
  };
  const mediaRulesForTheme = (value) => {
    const rules = [];
    const pattern = new RegExp('prefers-color-scheme\\s*:\\s*' + value, 'i');
    for (const sheet of document.styleSheets) {
      let sheetRules;
      try { sheetRules = sheet.cssRules; } catch { continue; }
      for (const rule of sheetRules) {
        if (rule.type !== CSSRule.MEDIA_RULE || !pattern.test(rule.conditionText || '')) continue;
        for (const nestedRule of rule.cssRules || []) rules.push(nestedRule.cssText);
      }
    }
    return rules.join('\\n');
  };
  const applyThemePreview = (value) => {
    if (value !== 'dark' && value !== 'light') return;
    rememberThemeState();
    const root = document.documentElement;
    const body = document.body;
    for (const attribute of ['data-theme', 'data-color-scheme', 'data-color-mode', 'theme']) root.setAttribute(attribute, value);
    root.classList.toggle('dark', value === 'dark');
    root.classList.toggle('light', value === 'light');
    body?.classList.toggle('dark', value === 'dark');
    body?.classList.toggle('light', value === 'light');
    root.style.colorScheme = value;
    const mediaCss = mediaRulesForTheme(value);
    let mediaStyle = document.querySelector('style[data-responsiver-native-theme]');
    if (mediaCss && !mediaStyle) {
      mediaStyle = document.createElement('style');
      mediaStyle.setAttribute('data-responsiver-native-theme', '');
      document.head.append(mediaStyle);
    }
    if (mediaStyle) mediaStyle.textContent = mediaCss;
    requestAnimationFrame(schedule);
  };
  const clearThemePreview = () => {
    if (!originalThemeState) return;
    const root = document.documentElement;
    const body = document.body;
    for (const [name, value] of originalThemeState.attributes) {
      if (value === null) root.removeAttribute(name); else root.setAttribute(name, value);
    }
    root.classList.toggle('dark', originalThemeState.rootDark);
    root.classList.toggle('light', originalThemeState.rootLight);
    body?.classList.toggle('dark', originalThemeState.bodyDark);
    body?.classList.toggle('light', originalThemeState.bodyLight);
    root.style.colorScheme = originalThemeState.colorScheme;
    document.querySelector('style[data-responsiver-native-theme]')?.remove();
    originalThemeState = null;
    requestAnimationFrame(schedule);
  };
  const normalizeRevealSelector = (value) => {
    const statePseudo = '(?:hover|active|focus(?:-visible|-within)?|visited|link|target|checked|disabled|enabled|required|optional|valid|invalid|user-valid|user-invalid|placeholder-shown|autofill|playing|paused|fullscreen|modal|popover-open)';
    return value
      .replace(new RegExp(':not\\\\(\\\\s*:' + statePseudo + '\\\\s*\\\\)', 'gi'), '')
      .replace(/::[a-z-]+(?:\\([^)]*\\))?/gi, '')
      .replace(new RegExp(':' + statePseudo + '\\\\b(?:\\\\([^)]*\\\\))?', 'gi'), '')
      .replace(/:(?:not|is|where|has)\\(\\s*\\)/gi, '')
      .replace(/(^|[>+~,])\\s*&\\s*/g, '$1 ')
      .trim();
  };
  const reveal = (value) => {
    clearReveal();
    if (typeof value !== 'string' || !value.trim()) {
      scrollTo({ top: 0, left: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      const result = { requestedSelector: null, resolvedSelector: null, found: true, target: 'document', path: location.pathname + location.search + location.hash };
      message('reveal-result', result);
      message('focus-result', result);
      return;
    }
    const requestedSelector = value.trim().slice(0, 2048);
    const withoutPseudoElement = requestedSelector.replace(/::[a-z-]+(?:\\([^)]*\\))?/gi, '').trim();
    const normalizedSelector = normalizeRevealSelector(requestedSelector);
    const candidates = [...new Set([requestedSelector, withoutPseudoElement, normalizedSelector].filter(Boolean))];
    const composed = composedElements(document.documentElement, AUDIT_MAX_NODES);
    let target = null;
    let resolvedSelector = null;
    for (const candidate of candidates) {
      try {
        const matches = [...document.querySelectorAll(candidate)];
        const knownMatches = new Set(matches);
        for (const element of composed) {
          if (!knownMatches.has(element) && element.matches(candidate)) matches.push(element);
        }
        target = matches.find((element) => {
          const rectangle = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rectangle.width > 0 && rectangle.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        }) || matches[0] || null;
        if (target) {
          resolvedSelector = candidate;
          break;
        }
      } catch {}
    }
    if (!target) {
      const result = { requestedSelector, resolvedSelector: normalizedSelector || null, found: false, path: location.pathname + location.search + location.hash };
      message('reveal-result', result);
      message('focus-result', result);
      return;
    }
    target.setAttribute(revealAttribute, '');
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    const rectangle = target.getBoundingClientRect();
    const result = {
      requestedSelector,
      resolvedSelector,
      found: true,
      target: target.tagName.toLowerCase(),
      rectangle: { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height },
      path: location.pathname + location.search + location.hash
    };
    message('reveal-result', result);
    message('focus-result', result);
  };
  addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.channel !== channel) return;
    if (data.type === 'navigate' && typeof data.path === 'string') go(data.path);
    if (data.type === 'back') history.back();
    if (data.type === 'forward') history.forward();
    if (data.type === 'reload') location.reload();
    if (data.type === 'audit') audit();
    if (data.type === 'set-theme-preview') applyThemePreview(data.theme);
    if (data.type === 'clear-theme-preview') clearThemePreview();
    if (data.type === 'reveal' || data.type === 'focus-selector') reveal(data.selector);
    if (data.type === 'clear-focus') {
      clearReveal();
      const result = { requestedSelector: null, resolvedSelector: null, found: false, cleared: true, path: location.pathname + location.search + location.hash };
      message('reveal-result', result);
      message('focus-result', result);
    }
  });
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState = (...args) => { pushState(...args); schedule(); };
  history.replaceState = (...args) => { replaceState(...args); schedule(); };
  addEventListener('popstate', schedule);
  addEventListener('hashchange', schedule);
  addEventListener('resize', schedule);
  addEventListener('keydown', (event) => { if (event.key === 'Escape') message('escape'); }, true);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!target || event.defaultPrevented) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    const destination = new URL(href, location.href);
    if (destination.origin !== location.origin || target.target === '_blank') {
      event.preventDefault();
      go(destination.href);
    }
  }, true);
  window.open = (url) => { if (typeof url === 'string' || url instanceof URL) go(String(url)); return null; };
  const start = () => {
    const mutationOptions = { attributes: true, attributeFilter: ['class', 'style', 'content', 'data-theme', 'data-color-scheme'], childList: true, subtree: true };
    mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.documentElement, mutationOptions);
    for (const element of composedElements(document.documentElement, 5000)) {
      if (element.shadowRoot) mutationObserver.observe(element.shadowRoot, mutationOptions);
    }
    schedule();
    setTimeout(() => renderStatus(false), 600);
    setTimeout(() => renderStatus(true), 1800);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  setTimeout(schedule, 0);
})();
</script>`

function normalizeOverrideKey(value: string): string | null {
  const key = posix.normalize(value.replaceAll('\\', '/').replace(/^\/+/, ''))
  const allowedHiddenPath = key.startsWith('.responsiver/') || key.startsWith('.output/public/')
  return key === '..' || key.startsWith('../') || key.startsWith('.') && !allowedHiddenPath ? null : key
}

function normalizePreviewBasePath(value?: string): string {
  if (!value) return ''
  const normalized = posix.normalize(value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''))
  const allowedRoots = ['dist', 'build', 'out', '.output/public']
  if (!allowedRoots.some((base) => normalized === base || normalized.startsWith(`${base}/`))) {
    throw new Error('Base de prévisualisation non autorisée.')
  }
  return normalized
}

function normalizeOverrides(overrides?: ReadonlyMap<string, Buffer | string>): Map<string, Buffer> {
  const normalized = new Map<string, Buffer>()
  for (const [path, value] of overrides ?? []) {
    const key = normalizeOverrideKey(path)
    if (key) normalized.set(key, Buffer.isBuffer(value) ? value : Buffer.from(value))
  }
  return normalized
}

function removeMetaCsp(html: string): string {
  return html.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?content-security-policy\1?[^>]*>/gi, '')
}

function injectRuntime(html: string, injectedCss: string): string {
  const source = removeMetaCsp(html)
  const style = injectedCss.trim() ? `<style data-responsiver-staging>\n${injectedCss}\n</style>` : ''
  const runtime = `${bridge}${style}`
  if (/<head\b[^>]*>/i.test(source)) return source.replace(/<head\b[^>]*>/i, (head) => `${head}${runtime}`)
  if (/<html\b[^>]*>/i.test(source)) return source.replace(/<html\b[^>]*>/i, (htmlTag) => `${htmlTag}<head>${runtime}</head>`)
  return `<!doctype html><html><head>${runtime}</head><body>${source}</body></html>`
}

function safeRelativePath(root: string, pathname: string, previewBasePath = ''): { absolutePath: string; relativePath: string } | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const requested = decoded.replace(/^\/+/, '')
  const candidate = resolve(root, requested || '.')
  const normalizedRoot = normalize(root.endsWith(sep) ? root : `${root}${sep}`)
  const pathFromRoot = relative(root, candidate)
  const webPathFromRoot = pathFromRoot.replaceAll(sep, '/')
  const allowedHiddenSegment = previewBasePath.startsWith('.') ? previewBasePath.split('/')[0] : null
  const insideHiddenPreviewBase = Boolean(allowedHiddenSegment) && (
    webPathFromRoot === previewBasePath || webPathFromRoot.startsWith(`${previewBasePath}/`)
  )
  const isHiddenPath = pathFromRoot.split(sep).some((segment) =>
    segment.startsWith('.') && segment !== '.well-known' && segment !== '.responsiver' && !(insideHiddenPreviewBase && segment === allowedHiddenSegment))
  if (isHiddenPath || !(candidate === root || candidate.startsWith(normalizedRoot))) return null
  return { absolutePath: candidate, relativePath: pathFromRoot.replaceAll(sep, '/') }
}

async function realFileWithinRoot(root: string, candidate: string): Promise<string | null> {
  const realCandidate = await fs.realpath(candidate).catch(() => null)
  if (!realCandidate) return null
  const normalizedRoot = normalize(root.endsWith(sep) ? root : `${root}${sep}`)
  return realCandidate === root || realCandidate.startsWith(normalizedRoot) ? realCandidate : null
}

function overriddenResource(overrides: ReadonlyMap<string, Buffer>, relativePath: string): ResolvedResource | null {
  const key = normalizeOverrideKey(relativePath)
  if (!key) return null
  const body = overrides.get(key)
  return body ? { absolutePath: null, body, relativePath: key } : null
}

async function directResource(
  root: string,
  overrides: ReadonlyMap<string, Buffer>,
  relativePath: string,
  previewBasePath = '',
  previewMountRoot: string | null = null
): Promise<ResolvedResource | null> {
  const override = overriddenResource(overrides, relativePath)
  if (override) return override
  const safe = safeRelativePath(root, `/${relativePath}`, previewBasePath)
  if (!safe) return null
  const stat = await fs.stat(safe.absolutePath).catch(() => null)
  if (!stat?.isFile()) return null
  const insidePreviewBase = Boolean(previewBasePath) && (
    relativePath === previewBasePath || relativePath.startsWith(`${previewBasePath}/`)
  )
  const containmentRoot = insidePreviewBase
    ? previewMountRoot
    : root
  if (!containmentRoot) return null
  const absolutePath = await realFileWithinRoot(containmentRoot, safe.absolutePath)
  return absolutePath ? { absolutePath, body: null, relativePath: safe.relativePath } : null
}

async function resolveRelativeResource(
  root: string,
  overrides: ReadonlyMap<string, Buffer>,
  relativePath: string,
  pathname: string,
  fallbackFloor: string,
  previewBasePath: string,
  previewMountRoot: string | null
): Promise<ResolvedResource | null> {
  let requested = relativePath
  const safe = safeRelativePath(root, `/${requested}`, previewBasePath)
  if (!safe) return null
  const stat = await fs.stat(safe.absolutePath).catch(() => null)
  if (!requested || stat?.isDirectory() || pathname.endsWith('/')) requested = posix.join(requested, 'index.html')
  const direct = await directResource(root, overrides, requested, previewBasePath, previewMountRoot)
  if (direct) return direct

  if (!extname(pathname)) {
    let current = posix.dirname(requested)
    while (true) {
      const fallback = await directResource(root, overrides, posix.join(current === '.' ? '' : current, 'index.html'), previewBasePath, previewMountRoot)
      if (fallback) return fallback
      if (current === fallbackFloor || current === '.') break
      const parent = posix.dirname(current)
      if (parent === current || fallbackFloor !== '.' && !parent.startsWith(`${fallbackFloor}/`) && parent !== fallbackFloor) break
      current = parent
    }
  }
  return null
}

async function resolveResource(
  root: string,
  overrides: ReadonlyMap<string, Buffer>,
  pathname: string,
  previewBasePath = '',
  previewMountRoot: string | null = null
): Promise<ResolvedResource | null> {
  let decodedPathname: string
  let requestedKey: string | null = null
  try {
    decodedPathname = decodeURIComponent(pathname)
    requestedKey = normalizeOverrideKey(decodedPathname)
  } catch {
    return null
  }
  const normalizedRequest = posix.normalize(decodedPathname.replaceAll('\\', '/').replace(/^\/+/, ''))
  const requestSegments = normalizedRequest.split('/').filter(Boolean)
  const responsiverSegment = requestSegments.indexOf('.responsiver')
  const rootOverlay = responsiverSegment === 0
  const mountedOverlayKey = rootOverlay && previewBasePath
    ? posix.join(previewBasePath, normalizedRequest)
    : null
  const effectiveOverlayKey = requestedKey && overrides.has(requestedKey)
    ? requestedKey
    : mountedOverlayKey && overrides.has(mountedOverlayKey)
      ? mountedOverlayKey
      : null
  // Tout dossier .responsiver physique reste invisible, y compris dans un
  // artefact. Seuls les fichiers virtuels exacts du staging sont accessibles.
  if (responsiverSegment >= 0 && (
    responsiverSegment === requestSegments.length - 1 || !effectiveOverlayKey
  )) return null
  const safe = safeRelativePath(root, pathname, previewBasePath)
  if (!safe) return null
  const requested = safe.relativePath
  const alreadyMounted = previewBasePath && (requested === previewBasePath || requested.startsWith(`${previewBasePath}/`))
  if (previewBasePath) {
    if (rootOverlay) {
      return resolveRelativeResource(root, overrides, effectiveOverlayKey ?? requested, pathname, '.', previewBasePath, previewMountRoot)
    }
    if (alreadyMounted) {
      return resolveRelativeResource(root, overrides, requested, pathname, previewBasePath, previewBasePath, previewMountRoot)
    }
    return resolveRelativeResource(
      root,
      overrides,
      posix.join(previewBasePath, requested),
      pathname,
      previewBasePath,
      previewBasePath,
      previewMountRoot
    )
  }
  return resolveRelativeResource(
    root,
    overrides,
    requested,
    pathname,
    '.',
    previewBasePath,
    previewMountRoot
  )
}

function commonHeaders(type: string, length?: number): Record<string, string | number> {
  return {
    'Content-Type': type,
    ...(typeof length === 'number' ? { 'Content-Length': length } : {}),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': previewCsp,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  }
}

function writeText(response: ServerResponse, status: number, message: string, method = 'GET'): void {
  const body = Buffer.from(message)
  response.writeHead(status, commonHeaders('text/plain; charset=utf-8', body.length))
  response.end(method === 'HEAD' ? undefined : body)
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'
  let start = match[1] ? Number(match[1]) : Number.NaN
  let end = match[2] ? Number(match[2]) : Number.NaN
  if (Number.isNaN(start) && Number.isNaN(end)) return 'invalid'
  if (Number.isNaN(start)) {
    const suffix = end
    if (suffix <= 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else if (Number.isNaN(end)) {
    end = size - 1
  }
  if (start < 0 || end < start || start >= size) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}

async function serveResource(request: IncomingMessage, response: ServerResponse, resource: ResolvedResource, injectedCss: string): Promise<void> {
  const extension = extname(resource.relativePath).toLowerCase()
  const type = mimeTypes[extension]
  if (!type) {
    writeText(response, 403, 'Type de ressource non autorisé dans la prévisualisation.', request.method)
    return
  }
  const isHtml = extension === '.html' || extension === '.htm'
  if (isHtml) {
    const source = resource.body ?? await fs.readFile(resource.absolutePath as string)
    const body = Buffer.from(injectRuntime(source.toString('utf8'), injectedCss))
    response.writeHead(200, commonHeaders(type, body.length))
    response.end(request.method === 'HEAD' ? undefined : body)
    return
  }

  const size = resource.body?.length ?? (await fs.stat(resource.absolutePath as string)).size
  const range = parseRange(request.headers.range, size)
  if (range === 'invalid') {
    response.writeHead(416, { ...commonHeaders(type, 0), 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
    response.end()
    return
  }
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const headers = { ...commonHeaders(type, end - start + 1), 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) }
  response.writeHead(range ? 206 : 200, headers)
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  if (size === 0) {
    response.end()
    return
  }
  if (resource.body) {
    response.end(resource.body.subarray(start, end + 1))
    return
  }
  const stream = createReadStream(resource.absolutePath as string, { start, end })
  stream.once('error', () => response.destroy())
  stream.pipe(response)
}

export async function startProjectServer(root: string, options: ProjectServerOptions = {}): Promise<ProjectServer> {
  const realRoot = await fs.realpath(root)
  const mode = options.mode ?? 'source'
  const overrides = normalizeOverrides(options.overrides)
  const injectedCss = options.injectedCss ?? ''
  const previewBasePath = normalizePreviewBasePath(options.previewBasePath)
  const previewMountRoot = previewBasePath
    ? await fs.realpath(resolve(realRoot, previewBasePath)).catch(() => null)
    : null
  if (previewBasePath) {
    const normalizedRoot = normalize(realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`)
    const mountStat = previewMountRoot ? await fs.stat(previewMountRoot).catch(() => null) : null
    if (!previewMountRoot || !mountStat?.isDirectory() || !previewMountRoot.startsWith(normalizedRoot)) {
      throw new Error('Base de prévisualisation hors du projet ou indisponible.')
    }
  }
  let server: Server
  let expectedHost = ''

  server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        writeText(response, 405, 'Méthode non autorisée.', request.method)
        return
      }
      if (request.headers.host !== expectedHost) {
        writeText(response, 421, 'Hôte local inattendu.', request.method)
        return
      }
      response.setHeader('X-Responsiver-Mode', mode)
      if (previewBasePath) response.setHeader('X-Responsiver-Base', previewBasePath)
      const url = new URL(request.url ?? '/', `http://${expectedHost}`)
      const resource = await resolveResource(realRoot, overrides, url.pathname, previewBasePath, previewMountRoot)
      if (!resource) {
        writeText(response, 404, 'Ressource locale introuvable.', request.method)
        return
      }
      await serveResource(request, response, resource, injectedCss)
    } catch {
      if (!response.headersSent) writeText(response, 500, 'Erreur du serveur de prévisualisation local.', request.method)
      else response.destroy()
    }
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Le port de prévisualisation local est indisponible.')
  expectedHost = `127.0.0.1:${address.port}`

  let closed = false
  return {
    origin: `http://${expectedHost}`,
    mode,
    close: async () => {
      if (closed) return
      closed = true
      server.closeAllConnections()
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
  }
}
