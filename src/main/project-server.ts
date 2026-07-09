import { createServer, type Server } from 'node:http'
import { promises as fs, createReadStream } from 'node:fs'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'

export interface ProjectServer {
  origin: string
  close: () => Promise<void>
}

const mimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.manifest': 'application/manifest+json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const previewCsp = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
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
  const message = (type, payload = {}) => parent.postMessage({ channel: 'responsiver-preview', type, ...payload }, '*');
  const state = () => {
    const body = document.body ? getComputedStyle(document.body) : null;
    const root = getComputedStyle(document.documentElement);
    const bodyBackground = body?.backgroundColor ?? '';
    const background = bodyBackground === 'transparent' || bodyBackground === 'rgba(0, 0, 0, 0)' ? root.backgroundColor : bodyBackground;
    message('state', { path: location.pathname + location.search + location.hash, background, color: body?.color ?? '', declaredScheme: root.colorScheme || document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') || '' });
  };
  const go = (value) => {
    const destination = new URL(value, location.href);
    if (destination.origin === location.origin) location.assign(destination.pathname + destination.search + destination.hash);
    else message('external-link', { url: destination.href });
  };
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== 'responsiver-preview') return;
    if (data.type === 'navigate') go(data.path);
    if (data.type === 'back') history.back();
    if (data.type === 'forward') history.forward();
    if (data.type === 'reload') location.reload();
  });
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState = (...args) => { pushState(...args); state(); };
  history.replaceState = (...args) => { replaceState(...args); state(); };
  window.addEventListener('popstate', state);
  window.addEventListener('hashchange', state);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!target || event.defaultPrevented) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    const destination = new URL(href, location.href);
    if (destination.origin !== location.origin) {
      event.preventDefault();
      message('external-link', { url: destination.href });
      return;
    }
    if (target.target === '_blank') { event.preventDefault(); go(destination.href); }
  }, true);
  const nativeOpen = window.open;
  window.open = (url, ...args) => {
    if (typeof url === 'string') { go(url); return window; }
    return nativeOpen(url, ...args);
  };
  addEventListener('load', () => setTimeout(state, 0));
  setTimeout(state, 0);
})();
</script>`

function injectBridge(html: string): string {
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${bridge}</body>`) : `${html}${bridge}`
}

function safePath(root: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname)
  const requested = decoded.endsWith('/') ? `${decoded}index.html` : decoded
  const candidate = resolve(root, `.${requested}`)
  const normalizedRoot = normalize(root.endsWith(sep) ? root : `${root}${sep}`)
  const pathFromRoot = relative(root, candidate)
  const isHiddenPath = pathFromRoot.split(sep).some((segment) => segment.startsWith('.') && segment !== '.well-known')
  return !isHiddenPath && (candidate === root || candidate.startsWith(normalizedRoot)) ? candidate : null
}

async function withinRoot(root: string, candidate: string): Promise<string | null> {
  const realCandidate = await fs.realpath(candidate).catch(() => null)
  if (!realCandidate) return null
  const normalizedRoot = normalize(root.endsWith(sep) ? root : `${root}${sep}`)
  return realCandidate === root || realCandidate.startsWith(normalizedRoot) ? realCandidate : null
}

async function resolveFile(root: string, pathname: string): Promise<string | null> {
  const candidate = safePath(root, pathname)
  if (!candidate) return null
  const stat = await fs.stat(candidate).catch(() => null)
  if (stat?.isFile()) return withinRoot(root, candidate)
  if (stat?.isDirectory()) {
    const index = join(candidate, 'index.html')
    if (await fs.stat(index).catch(() => null)) return withinRoot(root, index)
  }
  if (!extname(pathname)) {
    const fallback = join(root, 'index.html')
    if (await fs.stat(fallback).catch(() => null)) return withinRoot(root, fallback)
  }
  return null
}

export async function startProjectServer(root: string): Promise<ProjectServer> {
  const realRoot = await fs.realpath(root)
  let server: Server
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const file = await resolveFile(realRoot, url.pathname)
      if (!file) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Ressource locale introuvable.')
        return
      }

      const extension = extname(file).toLowerCase()
      const type = mimeTypes[extension]
      if (!type) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Type de ressource non autorisé dans la prévisualisation.')
        return
      }
      const headers = {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': previewCsp,
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff'
      }

      if (extension === '.html' || extension === '.htm') {
        const source = await fs.readFile(file, 'utf8')
        response.writeHead(200, headers)
        response.end(injectBridge(source))
        return
      }

      response.writeHead(200, headers)
      const stream = createReadStream(file)
      stream.once('error', () => response.destroy())
      stream.pipe(response)
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Erreur du serveur de prévisualisation local.')
    }
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Le port de prévisualisation local est indisponible.')

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
  }
}
