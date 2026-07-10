import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import postcss, { type Declaration, type Rule } from 'postcss'
import type {
  ProjectCapabilities,
  ProjectFix,
  ProjectIssue,
  ProjectRoute,
  ProjectSnapshot,
  ThemeDetection,
  ThemeProfile,
  ThemeVariable
} from '../shared/contracts'

export type {
  Coverage,
  ProjectCapabilities,
  ProjectFix,
  ProjectIssue,
  ProjectRoute,
  ProjectSnapshot,
  Severity,
  SourceLocation,
  ThemeDetection,
  ThemeMode,
  ThemeProfile,
  ThemeVariable
} from '../shared/contracts'

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'target',
  'vendor'
])

const MAX_FILES = 1_500
const MAX_ROUTES = 120
const MAX_STYLESHEETS = 240
const MAX_ISSUES = 320
const MAX_TEXT_BYTES = 2_000_000

interface FileInventory {
  files: string[]
  truncated: boolean
}

interface RouteContext {
  file: string
  relativeFile: string
  route: ProjectRoute
  html: string
  linkedStyles: string[]
}

interface StyleContext {
  file: string
  relativeFile: string
  css: string
  routePath?: string
  inline: boolean
}

interface ParsedColor {
  red: number
  green: number
  blue: number
}

interface CssAncestor {
  type: string
  name?: string
  params?: string
  parent?: CssAncestor
}

async function listProjectFiles(root: string): Promise<FileInventory> {
  const files: string[] = []
  let truncated = false

  async function visit(folder: string): Promise<void> {
    if (files.length >= MAX_FILES) {
      truncated = true
      return
    }

    let entries
    try {
      entries = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, 'fr'))
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(join(folder, entry.name))
        continue
      }
      if (entry.isFile()) files.push(join(folder, entry.name))
    }
  }

  await visit(root)
  return { files, truncated }
}

function isInsideRoot(root: string, file: string): boolean {
  return file === root || file.startsWith(`${root}${sep}`)
}

async function readTextFile(file: string, projectRoot?: string): Promise<string> {
  try {
    const realFile = await fs.realpath(file)
    if (projectRoot) {
      const realRoot = await fs.realpath(projectRoot)
      if (!isInsideRoot(realRoot, realFile)) return ''
    }
    const stats = await fs.stat(realFile)
    if (!stats.isFile() || stats.size > MAX_TEXT_BYTES) return ''
    return await fs.readFile(realFile, 'utf8')
  } catch {
    return ''
  }
}

function posixRelative(root: string, file: string): string {
  return (relative(root, file) || basename(file)).replaceAll('\\', '/')
}

function stableId(...parts: Array<string | number | undefined>): string {
  const digest = createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 16)
  return `issue-${digest}`
}

function makeIssue(issue: Omit<ProjectIssue, 'id'>): ProjectIssue {
  const source = issue.source
  return {
    ...issue,
    id: stableId(
      issue.rule,
      issue.routePath,
      source?.file,
      source?.line,
      issue.fix?.selector,
      issue.fix?.property,
      issue.fix?.before
    )
  }
}

function lineOf(declaration: { source?: { start?: { line?: number } } }): number {
  return declaration.source?.start?.line ?? 1
}

function isPixelValue(value: string): number | undefined {
  const match = value.match(/^\s*(\d+(?:\.\d+)?)px\s*$/i)
  return match ? Number(match[1]) : undefined
}

function selectorOf(declaration: Declaration): string | undefined {
  const parent = declaration.parent
  return parent?.type === 'rule' ? (parent as Rule).selector.trim() : undefined
}

function isInsideKeyframes(declaration: Declaration): boolean {
  let parent = declaration.parent as unknown as CssAncestor | undefined
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name ?? '')) return true
    parent = parent.parent
  }
  return false
}

