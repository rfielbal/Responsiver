import { promises as fs } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import postcss from 'postcss'

export type Severity = 'bloquant' | 'attention' | 'information'
export type Coverage = 'standard' | 'heuristique' | 'manuel'

export interface ProjectIssue {
  id: string
  title: string
  description: string
  severity: Severity
  coverage: Coverage
  viewport: string
  source?: {
    file: string
    line: number
  }
  rule: string
  proposal: string
}

export interface ProjectRoute {
  path: string
  label: string
}

export interface ThemeProfile {
  detected: 'dark' | 'light' | 'dual' | 'unknown'
  hasDark: boolean
  hasLight: boolean
}

export interface ProjectSnapshot {
  id: string
  name: string
  root: string
  kind: string
  files: number
  analyzedAt: string
  issues: ProjectIssue[]
  previewHtml: string | null
  previewOrigin: string | null
  entryPath: string | null
  routes: ProjectRoute[]
  theme: ThemeProfile
}

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.nuxt',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release'
])

const maxFiles = 1_500

async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = []

  async function visit(folder: string): Promise<void> {
    if (files.length >= maxFiles) return

    let entries
    try {
      entries = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(join(folder, entry.name))
        continue
      }
      if (entry.isFile()) files.push(join(folder, entry.name))
    }
  }

  await visit(root)
  return files
}

function makeIssue(issue: Omit<ProjectIssue, 'id'>, counter: number): ProjectIssue {
  return { ...issue, id: `rule-${counter}` }
}

function lineOf(declaration: { source?: { start?: { line?: number } } }): number {
  return declaration.source?.start?.line ?? 1
}

function isPixelValue(value: string): number | undefined {
  const match = value.match(/^\s*(\d+(?:\.\d+)?)px\s*$/)
  return match ? Number(match[1]) : undefined
}

function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;/gi, '')
    .replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none')
}

