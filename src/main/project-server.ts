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
  maxFindings: 60,
  maxFindingsPerRule: 12,
  maxLegacyOverflows: 8,
  maxContrastChecks: 600
})

/** Bornes du mode inspecteur et des surcharges visuelles éphémères. */
export const LOCAL_VISUAL_BRIDGE_LIMITS = Object.freeze({
  maxCssBytes: 64 * 1024,
  maxSelectorLength: 640,
  maxRouteLength: 1_024,
  maxTextLength: 180,
  maxClasses: 12,
  maxClassLength: 80,
  maxStyleValueLength: 240,
  maxOccurrenceScan: 2_500
})

const managedStylesheetPath = '.responsiver/responsiver.generated.css'

const bridge = `<style data-responsiver-bridge-style>
[data-responsiver-reveal-target] {
  outline: 3px solid #b94d32 !important;
  outline-offset: 4px !important;
  scroll-margin: 72px !important;
}
</style><script data-responsiver-bridge>
	(() => {
	  const channel = 'responsiver-preview';
	  const documentId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const revealAttribute = 'data-responsiver-reveal-target';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUDIT_MAX_NODES = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxNodes};
  const AUDIT_MAX_FINDINGS = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxFindings};
  const AUDIT_MAX_RAW_FINDINGS = AUDIT_MAX_FINDINGS * 3;
  const AUDIT_MAX_FINDINGS_PER_RULE = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxFindingsPerRule};
  const AUDIT_MAX_LEGACY_OVERFLOWS = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxLegacyOverflows};
  const AUDIT_MAX_CONTRAST_CHECKS = ${LOCAL_RUNTIME_AUDIT_LIMITS.maxContrastChecks};
  const AUDIT_MOBILE_MAX_WIDTH = 768;
  const AUDIT_MIN_TARGET_SIZE = 44;
  const VISUAL_MAX_CSS_BYTES = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxCssBytes};
  const VISUAL_MAX_SELECTOR_LENGTH = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxSelectorLength};
  const VISUAL_MAX_ROUTE_LENGTH = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxRouteLength};
  const VISUAL_MAX_TEXT_LENGTH = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxTextLength};
  const VISUAL_MAX_CLASSES = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxClasses};
  const VISUAL_MAX_CLASS_LENGTH = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxClassLength};
  const VISUAL_MAX_STYLE_VALUE_LENGTH = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxStyleValueLength};
  const VISUAL_MAX_OCCURRENCE_SCAN = ${LOCAL_VISUAL_BRIDGE_LIMITS.maxOccurrenceScan};
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
  const message = (type, payload = {}) => top.postMessage({ channel, type, ...payload }, '*');
  const relayInspectorCommand = (type) => {
    for (let index = 0; index < Math.min(24, frames.length); index += 1) {
      try { frames[index].postMessage({ channel, type, relayedByResponsiver: true }, '*'); } catch {}
    }
  };
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
	  const state = (requestId) => {
	    const theme = themeState();
	    message('state', {
	      documentId,
	      ...(typeof requestId === 'string' && requestId.length <= 128 ? { requestId } : {}),
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
    const targetCandidates = [];
    const navigationCandidates = [];
    const collisionCandidates = [];
    const disproportionateHeadings = new Set();
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
      if (findings.length >= AUDIT_MAX_RAW_FINDINGS || ruleCount >= AUDIT_MAX_FINDINGS_PER_RULE) {
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
    const semanticName = (element) => clean([
      element?.id || '',
      typeof element?.className === 'string' ? element.className : '',
      element?.getAttribute?.('role') || ''
    ].join(' ')).toLowerCase();
    const intentionalViewport = (element) => /(?:carousel|slider|slideshow|marquee|ticker|scroller|viewport|track|rail)/.test(semanticName(element));
    const insideIntentionalViewport = (element) => {
      let current = element;
      while (current && current !== document.documentElement) {
        if (intentionalViewport(current)) return true;
        current = parentElementOf(current);
      }
      return false;
    };
    const screenReaderOnly = (element, style, rect) => {
      if (/(?:sr-only|screen-reader|visually-hidden|a11y-hidden)/.test(semanticName(element))) return true;
      return rect.width <= 2 && rect.height <= 2 && (style.clip !== 'auto' || style.clipPath !== 'none' || style.position === 'absolute');
    };
    const fullyClippedByAncestor = (element, rect) => {
      let current = parentElementOf(element);
      while (current && current !== document.documentElement) {
        const currentStyle = getComputedStyle(current);
        const clipsX = /^(?:hidden|clip|auto|scroll)$/.test(currentStyle.overflowX);
        const clipsY = /^(?:hidden|clip|auto|scroll)$/.test(currentStyle.overflowY);
        if (clipsX || clipsY) {
          const currentRect = current.getBoundingClientRect();
          if (clipsX && (rect.right <= currentRect.left + 1 || rect.left >= currentRect.right - 1)) return true;
          if (clipsY && (rect.bottom <= currentRect.top + 1 || rect.top >= currentRect.bottom - 1)) return true;
        }
        current = parentElementOf(current);
      }
      return false;
    };
    const overlapOf = (left, right) => {
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      return { width, height, area: width * height };
    };
    const paintedHorizontalRatio = (element, rect) => {
      let left = Math.max(0, rect.left);
      let right = Math.min(viewportWidth, rect.right);
      let current = parentElementOf(element);
      while (current && current !== document.documentElement) {
        const currentStyle = getComputedStyle(current);
        if (/^(?:hidden|clip|auto|scroll)$/.test(currentStyle.overflowX)) {
          const currentRect = current.getBoundingClientRect();
          left = Math.max(left, currentRect.left);
          right = Math.min(right, currentRect.right);
        }
        current = parentElementOf(current);
      }
      return Math.max(0, right - left) / Math.max(1, rect.width);
    };
    const nearestTargetGroup = (element) => element.closest('nav,[role="navigation"],[role="group"],ul,ol,[class*="actions" i],[class*="controls" i],[class*="dots" i]') || parentElementOf(element) || element;

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
      const clippedFromPaint = fullyClippedByAncestor(element, rect);
      const intersectsUsefulWidth = rect.right > 1 && rect.left < viewportWidth - 1;
      const paintedRatio = paintedHorizontalRatio(element, rect);
      const documentOverflows = documentWidth > viewportWidth + 1;
      if (element.matches('nav,[role="navigation"]')) navigationCandidates.push({ element, style, rect });
      if (!clippedFromPaint && paintedRatio >= .5 && intersectsUsefulWidth && element.matches('h1,h2,h3,h4,h5,h6,p,a[href],button,input:not([type="hidden"]),select,textarea,[role="button"]')) {
        collisionCandidates.push({ element, style, rect });
      }

      const beyondViewport = rect.right > viewportWidth + 1 || rect.left < -1;
      const scrollOverflow = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
      if (beyondViewport && !clippedFromPaint && !insideIntentionalViewport(element) && style.position !== 'fixed' && style.position !== 'sticky' && (intersectsUsefulWidth || documentOverflows)) {
        recordOverflow(element, rect);
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const usefulRatio = visibleWidth / Math.max(1, rect.width);
        const mostlyOutside = intersectsUsefulWidth && usefulRatio < .45;
        addFinding(mostlyOutside ? 'layout.useful-area-overflow' : 'layout.viewport-overflow', element, rect, 'error',
          mostlyOutside ? 'Contenu majoritairement hors de la zone utile' : 'Élément hors du viewport',
          mostlyOutside ? 'Moins de la moitié de cet élément textuel ou interactif reste accessible dans la largeur utile.' : 'Le rendu dépasse horizontalement la largeur testée.',
          mostlyOutside
            ? 'Contraindre ce bloc avec max-inline-size: 100%, min-inline-size: 0 et un retour à la ligne au breakpoint concerné.'
            : 'Remplacer les dimensions rigides par des contraintes fluides et limiter la largeur au viewport.', .94);
      } else if (scrollOverflow && documentOverflows && !insideIntentionalViewport(element) && style.overflowX === 'visible' && element !== document.documentElement && element !== document.body) {
        recordOverflow(element, rect);
        addFinding('layout.viewport-overflow', element, rect, 'warning', 'Contenu horizontal débordant',
          'Le contenu est plus large que son conteneur sans mécanisme de défilement.',
          'Adapter les largeurs minimales, autoriser le retour à la ligne ou ajouter un défilement explicite.', .82);
      }

      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const clippedX = clipsX && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
      const clippedY = clipsY && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1;
      if ((clippedX || clippedY) && !screenReaderOnly(element, style, rect) && !intentionalViewport(element)) {
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
        let effectiveRect = rect;
        const label = element.closest('label') || (element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null);
        if (label) {
          const labelRect = label.getBoundingClientRect();
          if (labelRect.width > effectiveRect.width || labelRect.height > effectiveRect.height) effectiveRect = labelRect;
        }
        targetCandidates.push({ element, style, rect: effectiveRect, group: nearestTargetGroup(element) });
      }

      if ((style.position === 'fixed' || style.position === 'sticky') && style.pointerEvents !== 'none') fixedCandidates.push({ element, style, rect });

      if (hasOwnText(element)) {
        const ownTextLength = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .reduce((total, node) => total + clean(node.nodeValue).length, 0);
        const fontSize = Number.parseFloat(style.fontSize) || 16;
        const lineHeight = style.lineHeight === 'normal' ? fontSize * 1.2 : Number.parseFloat(style.lineHeight) || fontSize * 1.2;
        const visualLineRatio = rect.height / Math.max(1, lineHeight);
        const heading = element.closest('h1,h2,h3,h4,h5,h6');
        const compactTypography = viewportWidth <= 1100;
        const overlyWideDisplay = compactTypography && fontSize >= 32 && ownTextLength >= 8 && rect.width >= viewportWidth * (viewport.mobile ? .88 : .72) && visualLineRatio > 1.65;
        const extremeScale = compactTypography && fontSize > Math.max(viewport.mobile ? 72 : 84, viewportWidth * (viewport.mobile ? .22 : .16)) && ownTextLength >= 10;
        if ((overlyWideDisplay || extremeScale) && heading && !disproportionateHeadings.has(heading)) {
          disproportionateHeadings.add(heading);
          addFinding('typography.disproportionate', heading, heading.getBoundingClientRect(), 'warning', 'Échelle typographique disproportionnée',
            'Le titre occupe une part dominante de la largeur et ses métriques de ligne gonflent fortement sa hauteur utile.',
            'Borner le titre avec font-size: clamp(...) et une line-height cohérente, puis contrôler la police réellement chargée.', extremeScale ? .9 : .82);
        }
        if (contrastChecks >= AUDIT_MAX_CONTRAST_CHECKS) {
          truncated = true;
        } else {
          contrastChecks += 1;
          const ownText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => clean(node.nodeValue)).join(' ').trim();
          const decorativeBrandText = /^[★☆✦✧•·\s]+$/.test(ownText) || ownText.length <= 1 && /(?:avatar|brand|logo|mark|rating)/.test(semanticName(element) + ' ' + semanticName(parentElementOf(element)));
          const foreground = clippedFromPaint || paintedRatio < .5 || !intersectsUsefulWidth || decorativeBrandText ? null : parseOpaqueRgb(style.color);
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

    if (viewport.mobile) {
      const smallTargets = targetCandidates.filter((candidate) => Math.min(candidate.rect.width, candidate.rect.height) < 24 && !fullyClippedByAncestor(candidate.element, candidate.rect));
      const crowded = smallTargets.filter((candidate) => smallTargets.some((other) => {
        if (candidate === other || candidate.group !== other.group) return false;
        const leftX = candidate.rect.left + candidate.rect.width / 2;
        const leftY = candidate.rect.top + candidate.rect.height / 2;
        const rightX = other.rect.left + other.rect.width / 2;
        const rightY = other.rect.top + other.rect.height / 2;
        return Math.hypot(leftX - rightX, leftY - rightY) < 24;
      }));
      const byGroup = new Map();
      for (const candidate of crowded) {
        const group = byGroup.get(candidate.group) || [];
        group.push(candidate);
        byGroup.set(candidate.group, group);
      }
      for (const [groupElement, candidates] of byGroup) {
        if (candidates.length < 2) continue;
        const groupRect = groupElement.getBoundingClientRect();
        const minimum = Math.min(...candidates.map((candidate) => Math.min(candidate.rect.width, candidate.rect.height)));
        const denseGroup = candidates.length >= 6 && groupRect.height < 96;
        addFinding(denseGroup ? 'layout.density-hierarchy' : 'interaction.small-target', groupElement, groupRect, 'warning',
          denseGroup ? 'Groupe de commandes visuellement trop dense' : 'Groupe de cibles tactiles trop serré',
          denseGroup
            ? candidates.length + ' commandes compactes sont concentrées sans hiérarchie ou espacement suffisant.'
            : candidates.length + ' cibles ont une dimension minimale de ' + round(minimum) + ' px et sont assez proches pour rendre leur activation ambiguë.',
          denseGroup
            ? 'Réduire les commandes simultanées ou augmenter gap et padding dans ce groupe.'
            : 'Porter les zones activables à 24 CSS px minimum ou assurer 24 px entre leurs centres.', denseGroup ? .84 : .9);
      }
    }

    for (const candidate of navigationCandidates) {
      if (candidate.element.closest('footer') || /(?:legal|footer|breadcrumb|pagination)/.test(semanticName(candidate.element))) continue;
      const items = [...candidate.element.querySelectorAll(targetSelector)].map((item) => {
        const itemStyle = getComputedStyle(item);
        const itemRect = item.getBoundingClientRect();
        return { item, style: itemStyle, rect: itemRect };
      }).filter(({ item, style, rect }) => visible(style, rect) && !fullyClippedByAncestor(item, rect));
      if (items.length < 3) continue;
      const rows = [];
      for (const item of items.sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)) {
        let row = rows.find((candidateRow) => Math.abs(candidateRow.top - item.rect.top) <= 5);
        if (!row) { row = { top: item.rect.top, items: [] }; rows.push(row); }
        row.items.push(item);
      }
      const rowWidths = rows.map((row) => Math.max(...row.items.map((item) => item.rect.right)) - Math.min(...row.items.map((item) => item.rect.left)));
      const firstWidth = rowWidths[0] || 1;
      const lastWidth = rowWidths[rowWidths.length - 1] || firstWidth;
      const minimumFont = Math.min(...items.map((item) => Number.parseFloat(item.style.fontSize) || 16));
      const hasOverlap = items.some((item, index) => items.slice(index + 1).some((other) => {
        const overlap = overlapOf(item.rect, other.rect);
        return overlap.width > 4 && overlap.height > 4;
      }));
      const contentLeft = Math.min(candidate.rect.left, ...items.map((item) => item.rect.left));
      const contentRight = Math.max(candidate.rect.right, ...items.map((item) => item.rect.right));
      const intrinsicOverflow = Math.max(0, candidate.element.scrollWidth - candidate.element.clientWidth);
      const overflowAmount = Math.max(0, -contentLeft, contentRight - viewportWidth, candidate.rect.width - viewportWidth, intrinsicOverflow);
      const extendsViewport = overflowAmount > 4 && !/^(?:auto|scroll)$/.test(candidate.style.overflowX);
      const awkwardWrap = viewport.mobile && rows.length > 1 && items.length >= 5 && lastWidth / firstWidth < .62;
      const unreadable = minimumFont < 12;
      if (!hasOverlap && !unreadable && !extendsViewport && rows.length < 3 && !awkwardWrap) continue;
      addFinding('layout.navigation-wrap', candidate.element, candidate.rect, hasOverlap ? 'error' : 'warning', 'Navigation déséquilibrée à cette largeur',
        hasOverlap
          ? 'Des commandes de navigation se chevauchent.'
          : extendsViewport
            ? 'Le bloc de navigation dépasse la largeur visible de ' + round(overflowAmount) + ' CSS px et repousse ou masque une partie de l’interface.'
          : unreadable
            ? 'La navigation réduit son texte sous 12 CSS px pour tenir dans la largeur.'
            : awkwardWrap
              ? 'Le retour à la ligne laisse une dernière rangée nettement plus courte et casse la hiérarchie du menu.'
              : 'La navigation se répartit sur au moins trois rangées et occupe une hauteur disproportionnée.',
        'À ce breakpoint, préférer une navigation repliable ou équilibrer explicitement flex-wrap, gap et les zones tactiles.', hasOverlap || unreadable ? .92 : .8);
    }

    const collisionParents = new Set();
    for (let index = 0; index < collisionCandidates.length; index += 1) {
      const left = collisionCandidates[index];
      const parent = parentElementOf(left.element);
      if (!parent || collisionParents.has(parent) || intentionalViewport(parent) || /(?:hero|overlay|modal|dialog|badge)/.test(semanticName(parent))) continue;
      for (let otherIndex = index + 1; otherIndex < Math.min(collisionCandidates.length, index + 40); otherIndex += 1) {
        const right = collisionCandidates[otherIndex];
        if (parentElementOf(right.element) !== parent) continue;
        const overlap = overlapOf(left.rect, right.rect);
        const smallerArea = Math.max(1, Math.min(left.rect.width * left.rect.height, right.rect.width * right.rect.height));
        if (overlap.width <= 6 || overlap.height <= 6 || overlap.area / smallerArea < .16) continue;
        collisionParents.add(parent);
        addFinding('layout.element-overlap', parent, parent.getBoundingClientRect(), 'error', 'Éléments de contenu qui se chevauchent',
          'Deux éléments textuels ou interactifs frères recouvrent ' + round(overlap.area / smallerArea * 100) + ' % du plus petit élément.',
          'Rétablir le flux, le gap ou la grille du conteneur avant de modifier les z-index.', .9);
        break;
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

    const rulePriority = {
      'layout.element-overlap': 100,
      'layout.useful-area-overflow': 95,
      'layout.viewport-overflow': 90,
      'layout.navigation-wrap': 85,
      'typography.disproportionate': 80,
      'layout.density-hierarchy': 75,
      'interaction.small-target': 70
    };
    findings.sort((left, right) => (right.severity === 'error' ? 2 : 1) - (left.severity === 'error' ? 2 : 1) ||
      (rulePriority[right.rule] || 0) - (rulePriority[left.rule] || 0) || right.confidence - left.confidence);
    if (findings.length > AUDIT_MAX_FINDINGS) {
      findings.length = AUDIT_MAX_FINDINGS;
      truncated = true;
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
    scheduleInspectorHighlights();
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
  const inspectorStyleProperties = Object.freeze([
    'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
    'grid-template-columns', 'grid-template-rows', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'text-align', 'white-space', 'color', 'background-color', 'border-top-width', 'border-top-style', 'border-top-color',
    'border-radius', 'overflow-x', 'overflow-y', 'opacity', 'visibility', 'z-index', 'transform'
  ]);
  let inspectorActive = false;
  let inspectorHovered = null;
  let inspectorSelected = null;
  let inspectorHoverOverlay = null;
  let inspectorSelectedOverlay = null;
  let inspectorFrame = 0;
  const inspectorClean = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const inspectorRound = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(Math.max(-10000000, Math.min(10000000, numeric)) * 100) / 100;
  };
  const selectorForScope = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 5) {
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
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
  const positionalSelectorForScope = (element) => {
    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 6) {
      const parent = current.parentNode;
      const siblings = parent && 'children' in parent ? [...parent.children] : [];
      const index = siblings.indexOf(current);
      parts.unshift(index >= 0 ? '*:nth-child(' + (index + 1) + ')' : '*');
      current = current.parentElement;
    }
    return parts.join(' > ') || '*';
  };
  const selectorForInspector = (element) => {
    const build = (positional) => {
      const segments = [];
      let current = element;
      while (current instanceof Element && segments.length < 4) {
        segments.unshift(positional ? positionalSelectorForScope(current) : selectorForScope(current));
        const root = current.getRootNode();
        if (!(root instanceof ShadowRoot)) break;
        current = root.host;
      }
      return segments.join(' >>> ');
    };
    const preferred = build(false);
    if (preferred.length <= VISUAL_MAX_SELECTOR_LENGTH) return preferred;
    const positional = build(true);
    return positional.length <= VISUAL_MAX_SELECTOR_LENGTH ? positional : '*';
  };
  const isInspectorInternal = (element) => element.hasAttribute('data-responsiver-inspector-overlay') ||
    element.hasAttribute('data-responsiver-bridge') || element.hasAttribute('data-responsiver-bridge-style') ||
    element.hasAttribute('data-responsiver-visual-preview');
  const isInspectable = (element) => element instanceof Element && element.isConnected && !isInspectorInternal(element) &&
    !/^(?:base|head|link|meta|script|style|template|title)$/.test(element.tagName.toLowerCase());
  const inspectorTargetFromEvent = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.find((candidate) => candidate instanceof Element && isInspectable(candidate)) || null;
  };
  const inspectorOccurrences = (selector) => {
    if (!selector.includes(' >>> ')) {
      try { return Math.max(1, Math.min(10000, document.querySelectorAll(selector).length)); } catch {}
    }
    let count = 0;
    const elements = composedElements(document.documentElement, VISUAL_MAX_OCCURRENCE_SCAN);
    for (const element of elements) {
      if (!isInspectable(element)) continue;
      if (selectorForInspector(element) === selector) count += 1;
    }
    return Math.max(1, count);
  };
  const inspectorPayload = (element, countOccurrences = false) => {
    if (!isInspectable(element)) return null;
    const selector = selectorForInspector(element);
    const rectangle = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const styles = {};
    for (const property of inspectorStyleProperties) {
      styles[property] = inspectorClean(computed.getPropertyValue(property), VISUAL_MAX_STYLE_VALUE_LENGTH);
    }
    const tag = element.tagName.toLowerCase().slice(0, 32);
    const excludesEditableText = /^(?:input|option|select|textarea)$/.test(tag) || Boolean(element.closest('[contenteditable]'));
    const text = excludesEditableText ? '' : inspectorClean(element.innerText || element.textContent, VISUAL_MAX_TEXT_LENGTH);
    return {
      selector,
      tag,
      classes: [...element.classList].slice(0, VISUAL_MAX_CLASSES).map((name) => inspectorClean(name, VISUAL_MAX_CLASS_LENGTH)),
      role: inspectorClean(element.getAttribute('role'), 80),
      ariaLabel: inspectorClean(element.getAttribute('aria-label'), 160),
      rect: {
        x: inspectorRound(rectangle.x),
        y: inspectorRound(rectangle.y),
        width: inspectorRound(rectangle.width),
        height: inspectorRound(rectangle.height)
      },
      styles,
      occurrences: countOccurrences ? inspectorOccurrences(selector) : 1,
      route: inspectorClean(location.pathname + location.search + location.hash, VISUAL_MAX_ROUTE_LENGTH),
      insideFrame: parent !== top,
      editable: parent === top && selector !== '*' && selector.length <= 320 && !selector.includes(' >>> '),
      text
    };
  };
  const createInspectorOverlay = (kind) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-responsiver-inspector-overlay', kind);
    const color = kind === 'selected' ? '#b94d32' : '#3b82a0';
    const properties = {
      all: 'initial', position: 'fixed', display: 'none', 'box-sizing': 'border-box', margin: '0', padding: '0',
      border: '2px solid ' + color, 'border-radius': '3px', background: kind === 'selected' ? 'rgba(185, 77, 50, .08)' : 'rgba(59, 130, 160, .07)',
      'box-shadow': '0 0 0 1px rgba(255, 255, 255, .8)', 'pointer-events': 'none', 'user-select': 'none',
      'z-index': '2147483647', contain: 'strict'
    };
    for (const [name, value] of Object.entries(properties)) overlay.style.setProperty(name, value, 'important');
    document.documentElement.append(overlay);
    return overlay;
  };
  const paintInspectorOverlay = (overlay, element) => {
    if (!overlay || !inspectorActive || !isInspectable(element)) {
      overlay?.style.setProperty('display', 'none', 'important');
      return;
    }
    const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) {
      overlay.style.setProperty('display', 'none', 'important');
      return;
    }
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty('left', inspectorRound(rectangle.left) + 'px', 'important');
    overlay.style.setProperty('top', inspectorRound(rectangle.top) + 'px', 'important');
    overlay.style.setProperty('width', inspectorRound(rectangle.width) + 'px', 'important');
    overlay.style.setProperty('height', inspectorRound(rectangle.height) + 'px', 'important');
  };
  const refreshInspectorHighlights = () => {
    inspectorFrame = 0;
    paintInspectorOverlay(inspectorHoverOverlay, inspectorHovered);
    paintInspectorOverlay(inspectorSelectedOverlay, inspectorSelected);
  };
  const scheduleInspectorHighlights = () => {
    if (!inspectorActive || inspectorFrame) return;
    inspectorFrame = requestAnimationFrame(refreshInspectorHighlights);
  };
  const stopInspector = (reason = 'request') => {
    if (inspectorFrame) cancelAnimationFrame(inspectorFrame);
    inspectorFrame = 0;
    inspectorActive = false;
    inspectorHovered = null;
    inspectorSelected = null;
    inspectorHoverOverlay?.remove();
    inspectorSelectedOverlay?.remove();
    inspectorHoverOverlay = null;
    inspectorSelectedOverlay = null;
    relayInspectorCommand('inspector-stop');
    message('inspector-stopped', { reason, route: inspectorClean(location.pathname + location.search + location.hash, VISUAL_MAX_ROUTE_LENGTH) });
  };
  const startInspector = () => {
    if (!inspectorActive) {
      inspectorActive = true;
      inspectorHovered = null;
      inspectorSelected = null;
      inspectorHoverOverlay = createInspectorOverlay('hover');
      inspectorSelectedOverlay = createInspectorOverlay('selected');
    }
    relayInspectorCommand('inspector-start');
    scheduleInspectorHighlights();
    message('inspector-started', { route: inspectorClean(location.pathname + location.search + location.hash, VISUAL_MAX_ROUTE_LENGTH) });
  };
  const selectInspectorTarget = (value) => {
    if (!inspectorActive || typeof value !== 'string' || !value.trim() || value.includes('>>>')) return;
    let target = null;
    try { target = document.querySelector(value.trim().slice(0, VISUAL_MAX_SELECTOR_LENGTH)); } catch { return; }
    if (!isInspectable(target)) return;
    inspectorSelected = target;
    inspectorHovered = target;
    scheduleInspectorHighlights();
    const payload = inspectorPayload(target, true);
    if (payload) message('inspector-selected', payload);
  };
  const applyVisualStylePreview = (value) => {
    if (typeof value !== 'string') {
      message('visual-style-preview-result', { applied: false, reason: 'invalid-css' });
      return;
    }
    let byteLength = VISUAL_MAX_CSS_BYTES + 1;
    if (value.length <= VISUAL_MAX_CSS_BYTES) byteLength = new TextEncoder().encode(value).byteLength;
    if (byteLength > VISUAL_MAX_CSS_BYTES) {
      message('visual-style-preview-result', { applied: false, reason: 'css-too-large', maxBytes: VISUAL_MAX_CSS_BYTES });
      return;
    }
    let style = document.querySelector('style[data-responsiver-visual-preview]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-responsiver-visual-preview', '');
      (document.head || document.documentElement).append(style);
    }
    style.textContent = value;
    requestAnimationFrame(() => { schedule(); scheduleInspectorHighlights(); });
    message('visual-style-preview-result', { applied: true, bytes: byteLength });
  };
  const clearVisualStylePreview = () => {
    document.querySelector('style[data-responsiver-visual-preview]')?.remove();
    requestAnimationFrame(() => { schedule(); scheduleInspectorHighlights(); });
    message('visual-style-clear-result', { cleared: true });
  };
  document.addEventListener('pointermove', (event) => {
    if (!inspectorActive) return;
    const target = inspectorTargetFromEvent(event);
    if (target === inspectorHovered) {
      scheduleInspectorHighlights();
      return;
    }
    inspectorHovered = target;
    scheduleInspectorHighlights();
    const payload = target ? inspectorPayload(target, false) : null;
    if (payload) message('inspector-hover', payload);
  }, true);
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
    document.addEventListener(type, (event) => {
      if (!inspectorActive) return;
      const target = inspectorTargetFromEvent(event);
      if (!target) return;
      if (type === 'pointerdown') {
        inspectorSelected = target;
        scheduleInspectorHighlights();
        const payload = inspectorPayload(target, true);
        if (payload) message('inspector-selected', payload);
      }
      if (type === 'mousedown') event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  document.addEventListener('click', (event) => {
    if (!inspectorActive) return;
    const target = inspectorTargetFromEvent(event);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const changed = inspectorSelected !== target;
    inspectorSelected = target;
    scheduleInspectorHighlights();
    const payload = changed ? inspectorPayload(target, true) : null;
    if (payload) message('inspector-selected', payload);
  }, true);
  addEventListener('scroll', scheduleInspectorHighlights, true);
  addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== channel) return;
    if (event.source !== parent) {
      if (data.type === 'inspector-child-ready' && inspectorActive && event.source && 'postMessage' in event.source) {
        try { event.source.postMessage({ channel, type: 'inspector-start', relayedByResponsiver: true }, '*'); } catch {}
      }
      return;
    }
    if (data.type === 'navigate' && typeof data.path === 'string') go(data.path);
	    if (data.type === 'state-request') state(data.requestId);
    if (data.type === 'back') history.back();
    if (data.type === 'forward') history.forward();
    if (data.type === 'reload') location.reload();
    if (data.type === 'audit') audit();
    if (data.type === 'set-theme-preview') applyThemePreview(data.theme);
    if (data.type === 'clear-theme-preview') clearThemePreview();
    if (data.type === 'inspector-start') startInspector();
    if (data.type === 'inspector-stop') stopInspector();
    if (data.type === 'visual-style-preview') applyVisualStylePreview(data.css);
    if (data.type === 'visual-style-clear') clearVisualStylePreview();
    if (data.type === 'reveal' || data.type === 'focus-selector') {
      reveal(data.selector);
      if (data.type === 'focus-selector') selectInspectorTarget(data.selector);
    }
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
  addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const inspectorShortcut = event.key === 'F12' || ((event.metaKey || event.ctrlKey) && event.altKey && key === 'i') || ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'c');
    if (inspectorShortcut) {
      event.preventDefault();
      event.stopImmediatePropagation();
      message('inspector-shortcut');
      return;
    }
    if (event.key !== 'Escape') return;
    if (inspectorActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopInspector('escape');
    }
    message('escape');
  }, true);
  addEventListener('wheel', (event) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    message('preview-zoom', {
      deltaY: Math.max(-1000, Math.min(1000, Number(event.deltaY) || 0)),
      deltaMode: Math.max(0, Math.min(2, Number(event.deltaMode) || 0)),
      clientX: inspectorRound(event.clientX),
      clientY: inspectorRound(event.clientY)
    });
  }, { capture: true, passive: false });
  if (parent !== top) {
    try { parent.postMessage({ channel, type: 'inspector-child-ready' }, '*'); } catch {}
  }
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
    mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element && isInspectorInternal(record.target)))) schedule();
    });
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
  const managedPhysicalStylesheet = normalizedRequest === managedStylesheetPath
  const rootOverlay = responsiverSegment === 0
  const mountedOverlayKey = rootOverlay && previewBasePath
    ? posix.join(previewBasePath, normalizedRequest)
    : null
  const effectiveOverlayKey = requestedKey && overrides.has(requestedKey)
    ? requestedKey
    : mountedOverlayKey && overrides.has(mountedOverlayKey)
      ? mountedOverlayKey
      : null
  // Le dossier .responsiver physique reste invisible, à l’exception de la
  // feuille gérée explicitement liée après application. Les fichiers virtuels
  // exacts du staging restent autorisés séparément.
  if (responsiverSegment >= 0 && (
    responsiverSegment === requestSegments.length - 1 || !effectiveOverlayKey && !managedPhysicalStylesheet
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