function minimumMediaWidth(declaration: Declaration): number | null {
  let parent = declaration.parent as unknown as CssAncestor | undefined
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase() === 'media') {
      const params = parent.params ?? ''
      const matches = [...params.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)]
      if (matches.length > 0) return Math.max(...matches.map((match) => Number(match[1])))
    }
    parent = parent.parent
  }
  return null
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveLocalReference(root: string, fromFile: string, reference: string): string | null {
  const cleanReference = safeDecodeUri(reference.trim().split(/[?#]/, 1)[0])
  if (
    cleanReference.length === 0 ||
    cleanReference.startsWith('#') ||
    cleanReference.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(cleanReference)
  ) return null

  const absolute = cleanReference.startsWith('/')
    ? resolve(root, `.${cleanReference}`)
    : resolve(dirname(fromFile), cleanReference)
  const normalizedRoot = resolve(root)
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) return null
  return absolute
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const expression = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match: RegExpExecArray | null
  while ((match = expression.exec(tag)) !== null) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function linkedStylesheets(root: string, htmlFile: string, html: string): string[] {
  const styles = new Set<string>()
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesOf(match[0])
    const relValue = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? []
    if (!relValue.includes('stylesheet')) continue
    const href = attributes.get('href')
    if (!href) continue
    const resolved = resolveLocalReference(root, htmlFile, href)
    if (resolved && extname(resolved).toLowerCase() === '.css') styles.add(resolved)
  }
  return [...styles]
}

function blockedExternalResources(html: string): Array<{ url: string; line: number }> {
  const resources: Array<{ url: string; line: number }> = []
  const allowedHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])
  const expression = /<(link|script)\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = expression.exec(html)) !== null) {
    const tagName = match[1].toLowerCase()
    const attributes = attributesOf(match[0])
    if (tagName === 'link') {
      const rel = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? []
      const loadsResource = rel.some((value) => ['stylesheet', 'icon', 'manifest', 'preload', 'modulepreload', 'preconnect', 'dns-prefetch'].includes(value))
      if (!loadsResource) continue
    }
    const reference = attributes.get(tagName === 'script' ? 'src' : 'href')
    if (!reference || !/^(?:https?:)?\/\//i.test(reference)) continue
    try {
      const url = new URL(reference.startsWith('//') ? `https:${reference}` : reference)
      if (allowedHosts.has(url.hostname.toLowerCase())) continue
      resources.push({ url: reference, line: html.slice(0, match.index).split('\n').length })
    } catch {
      // Une URL externe mal formée sera simplement ignorée par le navigateur local.
    }
  }
  return resources
}

function importedStylesheets(root: string, cssFile: string, css: string): string[] {
  const imports = new Set<string>()
  const expression = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s)'";]+))/gi
  for (const match of css.matchAll(expression)) {
    const reference = match[1] ?? match[2] ?? match[3]
    if (!reference) continue
    const resolved = resolveLocalReference(root, cssFile, reference)
    if (resolved && extname(resolved).toLowerCase() === '.css') imports.add(resolved)
  }
  return [...imports]
}

function extractTitle(html: string, fallback: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return title || fallback
}

function entryScore(root: string, file: string): number {
  const path = posixRelative(root, file).toLowerCase()
  let score = 0
  if (path === 'index.html' || path === 'index.htm') score += 10_000
  if (path === 'public/index.html' || path === 'public/index.htm') score += 7_000
  if (basename(path) === 'index.html' || basename(path) === 'index.htm') score += 1_000
  if (/(^|\/)(demo|demos|example|examples|fixture|fixtures|test|tests)(\/|$)/.test(path)) score -= 4_000
  if (/(^|\/)(docs?|storybook)(\/|$)/.test(path)) score -= 2_000
  score -= path.split('/').length * 10
  return score
}

function roleOfVariable(name: string): ThemeVariable['role'] {
  const normalized = name.toLowerCase()
  if (/(?:^|[-_])(shadow|radius|spacing|duration|font|size|width|height|z)(?:$|[-_])/.test(normalized)) return 'unknown'
  if (/(?:^|[-_])(bg|background|canvas|page|paper|base)(?:$|[-_])/.test(normalized)) return 'background'
  if (/(?:^|[-_])(surface|panel|card|elevated|popover)(?:$|[-_])/.test(normalized)) return 'surface'
  if (/(?:^|[-_])(muted|subtle|secondary|tertiary|disabled)(?:$|[-_])/.test(normalized)) return 'muted'
  if (/(?:^|[-_])(text|fg|foreground|ink)(?:$|[-_])/.test(normalized)) return 'text'
  if (/(?:^|[-_])(border|line|outline|stroke|divider)(?:$|[-_])/.test(normalized)) return 'border'
  if (/(?:^|[-_])(accent|brand|primary|action|link)(?:$|[-_])/.test(normalized)) return 'accent'
  if (/(?:^|[-_])(acid|blue|bleu|coral|corail|cyan|gold|jaune|orange|pink|rose|red|rouge|violet|purple|vert|green)(?:$|[-_])/.test(normalized)) return 'accent'
  if (/(?:^|[-_])(gray|grey|gris|soft)(?:$|[-_])/.test(normalized)) return 'muted'
  return 'unknown'
}