function sanitizeHtml(html: string, css: string): string {
  const withoutExecutableContent = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(src|href)\s*=\s*(["'])(?:https?:)?\/\/[^"']*\2/gi, (_match, attribute: string) => ` ${attribute}="#"`)

  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"
  const style = `<style>${sanitizeCss(css)}</style>`
  const safetyBanner = `<style>body::before{content:'Aperçu statique sécurisé';position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#101828;color:#ffffff;font:600 10px/1.3 system-ui;padding:5px 7px;border-radius:5px;opacity:.72}</style>`

  if (/<head\b[^>]*>/i.test(withoutExecutableContent)) {
    return withoutExecutableContent.replace(/<head\b[^>]*>/i, (head) => `${head}<meta http-equiv="Content-Security-Policy" content="${csp}">${style}${safetyBanner}`)
  }

  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">${style}${safetyBanner}</head><body>${withoutExecutableContent}</body></html>`
}

function luminanceOfHex(value: string): number | null {
  const source = value.replace('#', '')
  const normalized = source.length === 3
    ? source.split('').map((part) => `${part}${part}`).join('')
    : source.slice(0, 6)
  if (!/^[\da-f]{6}$/i.test(normalized)) return null
  const components = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = components.map((component) => component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function detectSurfaceColors(content: string): Pick<ThemeProfile, 'hasDark' | 'hasLight'> {
  const variableDeclaration = /--[\w-]*(?:bg|background|surface|panel)[\w-]*\s*:\s*(#[\da-f]{3,8})\b/gi
  const backgroundDeclaration = /background(?:-color)?\s*:\s*(#[\da-f]{3,8})\b/gi
  const variables = [...content.matchAll(variableDeclaration)]
  const declarations = variables.length > 0 ? variables : [...content.matchAll(backgroundDeclaration)]
  let hasDark = false
  let hasLight = false
  for (const match of declarations) {
    const luminance = luminanceOfHex(match[1])
    if (luminance === null) continue
    if (luminance < 0.2) hasDark = true
    if (luminance > 0.78) hasLight = true
  }
  return { hasDark, hasLight }
}

function detectTheme(content: string): ThemeProfile {
  const surfaces = detectSurfaceColors(content)
  const hasDark = surfaces.hasDark || /prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*dark|data-theme\s*=\s*["']dark/i.test(content)
  const hasLight = surfaces.hasLight || /prefers-color-scheme\s*:\s*light|color-scheme\s*:\s*light|data-theme\s*=\s*["']light/i.test(content)
  return { detected: hasDark && hasLight ? 'dual' : hasDark ? 'dark' : hasLight ? 'light' : 'unknown', hasDark, hasLight }
}

export async function analyzeProject(root: string): Promise<ProjectSnapshot> {
  const files = await listProjectFiles(root)
  const issues: ProjectIssue[] = []
  let counter = 1
  const htmlFiles = files.filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
  const cssFiles = files.filter((file) => ['.css', '.scss', '.sass', '.less'].includes(extname(file).toLowerCase()))
  const relativeFile = (file: string) => relative(root, file) || basename(file)
  const indexFile = htmlFiles.find((file) => relative(root, file) === 'index.html') ?? htmlFiles.find((file) => basename(file).toLowerCase() === 'index.html') ?? htmlFiles[0]
  const routes = htmlFiles
    .map((file) => ({ path: `/${relativeFile(file).replaceAll('\\', '/')}`, label: relativeFile(file).replaceAll('\\', '/') }))
    .sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)))
  const rootCssFiles = cssFiles.filter((file) => !relativeFile(file).includes('/'))
  const cssForPreview = (await Promise.all(rootCssFiles.filter((file) => extname(file) === '.css').map((file) => fs.readFile(file, 'utf8').catch(() => '')))).join('\n')
  const htmlForPreview = indexFile ? await fs.readFile(indexFile, 'utf8').catch(() => '') : ''
  const theme = detectTheme(`${htmlForPreview}\n${cssForPreview}`)

  if (indexFile) {
    const html = await fs.readFile(indexFile, 'utf8').catch(() => '')
    if (!/<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(html)) {
      issues.push(
        makeIssue(
          {
            title: 'Balise viewport absente',
            description: 'Le navigateur mobile peut conserver une largeur de mise en page de bureau.',
            severity: 'bloquant',
            coverage: 'standard',
            viewport: 'Tous les téléphones',
            source: { file: relativeFile(indexFile), line: 1 },
            rule: 'html.viewport-meta',
            proposal: 'Ajouter <meta name="viewport" content="width=device-width, initial-scale=1">.'
          },
          counter++
        )
      )
    }
  }

  const orderedCssFiles = [...cssFiles].sort((left, right) => {
    const leftIsRoot = !relativeFile(left).includes('/')
    const rightIsRoot = !relativeFile(right).includes('/')
    if (leftIsRoot !== rightIsRoot) return leftIsRoot ? -1 : 1
    return relativeFile(left).localeCompare(relativeFile(right))
  })
  for (const file of orderedCssFiles.slice(0, 120)) {
    const css = await fs.readFile(file, 'utf8').catch(() => '')
    if (!css) continue

    let rootNode
    try {
      rootNode = postcss.parse(css, { from: file })
    } catch {
      issues.push(
        makeIssue(
          {
            title: 'Feuille de style non analysable',
            description: 'Cette feuille contient une syntaxe que le moteur de règles ne peut pas interpréter de façon sûre.',
            severity: 'information',
            coverage: 'manuel',
            viewport: 'Non couvert',
            source: { file: relativeFile(file), line: 1 },
            rule: 'css.parse',
            proposal: 'Vérifier cette feuille manuellement avant toute correction automatique.'
          },
          counter++
        )
      )
      continue
    }

    rootNode.walkDecls((declaration) => {
      if (issues.length >= 18) return
      const value = isPixelValue(declaration.value)
      const source = { file: relativeFile(file), line: lineOf(declaration) }

      if (declaration.prop === 'min-width' && value && value > 480) {
        issues.push(
          makeIssue(
            {
              title: 'Largeur minimale rigide',
              description: `${declaration.value} peut provoquer un défilement horizontal sous 480 px.`,
              severity: 'attention',
              coverage: 'heuristique',
              viewport: '320–480 px',
              source,
              rule: 'css.min-width-mobile',
              proposal: 'Proposer min-width: 0 ou déplacer cette contrainte dans une media query adaptée.'
            },
            counter++
          )
        )
      }

      if (declaration.prop === 'width' && value && value > 640) {
        issues.push(
          makeIssue(
            {
              title: 'Largeur fixe élevée',
              description: `${declaration.value} mérite une vérification sur les écrans étroits.`,
              severity: 'attention',
              coverage: 'heuristique',
              viewport: '390 px',
              source,
              rule: 'css.fixed-width',
              proposal: 'Tester max-width: 100% puis valider la capture avant/après.'
            },
            counter++
          )
        )
      }

      if (declaration.prop === 'white-space' && declaration.value.includes('nowrap')) {
        issues.push(
          makeIssue(
            {
              title: 'Texte forcé sur une ligne',
              description: 'white-space: nowrap est souvent à l’origine d’un débordement de navigation ou de bouton.',
              severity: 'attention',
              coverage: 'heuristique',
              viewport: '320–390 px',
              source,
              rule: 'css.nowrap',
              proposal: 'Limiter cette règle à un breakpoint large ou autoriser le retour à la ligne.'
            },
            counter++
          )
        )
      }
    })
  }

  if (issues.length === 0) {
    issues.push(
      makeIssue(
        {
          title: 'Validation visuelle à exécuter',
          description: 'Aucune règle statique bloquante n’a été détectée. Le rendu doit encore être contrôlé sur plusieurs largeurs.',
          severity: 'information',
          coverage: 'manuel',
          viewport: 'Matrice de tests',
          rule: 'manual.visual-sweep',
          proposal: 'Lancer un balayage entre 320 px et 1440 px et inspecter les captures.'
        },
        counter++
      )
    )
  }

  return {
    id: `project-${Buffer.from(root).toString('base64url').slice(0, 12)}`,
    name: basename(root),
    root,
    kind: indexFile ? 'Projet web local' : 'Dossier sans page HTML détectée',
    files: files.length,
    analyzedAt: new Date().toISOString(),
    issues,
    previewHtml: null,
    previewOrigin: null,
    entryPath: indexFile ? `/${relativeFile(indexFile).replaceAll('\\', '/')}` : null,
    routes,
    theme
  }
}

export function createDemoProject(): ProjectSnapshot {
  return {
    id: 'demo-atlas',
    name: 'Atelier Atlas',
    root: 'Projet de démonstration local',
    kind: 'Démo statique',
    files: 28,
    analyzedAt: new Date().toISOString(),
    previewOrigin: null,
    entryPath: '/index.html',
    routes: [{ path: '/index.html', label: 'index.html' }],
    theme: { detected: 'light', hasDark: false, hasLight: true },
    previewHtml: `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{font-family:Inter,system-ui,sans-serif;color:#172033;background:#fff}*{box-sizing:border-box}body{margin:0}.top{display:flex;align-items:center;justify-content:space-between;padding:18px 7vw;border-bottom:1px solid #e8ebf2;font-size:14px}.brand{font-weight:800;letter-spacing:-.03em}.links{display:flex;gap:24px;color:#516078;white-space:nowrap}.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:center;padding:72px 7vw;background:linear-gradient(135deg,#f6f8ff,#fff)}h1{margin:0;font-size:clamp(34px,6vw,66px);line-height:.98;letter-spacing:-.06em}.hero p{color:#56637a;font-size:17px;line-height:1.55}.button{display:inline-block;margin-top:18px;background:#315cf5;color:white;padding:13px 18px;border-radius:9px;font-weight:700}.visual{min-height:250px;border:1px solid #d9e1f4;border-radius:18px;background:linear-gradient(145deg,#c9d6ff,#eef3ff);box-shadow:0 18px 45px #91a8df55}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:45px 7vw}.metric{padding:18px;border:1px solid #e7eaf1;border-radius:12px}.metric strong{display:block;font-size:24px}@media(max-width:640px){.links{display:none}.hero{grid-template-columns:1fr;padding:48px 24px}.visual{min-height:160px}.metrics{grid-template-columns:1fr;padding:24px}.top{padding:16px 24px}}</style></head><body><header class="top"><span class="brand">ATELIER ATLAS</span><nav class="links"><span>Solutions</span><span>Références</span><span>Contact</span></nav></header><main><section class="hero"><div><p>Architecture intérieure</p><h1>Des espaces qui racontent une histoire.</h1><p>Un projet de démonstration pour visualiser les tests de Responsiver sur une vraie mise en page HTML/CSS.</p><a class="button">Découvrir le studio</a></div><div class="visual"></div></section><section class="metrics"><article class="metric"><strong>18</strong>projets livrés</article><article class="metric"><strong>12 ans</strong>d'expertise</article><article class="metric"><strong>100 %</strong>sur mesure</article></section></main></body></html>`,
    issues: [
      {
        id: 'demo-navigation',
        title: 'Navigation à confirmer sur mobile',
        description: 'La navigation conserve white-space: nowrap. Le breakpoint prévu doit être vérifié dans la preview.',
        severity: 'attention',
        coverage: 'heuristique',
        viewport: '390 × 844',
        source: { file: 'index.html', line: 1 },
        rule: 'css.nowrap',
        proposal: 'Conserver l’effacement mobile ou autoriser le retour à la ligne selon le contenu réel.'
      },
      {
        id: 'demo-theme',
        title: 'Thème sombre non couvert',
        description: 'Aucune préférence de couleur ni variable sémantique n’a été trouvée.',
        severity: 'information',
        coverage: 'manuel',
        viewport: 'Clair / sombre',
        source: { file: 'styles/tokens.css', line: 1 },
        rule: 'theme.color-scheme',
        proposal: 'Créer une couche de variables CSS pour le mode sombre.'
      }
    ]
  }
}
