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
  const nativeApply = Reflect.apply;
  const nativeStringify = JSON.stringify.bind(JSON);
  const nativeEventAddEventListener = EventTarget.prototype.addEventListener;
  const nativeEventStopImmediatePropagation = Event.prototype.stopImmediatePropagation;
  const nativeMessagePortPostMessage = MessagePort.prototype.postMessage;
  const nativeMessagePortStart = MessagePort.prototype.start;
  const nativeMessagePortClose = MessagePort.prototype.close;
  const nativeMessageEventData = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')?.get;
  const nativeMessageEventPorts = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'ports')?.get;
  const nativeMessageEventSource = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'source')?.get;
  const readMessageEventData = (event) => nativeMessageEventData ? nativeApply(nativeMessageEventData, event, []) : event.data;
  const readMessageEventPorts = (event) => nativeMessageEventPorts ? nativeApply(nativeMessageEventPorts, event, []) : event.ports;
  const readMessageEventSource = (event) => nativeMessageEventSource ? nativeApply(nativeMessageEventSource, event, []) : event.source;
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
  const colorChannels = (value) => {
    const match = String(value || '').match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+)%?)?\\s*\\)/i);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4]) / (String(match[0]).includes('%') ? 100 : 1)));
    return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha };
  };
  const transparent = (value) => {
    if (!value || String(value).trim().toLowerCase() === 'transparent') return true;
    const channels = colorChannels(value);
    return channels ? channels.alpha <= .01 : false;
  };
  const luminance = (value) => {
    const channels = colorChannels(value);
    if (!channels) return null;
    const components = [channels.red, channels.green, channels.blue].map((part) => part / 255).map((part) => part <= .03928 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4);
    return .2126 * components[0] + .7152 * components[1] + .0722 * components[2];
  };
  const compositeColor = (foreground, background) => {
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
    if (alpha <= .001) return { red: 255, green: 255, blue: 255, alpha: 1 };
    return {
      red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
      green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
      blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
      alpha
    };
  };
  const internalSurfaceSelector = '[data-responsiver-inspector-overlay], [data-responsiver-composer-active], [data-responsiver-bridge]';
  const isResponsiverSurface = (element) => {
    let current = element;
    const visited = new Set();
    while (current instanceof Element && !visited.has(current)) {
      visited.add(current);
      if (current.matches(internalSurfaceSelector)) return true;
      const root = current.getRootNode();
      current = current.parentElement || (root instanceof ShadowRoot ? root.host : null);
    }
    return false;
  };
  const paintedElementsAt = (x, y) => {
    const result = [];
    const seen = new Set();
    const visit = (root, depth = 0) => {
      if (depth > 8 || typeof root.elementsFromPoint !== 'function') return;
      for (const element of root.elementsFromPoint(x, y)) {
        if (!(element instanceof Element) || seen.has(element) || isResponsiverSurface(element)) continue;
        if (element.shadowRoot) visit(element.shadowRoot, depth + 1);
        if (!seen.has(element)) { seen.add(element); result.push(element); }
      }
    };
    visit(document);
    return result;
  };
  const sampledThemeSurface = (declaredScheme) => {
    const width = Math.max(1, document.documentElement.clientWidth || innerWidth);
    const height = Math.max(1, document.documentElement.clientHeight || innerHeight);
    const exclusiveDark = /dark/i.test(declaredScheme) && !/light/i.test(declaredScheme);
    const fallback = exclusiveDark
      ? { red: 18, green: 18, blue: 18, alpha: 1 }
      : { red: 255, green: 255, blue: 255, alpha: 1 };
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const rootLayer = colorChannels(rootStyle.backgroundColor);
    const rootImage = rootStyle.backgroundImage !== 'none';
    const bodyLayer = bodyStyle ? colorChannels(bodyStyle.backgroundColor) : null;
    const bodyImage = Boolean(bodyStyle && bodyStyle.backgroundImage !== 'none');
    const bodyPropagates = !rootImage && (!rootLayer || rootLayer.alpha <= .01);
    let canvasColor = { ...fallback };
    let canvasUnresolved = false;
    if (bodyPropagates) {
      if (bodyLayer && bodyLayer.alpha > .01) canvasColor = compositeColor(bodyLayer, canvasColor);
      canvasUnresolved = bodyImage;
    } else {
      if (rootLayer && rootLayer.alpha > .01) canvasColor = compositeColor(rootLayer, canvasColor);
      canvasUnresolved = rootImage;
    }
    const samples = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const x = Math.min(width - 1, Math.max(0, (column + .5) * width / 5));
        const y = Math.min(height - 1, Math.max(0, (row + .5) * height / 5));
        const elements = paintedElementsAt(x, y);
        let color = { ...canvasColor };
        let unresolved = canvasUnresolved;
        for (const element of [...elements].reverse()) {
          if (!(element instanceof Element) || isResponsiverSurface(element) || element === document.documentElement || (bodyPropagates && element === document.body)) continue;
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= .01) continue;
          const layer = colorChannels(style.backgroundColor);
          const opacity = Math.max(0, Math.min(1, Number(style.opacity) || 1));
          const effectiveLayer = layer ? { ...layer, alpha: layer.alpha * opacity } : null;
          if (effectiveLayer && effectiveLayer.alpha >= .99) unresolved = false;
          if (effectiveLayer && effectiveLayer.alpha > .01) color = compositeColor(effectiveLayer, color);
          if (style.backgroundImage !== 'none') unresolved = true;
        }
        samples.push({ color, unresolved });
      }
    }
    const reliableSamples = samples.filter((sample) => !sample.unresolved);
    const values = reliableSamples.map((sample) => luminance('rgb(' + Math.round(sample.color.red) + ', ' + Math.round(sample.color.green) + ', ' + Math.round(sample.color.blue) + ')')).filter((value) => value !== null);
    const darkSamples = values.filter((value) => value < .42).length;
    const lightSamples = values.filter((value) => value > .58).length;
    const decisive = darkSamples + lightSamples;
    const reliableCoverage = reliableSamples.length / 25;
    const detected = reliableSamples.length >= 13 && decisive >= 13 && darkSamples >= Math.ceil(decisive * .56)
      ? 'dark'
      : reliableSamples.length >= 13 && decisive >= 13 && lightSamples >= Math.ceil(decisive * .56)
        ? 'light'
        : 'unknown';
    const matching = reliableSamples.map((sample) => sample.color).filter((sample) => {
      const value = luminance('rgb(' + Math.round(sample.red) + ', ' + Math.round(sample.green) + ', ' + Math.round(sample.blue) + ')');
      return detected === 'dark' ? value !== null && value < .42 : detected === 'light' ? value !== null && value > .58 : value !== null;
    });
    const representative = matching.length ? matching.reduce((result, sample) => ({
      red: result.red + sample.red / matching.length,
      green: result.green + sample.green / matching.length,
      blue: result.blue + sample.blue / matching.length
    }), { red: 0, green: 0, blue: 0 }) : { red: 255, green: 255, blue: 255 };
    return {
      detected,
      confidence: decisive ? Math.round(Math.abs(darkSamples - lightSamples) / decisive * reliableCoverage * 100) / 100 : 0,
      darkSamples,
      lightSamples,
      unresolvedSamples: samples.length - reliableSamples.length,
      background: 'rgb(' + Math.round(representative.red) + ', ' + Math.round(representative.green) + ', ' + Math.round(representative.blue) + ')'
    };
  };
  const themeState = () => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const declaredScheme = rootStyle.colorScheme || document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') || '';
    const sampled = sampledThemeSurface(declaredScheme);
    const declaresDark = /dark/i.test(declaredScheme);
    const declaresLight = /light/i.test(declaredScheme);
    const detected = sampled.detected === 'unknown'
      ? declaresDark && !declaresLight ? 'dark' : declaresLight && !declaresDark ? 'light' : 'unknown'
      : sampled.detected;
    return { ...sampled, color: bodyStyle?.color ?? rootStyle.color, declaredScheme, detected };
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
    let rectangle = target.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(innerWidth, rectangle.right) - Math.max(0, rectangle.left));
    const visibleHeight = Math.max(0, Math.min(innerHeight, rectangle.bottom) - Math.max(0, rectangle.top));
    const visibleRatio = visibleWidth * visibleHeight / Math.max(1, rectangle.width * rectangle.height);
    if (visibleRatio < .75) {
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      rectangle = target.getBoundingClientRect();
    }
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
    'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self', 'justify-self', 'order',
    'grid-template-columns', 'grid-template-rows', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'text-align', 'white-space', 'color', 'background-color', 'border-top-width', 'border-top-style', 'border-top-color',
    'border-radius', 'overflow-x', 'overflow-y', 'opacity', 'visibility', 'z-index', 'transform', 'translate'
  ]);
  let inspectorActive = false;
  let inspectorHovered = null;
  let inspectorSelected = null;
  let inspectorHoverOverlay = null;
  let inspectorSelectedOverlay = null;
  let inspectorFrame = 0;
  let interactionRevision = 0;
  const acceptInteractionRevision = (value) => {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 1) return true;
    if (revision < interactionRevision) return false;
    interactionRevision = revision;
    return true;
  };
  const inspectorClean = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
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
    element.hasAttribute('data-responsiver-visual-preview') || element.hasAttribute('data-responsiver-composer-active') ||
    element.hasAttribute('data-responsiver-composer-freeze');
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
    if (designActive) stopDesign('inspector');
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
  let designActive = false;
  let designPort = null;
  let designSessionId = '';
  let designRevision = 0;
  let designHost = null;
  let designRoot = null;
  let designBox = null;
  let designLabel = null;
  let designGuideX = null;
  let designGuideY = null;
  let designSelected = null;
  let designGesture = null;
  let designPaintFrame = 0;
  const designPendingGestures = new Map();
  const designSyncedRequests = new Set();
  let designVisualRequestId = '';
  let designFreezeStyle = null;
  const DESIGN_PROTOCOL = 1;
  const DESIGN_MAX_PAYLOAD_BYTES = 32768;
  const designClean = (value, limit) => inspectorClean(value, limit);
  const designMessage = (type, payload = {}) => {
    if (!designPort || !designSessionId) return false;
    const data = { protocol: DESIGN_PROTOCOL, sessionId: designSessionId, documentId, revision: designRevision, type, ...payload };
    try {
      if (nativeStringify(data).length > DESIGN_MAX_PAYLOAD_BYTES) {
        const rejected = { protocol: DESIGN_PROTOCOL, sessionId: designSessionId, documentId, revision: designRevision, type: 'design-rejected', reason: 'payload-too-large' };
        nativeApply(nativeMessagePortPostMessage, designPort, [rejected]);
        return false;
      }
      nativeApply(nativeMessagePortPostMessage, designPort, [data]);
      return true;
    } catch { return false; }
  };
  const designSyncPayload = (value) => {
    const requestId = designClean(value?.requestId, 80);
    const gestureIds = Array.isArray(value?.gestureIds)
      ? [...new Set(value.gestureIds.map((entry) => designClean(entry, 80)).filter(Boolean))].slice(0, 200)
      : [];
    return { requestId, gestureIds };
  };
  const latestDesignPendingGesture = (element) => {
    let latest = null;
    for (const pending of designPendingGestures.values()) {
      if (pending.element === element) latest = pending;
    }
    return latest;
  };
  const splitDesignCssComponents = (value) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character === '(') depth += 1;
      if (character === ')') depth = Math.max(0, depth - 1);
      if (/\\s/.test(character) && depth === 0) {
        const part = value.slice(start, index).trim();
        if (part) parts.push(part);
        while (index + 1 < value.length && /\\s/.test(value[index + 1])) index += 1;
        start = index + 1;
      }
    }
    const tail = value.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
  };
  const parseTranslateComponent = (value) => {
    const simple = value.match(/^(-?(?:\\d+\\.?\\d*|\\.\\d+))(px|%)$/i);
    if (simple) return simple[2] === '%' ? { percent: Number.parseFloat(simple[1]), pixels: 0 } : { percent: 0, pixels: Number.parseFloat(simple[1]) };
    const calculated = value.match(/^calc\\(\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+))%\\s*([+-])\\s*((?:\\d+\\.?\\d*|\\.\\d+))px\\s*\\)$/i);
    if (!calculated) return null;
    return { percent: Number.parseFloat(calculated[1]), pixels: Number.parseFloat(calculated[3]) * (calculated[2] === '-' ? -1 : 1) };
  };
  const parseTranslate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === 'none') return { x: { percent: 0, pixels: 0 }, y: { percent: 0, pixels: 0 } };
    const parts = splitDesignCssComponents(normalized);
    if (parts.length < 1 || parts.length > 2) return null;
    const x = parseTranslateComponent(parts[0]);
    const y = parseTranslateComponent(parts[1] || '0px');
    return x && y ? { x, y } : null;
  };
  const formatTranslateComponent = (axis, delta) => {
    const percent = Math.round(axis.percent * 1000) / 1000;
    const pixels = Math.round((axis.pixels + delta) * 1000) / 1000;
    if (!percent) return pixels + 'px';
    if (!pixels) return percent + '%';
    return 'calc(' + percent + '% ' + (pixels < 0 ? '- ' + Math.abs(pixels) : '+ ' + pixels) + 'px)';
  };
  const formatTranslate = (base, deltaX, deltaY) => {
    const x = formatTranslateComponent(base.x, deltaX);
    const y = formatTranslateComponent(base.y, deltaY);
    return x === '0px' && y === '0px' ? 'none' : x + ' ' + y;
  };
  const designSelectable = (element) => {
    if (!isInspectable(element) || parent !== top || /^(?:html|body|iframe|object|embed|option)$/.test(element.tagName.toLowerCase())) return false;
    if (element.closest('[contenteditable]')) return false;
    const rectangle = element.getBoundingClientRect();
    return rectangle.width >= 3 && rectangle.height >= 3 && rectangle.width <= 100000 && rectangle.height <= 100000;
  };
  const designTextual = (element) => {
    const tag = element.tagName.toLowerCase();
    if (/^(?:a|address|blockquote|button|caption|cite|code|dd|dt|figcaption|label|legend|li|p|pre|q|small|span|strong|em|h[1-6]|td|th)$/.test(tag)) return true;
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /\\S/.test(node.textContent || '')) return true;
    }
    return false;
  };
  const designMinimumTextHeight = (element, style) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const content = range.getBoundingClientRect();
    range.detach();
    const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((total, property) => total + (Number.parseFloat(style[property]) || 0), 0);
    const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.2;
    return Math.ceil(Math.max(content.height, lineHeight) + inset);
  };
  const nearbyDesignChildren = (parentElement, selectedElement, limit, includeSelected = false) => {
    if (!parentElement || !selectedElement || limit < 1) return [];
    const children = parentElement.children;
    let selectedIndex = -1;
    for (let index = 0; index < children.length; index += 1) {
      if (children[index] === selectedElement) { selectedIndex = index; break; }
    }
    if (selectedIndex < 0) return [];
    const radius = Math.max(limit, 4);
    const start = Math.max(0, selectedIndex - radius);
    const end = Math.min(children.length, selectedIndex + radius + 1);
    const result = [];
    for (let index = start; index < end && result.length < limit; index += 1) {
      const entry = children[index];
      if ((!includeSelected && entry === selectedElement) || !designSelectable(entry)) continue;
      result.push(entry);
    }
    return result;
  };
  const positionalDesignSelector = (element) => {
    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 16) {
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      if (current === document.body) {
        parts.unshift('body');
        break;
      }
      const parentElement = current.parentElement;
      if (!parentElement) break;
      const siblings = [...parentElement.children];
      const index = siblings.indexOf(current);
      parts.unshift(current.tagName.toLowerCase() + (index >= 0 ? ':nth-child(' + (index + 1) + ')' : ''));
      current = parentElement;
    }
    const selector = parts.join(' > ');
    if (!selector || selector.length > VISUAL_MAX_SELECTOR_LENGTH) return null;
    try { return document.querySelectorAll(selector).length === 1 ? selector : null; } catch { return null; }
  };
  const designSnapshot = (element, detailed = true) => {
    if (!designSelectable(element)) return null;
    let payload = inspectorPayload(element, true);
    if (!payload || payload.selector === '*' || payload.selector.includes(' >>> ')) return null;
    if (payload.occurrences !== 1) {
      const selector = positionalDesignSelector(element);
      if (!selector) return null;
      payload = { ...payload, selector, occurrences: 1 };
    }
    return { ...payload, route: designClean(location.pathname, VISUAL_MAX_ROUTE_LENGTH) || '/', styles: detailed ? payload.styles : { order: payload.styles.order || '0', translate: payload.styles.translate || 'none' }, text: '', role: null, ariaLabel: null, editable: true, insideFrame: false };
  };
  const preferredDesignTarget = (target, event) => {
    if (!(target instanceof Element)) return null;
    if (!event.altKey && designSelected?.isConnected && designSelected.contains(target)) return designSelected;
    if (!event.altKey) {
      const control = target.closest('button, a[href], [role="button"], [role="link"], input, select, textarea');
      if (control && designSelectable(control)) return control;
      const media = target.closest('img, video, canvas, svg');
      if (media && designSelectable(media)) return media;
    }
    return target;
  };
  const designTargetFromEvent = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.find((candidate) => candidate instanceof Element && designSelectable(candidate)) || null;
  };
  const createDesignOverlay = () => {
    if (designHost?.isConnected) return;
    designHost = document.createElement('div');
    designHost.setAttribute('data-responsiver-composer-active', '');
    for (const [name, value] of Object.entries({ all: 'initial', position: 'fixed', inset: '0', display: 'block', margin: '0', padding: '0', 'pointer-events': 'auto', 'z-index': '2147483647', contain: 'strict' })) {
      designHost.style.setProperty(name, value, 'important');
    }
    designRoot = nativeApply(nativeAttachShadow, designHost, [{ mode: 'open' }]);
    const style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;position:fixed;inset:0;display:block;pointer-events:auto;z-index:2147483647;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '#box{position:fixed;display:none;box-sizing:border-box;border:2px solid #bf5239;background:rgba(191,82,57,.055);box-shadow:0 0 0 1px rgba(255,255,255,.92),0 8px 26px rgba(39,34,29,.18);pointer-events:none}',
      '#box.pending{border-style:dashed;background:rgba(191,82,57,.11)}',
      '#label{position:absolute;left:-2px;top:-25px;max-width:260px;height:22px;box-sizing:border-box;padding:4px 7px;color:#fff;background:#2e302c;font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 10px rgba(0,0,0,.18)}',
      '.handle{position:absolute;width:12px;height:12px;box-sizing:border-box;border:2px solid #fff;border-radius:50%;background:#bf5239;box-shadow:0 0 0 1px #7f2f1e;pointer-events:auto;touch-action:none}',
      '.handle[data-edge=n]{left:50%;top:-7px;transform:translateX(-50%);cursor:ns-resize}.handle[data-edge=ne]{right:-7px;top:-7px;cursor:nesw-resize}.handle[data-edge=e]{right:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize}.handle[data-edge=se]{right:-7px;bottom:-7px;cursor:nwse-resize}',
      '.handle[data-edge=s]{left:50%;bottom:-7px;transform:translateX(-50%);cursor:ns-resize}.handle[data-edge=sw]{left:-7px;bottom:-7px;cursor:nesw-resize}.handle[data-edge=w]{left:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize}.handle[data-edge=nw]{left:-7px;top:-7px;cursor:nwse-resize}',
      '.guide{position:fixed;display:none;background:#2293a6;box-shadow:0 0 0 1px rgba(255,255,255,.7);pointer-events:none}.guide.x{top:0;bottom:0;width:1px}.guide.y{left:0;right:0;height:1px}'
    ].join('');
    designBox = document.createElement('div');
    designBox.id = 'box';
    designBox.setAttribute('data-responsiver-composer-overlay', '');
    designLabel = document.createElement('div');
    designLabel.id = 'label';
    designBox.append(designLabel);
    for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      const handle = document.createElement('span');
      handle.className = 'handle';
      handle.setAttribute('data-edge', edge);
      handle.setAttribute('data-responsiver-composer-handle', edge);
      handle.addEventListener('pointerdown', (event) => {
        designHost?.setAttribute('data-responsiver-composer-last-input', 'resize-' + edge);
        beginDesignGesture('resize', edge, event);
      }, true);
      designBox.append(handle);
    }
    designGuideX = document.createElement('div');
    designGuideX.className = 'guide x';
    designGuideY = document.createElement('div');
    designGuideY.className = 'guide y';
    designRoot.append(style, designBox, designGuideX, designGuideY);
    document.documentElement.append(designHost);
    designHost.addEventListener('pointerdown', (event) => {
      if (!designActive || designGesture || !event.isTrusted || event.button !== 0) return;
      const handle = typeof event.composedPath === 'function' && event.composedPath().find((entry) => entry instanceof Element && entry.hasAttribute('data-responsiver-composer-handle'));
      if (handle) return;
      designHost.setAttribute('data-responsiver-composer-last-input', 'move');
      designHost.style.setProperty('pointer-events', 'none', 'important');
      const target = document.elementFromPoint(event.clientX, event.clientY);
      designHost.style.setProperty('pointer-events', 'auto', 'important');
      event.preventDefault();
      event.stopImmediatePropagation();
      const preferredTarget = preferredDesignTarget(target, event);
      if (!preferredTarget || !selectDesignTarget(preferredTarget, true)) return;
      beginDesignGesture('move', '', event);
    }, true);
  };
  const clearDesignGuides = () => {
    designGuideX?.style.setProperty('display', 'none');
    designGuideY?.style.setProperty('display', 'none');
  };
  const paintDesignRect = (rectangle, pending = false) => {
    if (!designBox || !rectangle || rectangle.width <= 0 || rectangle.height <= 0) {
      designBox?.style.setProperty('display', 'none');
      return;
    }
    designBox.classList.toggle('pending', pending);
    designBox.style.setProperty('display', 'block');
    designBox.style.setProperty('left', inspectorRound(rectangle.left) + 'px');
    designBox.style.setProperty('top', inspectorRound(rectangle.top) + 'px');
    designBox.style.setProperty('width', inspectorRound(rectangle.width) + 'px');
    designBox.style.setProperty('height', inspectorRound(rectangle.height) + 'px');
    if (designLabel && designSelected) {
      const classes = [...designSelected.classList].slice(0, 2).map((name) => '.' + name).join('');
      designLabel.textContent = designSelected.tagName.toLowerCase() + classes + '  ' + Math.round(rectangle.width) + '×' + Math.round(rectangle.height);
    }
  };
  const repaintDesign = () => {
    designPaintFrame = 0;
    if (!designActive || !designSelected?.isConnected) {
      if (designSelected && !designSelected.isConnected) designMessage('design-invalidated', { reason: 'target-detached' });
      designSelected = null;
      paintDesignRect(null);
      return;
    }
    const selectedPending = latestDesignPendingGesture(designSelected);
    if (designGesture) paintDesignRect(designGesture.previewRect, false);
    else if (selectedPending) paintDesignRect(selectedPending.rect, true);
    else paintDesignRect(designSelected.getBoundingClientRect(), false);
  };
  const scheduleDesignPaint = () => {
    if (!designActive || designPaintFrame) return;
    designPaintFrame = requestAnimationFrame(repaintDesign);
  };
  const selectDesignTarget = (element, notify = true) => {
    const snapshot = designSnapshot(element);
    if (!snapshot) {
      designMessage('design-rejected', { reason: 'unstable-or-sensitive-target' });
      return false;
    }
    designSelected = element;
    scheduleDesignPaint();
    if (notify) designMessage('design-selection', { selection: snapshot });
    return true;
  };
  const selectDesignSelector = (value) => {
    if (!designActive || typeof value !== 'string' || !value.trim() || value.includes('>>>')) return;
    let target = null;
    try {
      const matches = document.querySelectorAll(value.trim().slice(0, VISUAL_MAX_SELECTOR_LENGTH));
      if (matches.length === 1) target = matches[0];
    } catch {}
    if (target) selectDesignTarget(target, true);
  };
  const finishDesignGesture = (cancelled = false) => {
    if (!designGesture) return;
    try { designGesture.capture?.releasePointerCapture?.(designGesture.pointerId); } catch {}
    designGesture = null;
    clearDesignGuides();
    scheduleDesignPaint();
  };
  const stopDesign = (reason = 'request') => {
    if (designPaintFrame) cancelAnimationFrame(designPaintFrame);
    designPaintFrame = 0;
    finishDesignGesture(true);
    designActive = false;
    designSelected = null;
    designHost?.remove();
    designFreezeStyle?.remove();
    designHost = null;
    designRoot = null;
    designBox = null;
    designLabel = null;
    designGuideX = null;
    designGuideY = null;
    designFreezeStyle = null;
    designMessage('design-stopped', { reason });
  };
  const startDesign = () => {
    stopInspector('composer');
    designActive = true;
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
    if (!designFreezeStyle) {
      designFreezeStyle = document.createElement('style');
      designFreezeStyle.setAttribute('data-responsiver-composer-freeze', '');
      designFreezeStyle.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important;-webkit-user-select:none!important;user-select:none!important}';
      (document.head || document.documentElement).append(designFreezeStyle);
    }
    createDesignOverlay();
    scheduleDesignPaint();
    designMessage('design-started', { route: designClean(location.pathname, VISUAL_MAX_ROUTE_LENGTH) || '/' });
  };
  const snapDesignAxis = (start, size, delta, targets) => {
    const anchors = [start + delta, start + delta + size / 2, start + delta + size];
    let best = { distance: 7, delta, guide: null };
    for (const target of targets) {
      for (const anchor of anchors) {
        const distance = target - anchor;
        if (Math.abs(distance) < Math.abs(best.distance)) best = { distance, delta: delta + distance, guide: target };
      }
    }
    return best;
  };
  const designSnapTargets = (element, parent, axis) => {
    const parentRect = parent?.getBoundingClientRect();
    const targets = parentRect ? axis === 'x'
      ? [parentRect.left, parentRect.left + parentRect.width / 2, parentRect.right]
      : [parentRect.top, parentRect.top + parentRect.height / 2, parentRect.bottom] : [];
    const siblings = nearbyDesignChildren(parent, element, 16);
    for (const sibling of siblings) {
      const rectangle = sibling.getBoundingClientRect();
      targets.push(...(axis === 'x' ? [rectangle.left, rectangle.left + rectangle.width / 2, rectangle.right] : [rectangle.top, rectangle.top + rectangle.height / 2, rectangle.bottom]));
    }
    return targets;
  };
  function beginDesignGesture(kind, edge, event) {
    if (!designActive || !designSelected || !event.isTrusted || event.button !== 0) return;
    const snapshot = designSnapshot(designSelected);
    if (!snapshot) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const actualRectangle = designSelected.getBoundingClientRect();
    const pendingRectangle = latestDesignPendingGesture(designSelected)?.rect;
    const rectangle = pendingRectangle || actualRectangle;
    const parentElement = designSelected.parentElement;
    const parentRect = parentElement?.getBoundingClientRect() || { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    const capture = event.currentTarget instanceof Element ? event.currentTarget : designSelected;
    try { capture.setPointerCapture(event.pointerId); } catch {}
    designGesture = {
      id: 'gesture-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
      kind,
      edge: edge || '',
      pointerId: event.pointerId,
      capture,
      startX: event.clientX,
      startY: event.clientY,
      actualStartRect: { left: actualRectangle.left, top: actualRectangle.top, right: actualRectangle.right, bottom: actualRectangle.bottom, width: actualRectangle.width, height: actualRectangle.height },
      startRect: { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
      previewRect: { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
      parentElement,
      parentRect,
      moved: false,
      snapshot
    };
    clearDesignGuides();
    scheduleDesignPaint();
  }
  const updateDesignGesture = (event) => {
    const gesture = designGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rawX = event.clientX - gesture.startX;
    const rawY = event.clientY - gesture.startY;
    gesture.moved = gesture.moved || Math.hypot(rawX, rawY) >= 2;
    const start = gesture.startRect;
    if (gesture.kind === 'move') {
      const visibleX = Math.min(24, start.width / 2);
      const visibleY = Math.min(24, start.height / 2);
      const minimumX = visibleX - start.right;
      const maximumX = innerWidth - visibleX - start.left;
      const minimumY = visibleY - start.bottom;
      const maximumY = innerHeight - visibleY - start.top;
      let deltaX = Math.min(maximumX, Math.max(minimumX, rawX));
      let deltaY = Math.min(maximumY, Math.max(minimumY, rawY));
      const snappedX = snapDesignAxis(start.left, start.width, deltaX, designSnapTargets(designSelected, gesture.parentElement, 'x'));
      const snappedY = snapDesignAxis(start.top, start.height, deltaY, designSnapTargets(designSelected, gesture.parentElement, 'y'));
      deltaX = snappedX.delta;
      deltaY = snappedY.delta;
      if (snappedX.guide !== null && designGuideX) { designGuideX.style.left = inspectorRound(snappedX.guide) + 'px'; designGuideX.style.display = 'block'; } else designGuideX?.style.setProperty('display', 'none');
      if (snappedY.guide !== null && designGuideY) { designGuideY.style.top = inspectorRound(snappedY.guide) + 'px'; designGuideY.style.display = 'block'; } else designGuideY?.style.setProperty('display', 'none');
      gesture.previewRect = { left: start.left + deltaX, top: start.top + deltaY, right: start.right + deltaX, bottom: start.bottom + deltaY, width: start.width, height: start.height };
    } else {
      const edge = gesture.edge;
      let left = edge.includes('w') ? Math.min(start.right - 24, start.left + rawX) : start.left;
      let right = edge.includes('e') ? Math.max(start.left + 24, start.right + rawX) : start.right;
      let top = edge.includes('n') ? Math.min(start.bottom - 24, start.top + rawY) : start.top;
      let bottom = edge.includes('s') ? Math.max(start.top + 24, start.bottom + rawY) : start.bottom;
      const tag = designSelected.tagName.toLowerCase();
      const replaced = /^(?:img|video|canvas|svg)$/.test(tag);
      const horizontal = edge.includes('e') || edge.includes('w');
      const vertical = edge.includes('n') || edge.includes('s');
      if (replaced && horizontal) {
        const ratio = start.width / Math.max(1, start.height);
        const height = (right - left) / ratio;
        if (edge.includes('n')) top = bottom - height; else bottom = top + height;
      } else if (replaced && vertical) {
        const ratio = start.width / Math.max(1, start.height);
        right = left + (bottom - top) * ratio;
      }
      gesture.previewRect = { left, top, right, bottom, width: right - left, height: bottom - top };
      clearDesignGuides();
    }
    scheduleDesignPaint();
  };
  const reorderDesignMutations = (gesture, event) => {
    const parentElement = gesture.parentElement;
    if (!parentElement) return null;
    const layout = getComputedStyle(parentElement).display;
    if (!/^(?:inline-)?(?:flex|grid)$/.test(layout)) return null;
    if (parentElement.children.length > 32) return null;
    const siblings = nearbyDesignChildren(parentElement, designSelected, 32, true).map((element, domIndex) => ({ element, domIndex, order: Number.parseInt(getComputedStyle(element).order, 10) || 0 }));
    siblings.sort((left, right) => left.order - right.order || left.domIndex - right.domIndex);
    const from = siblings.findIndex((entry) => entry.element === designSelected);
    if (from < 0 || siblings.length < 2) return null;
    const centers = siblings.map((entry) => { const rect = entry.element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
    let to = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < centers.length; index += 1) {
      const next = Math.hypot(event.clientX - centers[index].x, event.clientY - centers[index].y);
      if (next < distance) { distance = next; to = index; }
    }
    if (to === from) return null;
    const ordered = [...siblings];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const mutations = [];
    for (const [index, entry] of ordered.entries()) {
      const target = designSnapshot(entry.element, false);
      if (!target) return null;
      mutations.push({ target, property: 'order', before: String(entry.order), after: String(index) });
    }
    return { strategy: layout.includes('grid') ? 'grid-order' : 'flex-order', mutations };
  };
  const sendDesignCommit = (kind, strategy, mutations, gestureId, warning, pendingRect) => {
    if (!mutations.length) return false;
    if (!designMessage('design-commit', { gestureId, kind, strategy, mutations, warning })) return false;
    if (pendingRect && designSelected?.isConnected) {
      designPendingGestures.set(gestureId, { rect: pendingRect, gestureId, kind, properties: mutations.map((mutation) => mutation.property), element: designSelected });
      while (designPendingGestures.size > 200) designPendingGestures.delete(designPendingGestures.keys().next().value);
    }
    scheduleDesignPaint();
    return true;
  };
  const commitDesignGesture = (event) => {
    const gesture = designGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!gesture.moved || !designSelected?.isConnected) { finishDesignGesture(true); return; }
    const preview = gesture.previewRect;
    if (gesture.kind === 'move') {
      const reordered = event.shiftKey ? reorderDesignMutations(gesture, event) : null;
      if (reordered) {
        sendDesignCommit('reorder', reordered.strategy, reordered.mutations, gesture.id, 'visual-order-only', preview);
      } else {
        const computed = getComputedStyle(designSelected);
        const base = parseTranslate(computed.translate);
        if (!base) { designMessage('design-rejected', { reason: 'existing-complex-transform' }); finishDesignGesture(true); return; }
        const deltaX = Math.round(preview.left - gesture.actualStartRect.left);
        const deltaY = Math.round(preview.top - gesture.actualStartRect.top);
        const mutation = { target: gesture.snapshot, property: 'translate', before: computed.translate || 'none', after: formatTranslate(base, deltaX, deltaY) };
        sendDesignCommit('move', 'flow-translate', [mutation], gesture.id, 'flow-preserved', preview);
      }
    } else {
      const computed = getComputedStyle(designSelected);
      const base = parseTranslate(computed.translate);
      if (!base) { designMessage('design-rejected', { reason: 'existing-complex-transform' }); finishDesignGesture(true); return; }
      const tag = designSelected.tagName.toLowerCase();
      const replaced = /^(?:img|video|canvas|svg)$/.test(tag);
      const textual = designTextual(designSelected);
      const horizontal = gesture.edge.includes('e') || gesture.edge.includes('w');
      const vertical = gesture.edge.includes('n') || gesture.edge.includes('s');
      const parentStyle = designSelected.parentElement ? getComputedStyle(designSelected.parentElement) : null;
      const parentDisplay = parentStyle?.display || '';
      const flexParent = /^(?:inline-)?flex$/.test(parentDisplay);
      const flexColumn = flexParent && /^column/.test(parentStyle?.flexDirection || '');
      const nextWidth = Math.round(preview.width);
      const nextHeight = Math.round(preview.height);
      if (vertical && textual && !replaced && nextHeight < designMinimumTextHeight(designSelected, computed)) {
        designMessage('design-rejected', { reason: 'text-height-is-fluid', gestureId: gesture.id });
        finishDesignGesture(true);
        return;
      }
      const mutations = [{ target: gesture.snapshot, property: 'box-sizing', before: computed.boxSizing, after: 'border-box' }];
      if (computed.display === 'inline') mutations.push({ target: gesture.snapshot, property: 'display', before: computed.display, after: 'inline-block' });
      if (horizontal || (replaced && vertical)) {
        const minWidth = Number.parseFloat(computed.minWidth);
        const maxWidth = Number.parseFloat(computed.maxWidth);
        if (Number.isFinite(minWidth) && minWidth > nextWidth) mutations.push({ target: gesture.snapshot, property: 'min-width', before: computed.minWidth, after: '0' });
        if (computed.maxWidth !== 'none' && Number.isFinite(maxWidth) && maxWidth < nextWidth) mutations.push({ target: gesture.snapshot, property: 'max-width', before: computed.maxWidth, after: 'none' });
        mutations.push({ target: gesture.snapshot, property: 'width', before: computed.width, after: 'min(' + nextWidth + 'px, calc(100vw - 24px))' });
      }
      if (vertical) {
        const minHeight = Number.parseFloat(computed.minHeight);
        const maxHeight = Number.parseFloat(computed.maxHeight);
        if (computed.maxHeight !== 'none' && Number.isFinite(maxHeight) && maxHeight < nextHeight) mutations.push({ target: gesture.snapshot, property: 'max-height', before: computed.maxHeight, after: 'none' });
        if (textual && !replaced) {
          mutations.push({ target: gesture.snapshot, property: 'height', before: computed.height, after: 'auto' });
          mutations.push({ target: gesture.snapshot, property: 'min-height', before: computed.minHeight, after: nextHeight + 'px' });
        } else {
          if (Number.isFinite(minHeight) && minHeight > nextHeight) mutations.push({ target: gesture.snapshot, property: 'min-height', before: computed.minHeight, after: '0' });
          mutations.push({ target: gesture.snapshot, property: 'height', before: computed.height, after: replaced ? 'auto' : nextHeight + 'px' });
        }
      }
      const changesFlexMainSize = flexParent && (flexColumn ? vertical : horizontal || (replaced && vertical));
      if (changesFlexMainSize) {
        const flexBasis = flexColumn ? nextHeight + 'px' : 'min(' + nextWidth + 'px, calc(100vw - 24px))';
        mutations.push({ target: gesture.snapshot, property: 'flex-basis', before: computed.flexBasis, after: flexBasis });
        if (Number.parseFloat(computed.flexGrow) !== 0) mutations.push({ target: gesture.snapshot, property: 'flex-grow', before: computed.flexGrow, after: '0' });
        if (Number.parseFloat(computed.flexShrink) !== 0) mutations.push({ target: gesture.snapshot, property: 'flex-shrink', before: computed.flexShrink, after: '0' });
      }
      const shiftX = Math.round(preview.left - gesture.actualStartRect.left);
      const shiftY = Math.round(preview.top - gesture.actualStartRect.top);
      if (shiftX || shiftY) mutations.push({ target: gesture.snapshot, property: 'translate', before: computed.translate || 'none', after: formatTranslate(base, shiftX, shiftY) });
      sendDesignCommit('resize', 'responsive-size', mutations, gesture.id, replaced || textual ? undefined : 'fixed-height', preview);
    }
    finishDesignGesture(false);
  };
  const nudgeDesign = (event) => {
    if (!designActive || !designSelected || !/^Arrow/.test(event.key)) return false;
    const computed = getComputedStyle(designSelected);
    const rectangle = designSelected.getBoundingClientRect();
    const pendingRectangle = latestDesignPendingGesture(designSelected)?.rect || rectangle;
    const base = parseTranslate(computed.translate);
    const snapshot = designSnapshot(designSelected);
    if (!base || !snapshot) return false;
    const step = event.shiftKey ? 10 : 1;
    const deltaX = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const deltaY = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const pendingOffsetX = Math.round(pendingRectangle.left - rectangle.left);
    const pendingOffsetY = Math.round(pendingRectangle.top - rectangle.top);
    const after = formatTranslate(base, pendingOffsetX + deltaX, pendingOffsetY + deltaY);
    sendDesignCommit('nudge', 'flow-translate', [{ target: snapshot, property: 'translate', before: computed.translate || 'none', after }], 'gesture-key-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), 'flow-preserved', { left: pendingRectangle.left + deltaX, top: pendingRectangle.top + deltaY, right: pendingRectangle.right + deltaX, bottom: pendingRectangle.bottom + deltaY, width: pendingRectangle.width, height: pendingRectangle.height });
    return true;
  };
  addEventListener('message', (event) => {
    const data = readMessageEventData(event);
    const transferredPorts = readMessageEventPorts(event);
    if (!event.isTrusted || readMessageEventSource(event) !== parent || !data || data.channel !== channel || data.type !== 'design-connect' || data.protocol !== DESIGN_PROTOCOL || typeof data.sessionId !== 'string' || !transferredPorts?.[0]) return;
    nativeApply(nativeEventStopImmediatePropagation, event, []);
    if (designPort) nativeApply(nativeMessagePortClose, designPort, []);
    designPendingGestures.clear();
    designSyncedRequests.clear();
    designVisualRequestId = '';
    designPort = transferredPorts[0];
    designSessionId = designClean(data.sessionId, 80);
    designRevision = 0;
    nativeApply(nativeEventAddEventListener, designPort, ['message', (portEvent) => {
      const command = readMessageEventData(portEvent);
      if (!command || command.protocol !== DESIGN_PROTOCOL || command.sessionId !== designSessionId || !Number.isSafeInteger(command.revision) || command.revision < designRevision) return;
      designRevision = command.revision;
      if (command.type === 'design-start' && acceptInteractionRevision(command.interactionRevision)) startDesign();
      if (command.type === 'design-stop' && acceptInteractionRevision(command.interactionRevision)) stopDesign('request');
      if (command.type === 'design-select') selectDesignSelector(command.selector);
      if (command.type === 'design-discard') {
        const discarded = designSyncPayload(command);
        for (const gestureId of discarded.gestureIds) designPendingGestures.delete(gestureId);
        scheduleDesignPaint();
      }
      if (command.type === 'design-sync') {
        const sync = designSyncPayload(command);
        if (!sync.requestId || sync.requestId !== designVisualRequestId || designSyncedRequests.has(sync.requestId)) return;
        designSyncedRequests.add(sync.requestId);
        while (designSyncedRequests.size > 200) designSyncedRequests.delete(designSyncedRequests.values().next().value);
        const pending = sync.gestureIds.map((gestureId) => designPendingGestures.get(gestureId)).filter(Boolean);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (sync.requestId !== designVisualRequestId) return;
          for (const entry of pending) {
            if (designPendingGestures.get(entry.gestureId) !== entry) continue;
            if (!entry.element?.isConnected) {
              designMessage('design-rejected', { reason: 'target-detached', gestureId: entry.gestureId, requestId: sync.requestId });
              designPendingGestures.delete(entry.gestureId);
              continue;
            }
            const actual = entry.element.getBoundingClientRect();
            const expected = entry.rect;
            const changedWidth = entry.properties.some((property) => property === 'width' || property === 'min-width' || property === 'max-width' || property === 'flex-basis');
            const changedHeight = entry.properties.some((property) => property === 'height' || property === 'min-height' || property === 'max-height');
            const changedPosition = entry.kind !== 'resize' || entry.properties.includes('translate');
            const mismatch = changedPosition && (Math.abs(actual.left - expected.left) > 5 || Math.abs(actual.top - expected.top) > 5) ||
              (entry.kind !== 'resize' || changedWidth) && Math.abs(actual.width - expected.width) > 5 ||
              (entry.kind !== 'resize' || changedHeight) && Math.abs(actual.height - expected.height) > 5;
            designMessage(mismatch ? 'design-rejected' : 'design-verified', mismatch
              ? { reason: 'layout-still-constrained', gestureId: entry.gestureId, requestId: sync.requestId }
              : { gestureId: entry.gestureId, requestId: sync.requestId });
            designPendingGestures.delete(entry.gestureId);
          }
          scheduleDesignPaint();
        }));
      }
      if (command.type === 'design-cancel') finishDesignGesture(true);
    }]);
    nativeApply(nativeMessagePortStart, designPort, []);
    designMessage('design-ready', { route: designClean(location.pathname, VISUAL_MAX_ROUTE_LENGTH) || '/' });
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (!designActive || designGesture) return;
    const rawTarget = event.target instanceof Element ? event.target : null;
    if (rawTarget && isInspectorInternal(rawTarget)) return;
    const target = designTargetFromEvent(event);
    event.preventDefault();
    event.stopImmediatePropagation();
    const preferredTarget = preferredDesignTarget(target, event);
    if (!preferredTarget || !selectDesignTarget(preferredTarget, true)) return;
    beginDesignGesture('move', '', event);
  }, true);
  document.addEventListener('pointermove', updateDesignGesture, true);
  document.addEventListener('pointerup', commitDesignGesture, true);
  document.addEventListener('pointercancel', (event) => {
    if (!designGesture || event.pointerId !== designGesture.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finishDesignGesture(true);
  }, true);
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'dragstart', 'drag', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop', 'selectstart', 'beforeinput', 'input', 'change', 'submit', 'reset']) {
    document.addEventListener(type, (event) => {
      if (!designActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  addEventListener('scroll', scheduleDesignPaint, true);
  addEventListener('blur', () => { if (designGesture) finishDesignGesture(true); });
  const applyVisualStylePreview = (value, request) => {
    const sync = designSyncPayload(request);
    if (typeof value !== 'string') {
      message('visual-style-preview-result', { applied: false, reason: 'invalid-css', ...sync });
      return;
    }
    let byteLength = VISUAL_MAX_CSS_BYTES + 1;
    if (value.length <= VISUAL_MAX_CSS_BYTES) byteLength = new TextEncoder().encode(value).byteLength;
    if (byteLength > VISUAL_MAX_CSS_BYTES) {
      message('visual-style-preview-result', { applied: false, reason: 'css-too-large', maxBytes: VISUAL_MAX_CSS_BYTES, ...sync });
      return;
    }
    let style = document.querySelector('style[data-responsiver-visual-preview]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-responsiver-visual-preview', '');
      (document.head || document.documentElement).append(style);
    }
    style.textContent = value;
    designVisualRequestId = sync.requestId;
    requestAnimationFrame(() => { schedule(); scheduleInspectorHighlights(); scheduleDesignPaint(); });
    message('visual-style-preview-result', { applied: true, bytes: byteLength, ...sync });
  };
  const clearVisualStylePreview = (request) => {
    const sync = designSyncPayload(request);
    document.querySelector('style[data-responsiver-visual-preview]')?.remove();
    designVisualRequestId = sync.requestId;
    requestAnimationFrame(() => { schedule(); scheduleInspectorHighlights(); scheduleDesignPaint(); });
    message('visual-style-clear-result', { cleared: true, ...sync });
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
    if (data.type === 'inspector-start' && acceptInteractionRevision(data.interactionRevision)) startInspector();
    if (data.type === 'inspector-stop' && acceptInteractionRevision(data.interactionRevision)) stopInspector();
    if (data.type === 'visual-style-preview') applyVisualStylePreview(data.css, data);
    if (data.type === 'visual-style-clear') clearVisualStylePreview(data);
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
  addEventListener('resize', () => { schedule(); scheduleDesignPaint(); });
  addEventListener('load', scheduleDesignPaint, true);
  addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const inspectorShortcut = event.key === 'F12' || ((event.metaKey || event.ctrlKey) && event.altKey && key === 'i') || ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'c');
    if (inspectorShortcut) {
      event.preventDefault();
      event.stopImmediatePropagation();
      message('inspector-shortcut');
      return;
    }
    if (designActive && nudgeDesign(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key !== 'Escape') {
      if (designActive) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (designActive) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (designGesture) finishDesignGesture(true);
      else {
        designSelected = null;
        paintDesignRect(null);
        designMessage('design-selection-cleared');
      }
      return;
    }
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
      if (records.some((record) => !(record.target instanceof Element && isInspectorInternal(record.target)))) {
        schedule();
        scheduleDesignPaint();
      }
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
  addEventListener('pagehide', () => { stopDesign('navigation'); if (designPort) nativeApply(nativeMessagePortClose, designPort, []); designPort = null; }, { once: true });
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