function isScreenReaderOnlyDeclaration(declaration: Declaration, selector?: string): boolean {
  if (selector && /(?:sr-only|screen-reader|visually-hidden|a11y-hidden)/i.test(selector)) return true
  const parent = declaration.parent
  if (parent?.type !== 'rule') return false
  const declarations = new Map<string, string>()
  ;(parent as Rule).walkDecls((candidate) => {
    declarations.set(candidate.prop.toLowerCase(), candidate.value.trim().toLowerCase())
  })
  const clipped = declarations.has('clip') || declarations.has('clip-path')
  const tiny = ['width', 'height'].some((property) => /^1px$/.test(declarations.get(property) ?? ''))
  return clipped && tiny && declarations.get('position') === 'absolute'
}

function isIntentionalAnimatedNoWrap(declaration: Declaration, selector?: string): boolean {
  const parent = declaration.parent
  if (parent?.type !== 'rule') return false
  const declarations = new Map<string, string>()
  ;(parent as Rule).walkDecls((candidate) => {
    declarations.set(candidate.prop.toLowerCase(), candidate.value.trim().toLowerCase())
  })
  const animated = declarations.has('animation') || declarations.has('animation-name')
  const intrinsicTrack = /(?:max-content|fit-content)/.test(declarations.get('width') ?? '')
  const trackSelector = /(?:marquee|ticker|carousel|slider|scroller|\.track(?:\b|[.:#]))/i.test(selector ?? '')
  return animated && (intrinsicTrack || trackSelector)
}

function parseColor(value: string): ParsedColor | null {
  const hex = value.match(/#([\da-f]{3,8})\b/i)?.[1]
  if (hex) {
    const normalized = hex.length === 3 || hex.length === 4
      ? hex.slice(0, 3).split('').map((part) => `${part}${part}`).join('')
      : hex.slice(0, 6)
    if (/^[\da-f]{6}$/i.test(normalized)) {
      return {
        red: Number.parseInt(normalized.slice(0, 2), 16),
        green: Number.parseInt(normalized.slice(2, 4), 16),
        blue: Number.parseInt(normalized.slice(4, 6), 16)
      }
    }
  }

  const rgb = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i)
  if (!rgb) return null
  return {
    red: Math.min(255, Number(rgb[1])),
    green: Math.min(255, Number(rgb[2])),
    blue: Math.min(255, Number(rgb[3]))
  }
}

function luminanceOfColor(color: ParsedColor): number {
  const components = [color.red, color.green, color.blue].map((component) => component / 255)
  const [red, green, blue] = components.map((component) => component <= 0.03928
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function collectThemeVariables(content: string): ThemeVariable[] {
  const variables = new Map<string, ThemeVariable>()
  for (const match of content.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)) {
    const name = match[1]
    const value = match[2].trim()
    const role = roleOfVariable(name)
    if (role !== 'unknown' || parseColor(value)) variables.set(name, { name, value, role })
  }
  return [...variables.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function detectTheme(content: string): ThemeProfile {
  const evidence: string[] = []
  const variables = collectThemeVariables(content)
  const values = new Map(variables.map((variable) => [variable.name, variable.value]))
  const explicitDark = /prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*(?:only\s+)?dark\b|(?:data-theme|data-color-scheme)\s*=\s*["']dark|(?:^|[\s.{])\.dark(?:[\s:{.#]|$)/im.test(content)
  const explicitLight = /prefers-color-scheme\s*:\s*light|color-scheme\s*:\s*(?:only\s+)?light\b|(?:data-theme|data-color-scheme)\s*=\s*["']light|(?:^|[\s.{])\.light(?:[\s:{.#]|$)/im.test(content)
  const supportsBoth = /color-scheme\s*:\s*(?:light\s+dark|dark\s+light)/i.test(content)
  let hasDark = explicitDark || supportsBoth
  let hasLight = explicitLight || supportsBoth

  if (explicitDark || supportsBoth) evidence.push('Déclaration explicite d’un thème sombre')
  if (explicitLight || supportsBoth) evidence.push('Déclaration explicite d’un thème clair')

  const semanticSurfaceExpressions = [...content.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)]
    .filter((match) => {
      const role = roleOfVariable(match[1])
      return role === 'background' || role === 'surface'
    })
    .map((match) => match[2].trim())
  const rootSurfaceExpressions: string[] = []
  if (semanticSurfaceExpressions.length === 0) {
    for (const block of content.matchAll(/(?:^|[}\s,])(?:html|body|:root)(?:[\s.#:[>,+~][^{]*)?\{([^}]*)\}/gim)) {
      for (const declaration of block[1].matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gim)) {
        rootSurfaceExpressions.push(declaration[1].trim())
      }
    }
    for (const body of content.matchAll(/<body\b[^>]*\bstyle\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
      for (const declaration of body[1].matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gim)) {
        rootSurfaceExpressions.push(declaration[1].trim())
      }
    }
  }
  const surfaceExpressions = semanticSurfaceExpressions.length > 0
    ? semanticSurfaceExpressions
    : rootSurfaceExpressions
  let darkSurfaces = 0
  let lightSurfaces = 0
  for (const expression of surfaceExpressions) {
    const variableReference = expression.match(/var\(\s*(--[\w-]+)/)?.[1]
    const color = parseColor(variableReference ? values.get(variableReference) ?? '' : expression)
    if (!color) continue
    const luminance = luminanceOfColor(color)
    if (luminance < 0.22) darkSurfaces += 1
    if (luminance > 0.72) lightSurfaces += 1
  }
  if (darkSurfaces > 0) {
    hasDark = true
    evidence.push(`${darkSurfaces} surface${darkSurfaces > 1 ? 's' : ''} sombre${darkSurfaces > 1 ? 's' : ''} détectée${darkSurfaces > 1 ? 's' : ''}`)
  }
  if (lightSurfaces > 0) {
    hasLight = true
    evidence.push(`${lightSurfaces} surface${lightSurfaces > 1 ? 's' : ''} claire${lightSurfaces > 1 ? 's' : ''} détectée${lightSurfaces > 1 ? 's' : ''}`)
  }

  const detected: ThemeDetection = hasDark && hasLight ? 'dual' : hasDark ? 'dark' : hasLight ? 'light' : 'unknown'
  if (detected === 'unknown') evidence.push('Aucune surface sémantique fiable ne permet de conclure')
  return { detected, hasDark, hasLight, evidence: [...new Set(evidence)].slice(0, 8), variables }
}

async function detectCapabilities(root: string, files: string[], hasHtml: boolean): Promise<ProjectCapabilities> {
  const relativeFiles = new Set(files.map((file) => posixRelative(root, file).toLowerCase()))
  const packageFile = files.find((file) => posixRelative(root, file).toLowerCase() === 'package.json')
  let framework: string | null = null
  let hasBuildScript = false
  if (packageFile) {
    try {
      const packageJson = JSON.parse(await readTextFile(packageFile, root)) as {
        scripts?: Record<string, string>
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const dependencies = { ...packageJson.devDependencies, ...packageJson.dependencies }
      const frameworks: Array<[string, string]> = [
        ['next', 'Next.js'],
        ['nuxt', 'Nuxt'],
        ['@angular/core', 'Angular'],
        ['astro', 'Astro'],
        ['gatsby', 'Gatsby'],
        ['@sveltejs/kit', 'SvelteKit'],
        ['svelte', 'Svelte'],
        ['vue', 'Vue'],
        ['react', 'React'],
        ['vite', 'Vite']
      ]
      framework = frameworks.find(([dependency]) => dependency in dependencies)?.[1] ?? null
      hasBuildScript = typeof packageJson.scripts?.build === 'string'
    } catch {
      // Un package.json invalide ne doit pas empêcher l’analyse du HTML/CSS.
    }
  }

  let packageManager: string | null = null
  if (relativeFiles.has('pnpm-lock.yaml')) packageManager = 'pnpm'
  else if (relativeFiles.has('yarn.lock')) packageManager = 'Yarn'
  else if (relativeFiles.has('bun.lock') || relativeFiles.has('bun.lockb')) packageManager = 'Bun'
  else if (relativeFiles.has('package-lock.json')) packageManager = 'npm'
  else if (relativeFiles.has('composer.lock')) packageManager = 'Composer'

  const sourceRequiresCompilation = files.some((file) => ['.tsx', '.jsx', '.vue', '.svelte'].includes(extname(file).toLowerCase()))
  return {
    interactive: hasHtml,
    staging: hasHtml || files.some((file) => extname(file).toLowerCase() === '.css'),
    framework,
    packageManager,
    buildRequired: !hasHtml || (hasBuildScript && sourceRequiresCompilation)
  }
}

async function expandLinkedStyles(root: string, initialFiles: string[], cssCache: Map<string, string>): Promise<string[]> {
  const queue = [...initialFiles]
  const expanded = new Set<string>()
  while (queue.length > 0 && expanded.size < MAX_STYLESHEETS) {
    const file = queue.shift()
    if (!file || expanded.has(file)) continue
    expanded.add(file)
    const css = cssCache.get(file) ?? await readTextFile(file, root)
    cssCache.set(file, css)
    for (const imported of importedStylesheets(root, file, css)) if (!expanded.has(imported)) queue.push(imported)
  }
  return [...expanded]
}

function analyzeStylesheet(style: StyleContext): ProjectIssue[] {
  const issues: ProjectIssue[] = []
  let rootNode
  try {
    rootNode = postcss.parse(style.css, { from: style.inline ? undefined : style.file })
  } catch {
    return [makeIssue({
      title: 'Feuille de style non analysable',
      description: 'La syntaxe ne peut pas être interprétée de façon sûre par le moteur CSS local.',
      severity: 'information',
      coverage: 'manuel',
      viewport: 'Non couvert',
      routePath: style.routePath,
      source: { file: style.relativeFile, line: 1 },
      rule: 'css.parse',
      proposal: 'Vérifier cette feuille manuellement ; aucune modification automatique ne sera tentée.',
      fix: { kind: 'manual', file: style.relativeFile, confidence: 'review' }
    })]
  }

  rootNode.walkDecls((declaration) => {
    if (issues.length >= MAX_ISSUES || isInsideKeyframes(declaration)) return
    const property = declaration.prop.toLowerCase()
    const pixelValue = isPixelValue(declaration.value)
    const selector = selectorOf(declaration)
    const source = { file: style.relativeFile, line: lineOf(declaration) }
    const desktopOnlyWidth = minimumMediaWidth(declaration)
    const isDesktopOnly = desktopOnlyWidth !== null && desktopOnlyWidth >= 641

    if (property === 'min-width' && pixelValue && pixelValue > 480 && !isDesktopOnly) {
      issues.push(makeIssue({
        title: 'Largeur minimale rigide',
        description: `${declaration.value} peut imposer un document plus large que l’écran sous 480 px.`,
        severity: 'attention',
        coverage: 'heuristique',
        viewport: '320–480 px',
        routePath: style.routePath,
        source,
        rule: 'css.min-width-mobile',
        proposal: 'Autoriser le composant à rétrécir sous 640 px, tout en conservant la contrainte sur bureau.',
        fix: selector ? {
          kind: 'css-media-override',
          file: style.relativeFile,
          confidence: 'review',
          selector,
          property: declaration.prop,
          before: declaration.value,
          after: '0',
          breakpoint: 640
        } : { kind: 'manual', file: style.relativeFile, confidence: 'review' }
      }))
    }

    if (property === 'width' && pixelValue && pixelValue > 640 && !isDesktopOnly) {
      const after = `min(100%, ${declaration.value.trim()})`
      issues.push(makeIssue({
        title: 'Largeur fixe élevée',
        description: `${declaration.value} dépasse les viewports de téléphone et peut créer un débordement horizontal.`,
        severity: 'attention',
        coverage: 'heuristique',
        viewport: '320–640 px',
        routePath: style.routePath,
        source,
        rule: 'css.fixed-width',
        proposal: `Conserver la limite haute tout en autorisant width: ${after}.`,
        fix: selector ? {
          kind: 'css-replace',
          file: style.relativeFile,
          confidence: 'review',
          selector,
          property: declaration.prop,
          before: declaration.value,
          after
        } : { kind: 'manual', file: style.relativeFile, confidence: 'review' }
      }))
    }

    if (
      property === 'white-space' &&
      /(?:^|\s)nowrap(?:\s|$)/i.test(declaration.value) &&
      !isDesktopOnly &&
      !isScreenReaderOnlyDeclaration(declaration, selector) &&
      !isIntentionalAnimatedNoWrap(declaration, selector)
    ) {
      const fix: ProjectFix = selector ? {
        kind: 'css-media-override',
        file: style.relativeFile,
        confidence: 'review',
        selector,
        property: declaration.prop,
        before: declaration.value,
        after: 'normal',
        breakpoint: 640
      } : { kind: 'manual', file: style.relativeFile, confidence: 'review' }
      issues.push(makeIssue({
        title: 'Texte forcé sur une ligne',
        description: 'white-space: nowrap peut faire déborder une navigation, un bouton ou un libellé sur petit écran.',
        severity: 'attention',
        coverage: 'heuristique',
        viewport: '320–640 px',
        routePath: style.routePath,
        source,
        rule: 'css.nowrap',
        proposal: 'Autoriser le retour à la ligne sous 640 px sans modifier le comportement de bureau.',
        fix
      }))
    }
  })

  return issues
}

export async function analyzeProject(root: string): Promise<ProjectSnapshot> {
  const normalizedRoot = await fs.realpath(root).catch(() => resolve(root))
  const inventory = await listProjectFiles(normalizedRoot)
  const files = inventory.files
  const htmlFiles = files
    .filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
    .sort((left, right) => entryScore(normalizedRoot, right) - entryScore(normalizedRoot, left))
  const cssFiles = files.filter((file) => extname(file).toLowerCase() === '.css')
  const preprocessorFiles = files.filter((file) => ['.scss', '.sass', '.less'].includes(extname(file).toLowerCase()))
  const entryFile = htmlFiles[0]
  const routeContexts: RouteContext[] = []
  const cssCache = new Map<string, string>()
  let truncated = inventory.truncated || htmlFiles.length > MAX_ROUTES || cssFiles.length > MAX_STYLESHEETS

  for (const file of htmlFiles.slice(0, MAX_ROUTES)) {
    const relativeFile = posixRelative(normalizedRoot, file)
    const html = await readTextFile(file, normalizedRoot)
    const routePath = `/${relativeFile}`
    routeContexts.push({
      file,
      relativeFile,
      html,
      linkedStyles: await expandLinkedStyles(normalizedRoot, linkedStylesheets(normalizedRoot, file, html), cssCache),
      route: { path: routePath, label: relativeFile, title: extractTitle(html, basename(relativeFile)) }
    })
  }

  const issues: ProjectIssue[] = []
  const themeProfiles: ThemeProfile[] = []
  const linkedCssFiles = new Set<string>()
  let scannedStyles = 0

  for (const routeContext of routeContexts) {
    if (issues.length >= MAX_ISSUES) {
      truncated = true
      break
    }
    const { route, html, relativeFile } = routeContext
    const viewportMatch = /<meta\s+[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html)
    if (!viewportMatch) {
      issues.push(makeIssue({
        title: 'Balise viewport absente',
        description: 'Le navigateur mobile risque de conserver une largeur de mise en page de bureau.',
        severity: 'bloquant',
        coverage: 'standard',
        viewport: 'Tous les téléphones',
        routePath: route.path,
        source: { file: relativeFile, line: 1 },
        rule: 'html.viewport-meta',
        proposal: 'Insérer la balise viewport standard dans le <head>.',
        fix: {
          kind: 'html-insert',
          file: relativeFile,
          confidence: 'safe',
          before: '<head>',
          after: '<meta name="viewport" content="width=device-width, initial-scale=1">'
        }
      }))
    }

    const externalResources = blockedExternalResources(html)
    if (externalResources.length > 0 && issues.length < MAX_ISSUES) {
      const origins = [...new Set(externalResources.map((resource) => {
        try {
          return new URL(resource.url.startsWith('//') ? `https:${resource.url}` : resource.url).hostname
        } catch {
          return resource.url
        }
      }))]
      issues.push(makeIssue({
        title: 'Ressource externe indisponible hors Google Fonts',
        description: `${externalResources.length} ressource${externalResources.length > 1 ? 's' : ''} distante${externalResources.length > 1 ? 's' : ''} (${origins.join(', ')}) ${externalResources.length > 1 ? 'ne seront pas chargées' : 'ne sera pas chargée'} par le runner local.`,
        severity: 'information',
        coverage: 'manuel',
        viewport: 'Toutes les tailles',
        routePath: route.path,
        source: { file: relativeFile, line: externalResources[0].line },
        rule: 'network.external-resource',
        proposal: 'Télécharger cette dépendance dans le projet, vérifier sa licence puis remplacer l’URL par un chemin local.',
        fix: {
          kind: 'manual',
          file: relativeFile,
          confidence: 'review',
          before: externalResources.map((resource) => resource.url).join('\n')
        }
      }))
    }

    const styleContexts: StyleContext[] = []
    for (const linkedStyle of routeContext.linkedStyles) {
      linkedCssFiles.add(linkedStyle)
      const css = cssCache.get(linkedStyle) ?? await readTextFile(linkedStyle, normalizedRoot)
      cssCache.set(linkedStyle, css)
      if (css) styleContexts.push({
        file: linkedStyle,
        relativeFile: posixRelative(normalizedRoot, linkedStyle),
        css,
        routePath: route.path,
        inline: false
      })
    }

    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      styleContexts.push({
        file: routeContext.file,
        relativeFile,
        css: match[1],
        routePath: route.path,
        inline: true
      })
    }

    for (const styleContext of styleContexts) {
      scannedStyles += 1
      issues.push(...analyzeStylesheet(styleContext).slice(0, Math.max(0, MAX_ISSUES - issues.length)))
    }
    const routeTheme = detectTheme(`${html}\n${styleContexts.map((style) => style.css).join('\n')}`)
    route.theme = routeTheme.detected
    themeProfiles.push(routeTheme)
  }

  // Les styles non liés sont signalés sans produire de faux correctifs. Cela évite
  // qu’un dossier demo/ ou storybook/ pollue les constats de la page réellement testée.
  const unlinkedCssFiles = cssFiles.filter((file) => !linkedCssFiles.has(file))
  if (unlinkedCssFiles.length > 0 && issues.length < MAX_ISSUES) {
    const file = unlinkedCssFiles[0]
    issues.push(makeIssue({
      title: 'Feuilles de style hors des routes détectées',
      description: `${unlinkedCssFiles.length} feuille${unlinkedCssFiles.length > 1 ? 's' : ''} CSS ${unlinkedCssFiles.length > 1 ? 'ne sont reliées' : 'n’est reliée'} à aucune page HTML détectée. Elles restent hors du périmètre automatique pour éviter les faux positifs.`,
      severity: 'information',
      coverage: 'manuel',
      viewport: 'Hors route',
      source: { file: posixRelative(normalizedRoot, file), line: 1 },
      rule: 'css.unlinked',
      proposal: 'Ouvrir la route qui consomme ces styles ou vérifier leur chaîne d’import avant de les corriger.',
      fix: { kind: 'manual', file: posixRelative(normalizedRoot, file), confidence: 'review' }
    }))
  }

  if (preprocessorFiles.length > 0 && issues.length < MAX_ISSUES) {
    const file = preprocessorFiles[0]
    issues.push(makeIssue({
      title: 'Sources CSS à compiler',
      description: `${preprocessorFiles.length} fichier${preprocessorFiles.length > 1 ? 's' : ''} Sass/Less détecté${preprocessorFiles.length > 1 ? 's' : ''}. Le moteur ne les réécrit pas sans connaître leur chaîne de compilation.`,
      severity: 'information',
      coverage: 'manuel',
      viewport: 'Chaîne de build',
      source: { file: posixRelative(normalizedRoot, file), line: 1 },
      rule: 'css.preprocessor',
      proposal: 'Appliquer les corrections au CSS produit ou configurer explicitement le build du projet.',
      fix: { kind: 'manual', file: posixRelative(normalizedRoot, file), confidence: 'review' }
    }))
  }

  for (const routeContext of routeContexts) {
    if (issues.length >= MAX_ISSUES) break
    const hasResponsiveFinding = issues.some((issue) =>
      issue.routePath === routeContext.route.path &&
      (issue.severity === 'bloquant' || issue.severity === 'attention'))
    if (hasResponsiveFinding) continue
    issues.push(makeIssue({
      title: 'Validation visuelle à exécuter',
      description: 'Aucune règle statique bloquante n’a été détectée sur cette route. Le comportement réel doit encore être contrôlé sur plusieurs largeurs.',
      severity: 'information',
      coverage: 'manuel',
      viewport: '320–1440 px',
      routePath: routeContext.route.path,
      source: { file: routeContext.relativeFile, line: 1 },
      rule: 'manual.visual-sweep',
      proposal: 'Balayer les viewports et compléter l’analyse par les débordements mesurés dans la preview.',
      fix: { kind: 'manual', file: routeContext.relativeFile, confidence: 'review' }
    }))
  }

  if (issues.length >= MAX_ISSUES) truncated = true
  if (issues.length === 0) {
    issues.push(makeIssue({
      title: 'Validation visuelle à exécuter',
      description: 'Aucune règle statique bloquante n’a été détectée. Le comportement réel doit encore être contrôlé sur plusieurs largeurs.',
      severity: 'information',
      coverage: 'manuel',
      viewport: '320–1440 px',
      routePath: routeContexts[0]?.route.path,
      rule: 'manual.visual-sweep',
      proposal: 'Balayer les viewports et compléter l’analyse par les débordements mesurés dans la preview.',
      fix: { kind: 'manual', file: routeContexts[0]?.relativeFile ?? '', confidence: 'review' }
    }))
  }

  const capabilities = await detectCapabilities(normalizedRoot, files, Boolean(entryFile))
  const entryPath = entryFile ? `/${posixRelative(normalizedRoot, entryFile)}` : null
  const routes = routeContexts
    .map((context) => context.route)
    .sort((left, right) => left.path === entryPath ? -1 : right.path === entryPath ? 1 : left.label.localeCompare(right.label, 'fr'))
  // Le thème du projet suit la route d’entrée. Une démo sombre rangée dans un
  // sous-dossier ne doit pas empêcher de proposer un thème sombre au vrai site.
  const theme = themeProfiles[0] ?? detectTheme('')

  return {
    id: `project-${createHash('sha256').update(normalizedRoot).digest('hex').slice(0, 12)}`,
    name: basename(normalizedRoot),
    root: normalizedRoot,
    kind: entryFile
      ? capabilities.framework ? `Projet ${capabilities.framework}` : 'Projet web local'
      : 'Dossier sans page HTML directement prévisualisable',
    files: files.length,
    analyzedAt: new Date().toISOString(),
    issues,
    previewHtml: null,
    previewOrigin: null,
    entryPath,
    routes,
    theme,
    capabilities,
    analysis: { truncated, scannedFiles: files.length, scannedStyles }
  }
}

export function createDemoProject(): ProjectSnapshot {
  const demoIssue: ProjectIssue = {
    id: stableId('css.nowrap', '/index.html', 'styles.css', 1, '.navigation', 'white-space', 'nowrap'),
    title: 'Navigation forcée sur une ligne',
    description: 'La navigation de démonstration conserve white-space: nowrap sur téléphone.',
    severity: 'attention',
    coverage: 'heuristique',
    viewport: '320–640 px',
    routePath: '/index.html',
    source: { file: 'styles.css', line: 1 },
    rule: 'css.nowrap',
    proposal: 'Autoriser le retour à la ligne sous 640 px.',
    fix: {
      kind: 'css-media-override',
      file: 'styles.css',
      confidence: 'review',
      selector: '.navigation',
      property: 'white-space',
      before: 'nowrap',
      after: 'normal',
      breakpoint: 640
    }
  }

  return {
    id: 'demo-atlas',
    name: 'Atelier Atlas',
    root: 'Projet de démonstration local',
    kind: 'Démo statique',
    files: 4,
    analyzedAt: new Date().toISOString(),
    previewOrigin: null,
    entryPath: '/index.html',
    routes: [{ path: '/index.html', label: 'index.html', title: 'Atelier Atlas', theme: 'light' }],
    theme: {
      detected: 'light',
      hasDark: false,
      hasLight: true,
      evidence: ['Surface claire détectée'],
      variables: [
        { name: '--background', value: '#ffffff', role: 'background' },
        { name: '--text', value: '#172033', role: 'text' }
      ]
    },
    previewHtml: '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Atelier Atlas</title></head><body><p>Ouvrez la démonstration locale pour utiliser toutes les interactions.</p></body></html>',
    issues: [demoIssue],
    capabilities: {
      interactive: true,
      staging: true,
      framework: null,
      packageManager: null,
      buildRequired: false
    },
    analysis: { truncated: false, scannedFiles: 4, scannedStyles: 1 }
  }
}
