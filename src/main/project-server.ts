import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, normalize, posix, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'

export interface ProjectServerOptions {
  mode?: 'source' | 'staged'
  overrides?: ReadonlyMap<string, Buffer | string>
  injectedCss?: string
}

export interface ProjectServer {
  origin: string
  mode: 'source' | 'staged'
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

const bridge = `<script data-responsiver-bridge>
(() => {
  const channel = 'responsiver-preview';
  const message = (type, payload = {}) => parent.postMessage({ channel, type, ...payload }, '*');
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
  const audit = () => {
    const viewportWidth = document.documentElement.clientWidth || innerWidth;
    const viewportHeight = document.documentElement.clientHeight || innerHeight;
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const overflows = [];
    let overflowCount = 0;
    let inspected = 0;
    if (documentWidth > viewportWidth + 1) {
      for (const element of document.body?.querySelectorAll('*') || []) {
        inspected += 1;
        if (inspected > 5000) break;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.position === 'fixed' || style.visibility === 'hidden') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || (rect.left >= -1 && rect.right <= viewportWidth + 1)) continue;
        overflowCount += 1;
        if (overflows.length < 12) overflows.push({ selector: selectorFor(element), tag: element.tagName.toLowerCase(), label: (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) });
      }
    }
    const audit = { path: location.pathname + location.search + location.hash, viewportWidth, viewportHeight, documentWidth, overflowCount, overflows };
    message('audit', { ...audit, audit });
  };
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state(); audit(); }, 120);
  };
  const go = (value) => {
    try {
      const destination = new URL(value, location.href);
      if (destination.origin === location.origin) location.assign(destination.pathname + destination.search + destination.hash);
      else message('external-link', { url: destination.href });
    } catch { message('navigation-error', { value: String(value) }); }
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
  });
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState = (...args) => { pushState(...args); schedule(); };
  history.replaceState = (...args) => { replaceState(...args); schedule(); };
  addEventListener('popstate', schedule);
  addEventListener('hashchange', schedule);
  addEventListener('resize', schedule);
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
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'content', 'data-theme', 'data-color-scheme'], childList: true, subtree: true });
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  setTimeout(schedule, 0);
})();
</script>`

function normalizeOverrideKey(value: string): string | null {
  const key = posix.normalize(value.replaceAll('\\', '/').replace(/^\/+/, ''))
  return key === '..' || key.startsWith('../') || key.startsWith('.') && !key.startsWith('.responsiver/') ? null : key
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

function safeRelativePath(root: string, pathname: string): { absolutePath: string; relativePath: string } | null {
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
  const isHiddenPath = pathFromRoot.split(sep).some((segment) => segment.startsWith('.') && segment !== '.well-known' && segment !== '.responsiver')
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

async function directResource(root: string, overrides: ReadonlyMap<string, Buffer>, relativePath: string): Promise<ResolvedResource | null> {
  const override = overriddenResource(overrides, relativePath)
  if (override) return override
  const safe = safeRelativePath(root, `/${relativePath}`)
  if (!safe) return null
  const stat = await fs.stat(safe.absolutePath).catch(() => null)
  if (!stat?.isFile()) return null
  const absolutePath = await realFileWithinRoot(root, safe.absolutePath)
  return absolutePath ? { absolutePath, body: null, relativePath: safe.relativePath } : null
}

async function resolveResource(root: string, overrides: ReadonlyMap<string, Buffer>, pathname: string): Promise<ResolvedResource | null> {
  let requestedKey: string | null = null
  try {
    requestedKey = normalizeOverrideKey(decodeURIComponent(pathname))
  } catch {
    return null
  }
  if (requestedKey?.startsWith('.responsiver/') && !overrides.has(requestedKey)) return null
  const safe = safeRelativePath(root, pathname)
  if (!safe) return null
  let requested = safe.relativePath
  const stat = await fs.stat(safe.absolutePath).catch(() => null)
  if (!requested || stat?.isDirectory() || pathname.endsWith('/')) requested = posix.join(requested, 'index.html')
  const direct = await directResource(root, overrides, requested)
  if (direct) return direct

  if (!extname(pathname)) {
    let current = posix.dirname(requested)
    while (true) {
      const fallback = await directResource(root, overrides, posix.join(current === '.' ? '' : current, 'index.html'))
      if (fallback) return fallback
      if (current === '.') break
      current = posix.dirname(current)
    }
  }
  return null
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
      const url = new URL(request.url ?? '/', `http://${expectedHost}`)
      const resource = await resolveResource(realRoot, overrides, url.pathname)
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
