import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'
import postcss, { type Declaration, type Rule } from 'postcss'
import type {
  PreviewDiagnostic,
  PreviewReadiness,
  PreviewStrategy,
  ProjectCapabilities,
  ProjectFix,
  ProjectIssue,
  ProjectPreparationProgress,
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
const MAX_MEDIA_FILES = 400
const MAX_ROUTES = 120
const MAX_STYLESHEETS = 240
const MAX_ISSUES = 320
const MAX_RETURNED_ISSUES = 60
const MAX_RETURNED_ISSUES_PER_ROUTE = 18
const MAX_TEXT_BYTES = 2_000_000
const PROGRESS_TOTAL = 6
const artifactDirectories = ['dist', 'build', 'out', '.output/public'] as const
const mediaExtensions = new Set([
  '.apng', '.avif', '.bmp', '.eot', '.gif', '.ico', '.jpeg', '.jpg', '.mp3', '.mp4', '.ogg',
  '.otf', '.png', '.svg', '.ttf', '.wav', '.webm', '.webp', '.woff', '.woff2'
])

const auxiliaryRouteSegments = new Set([
  'component', 'components', 'demo', 'demos', 'example', 'examples', 'fixture', 'fixtures',
  'include', 'includes', 'partial', 'partials', 'storybook', 'test', 'tests'
])

function isAuxiliaryRouteFile(root: string, file: string): boolean {
  const relativeFile = posixRelative(root, file).toLowerCase()
  const segments = relativeFile.split('/')
  const stem = basename(relativeFile, extname(relativeFile))
  return segments.some((segment) => auxiliaryRouteSegments.has(segment)) ||
    /^(?:demo|example|fixture|preview|storybook)(?:[-_.]|$)/.test(stem)
}

export interface AnalyzeProjectOptions {
  onProgress?: (progress: ProjectPreparationProgress) => void
  preferredEntryPath?: string | null
}

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

interface ArtifactCandidate {
  basePath: string
  root: string
  files: string[]
  entryFile: string
  truncated: boolean
  possiblyStale: boolean
  mountUncertain: boolean
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
  let mediaFiles = 0

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

    // Les entrées et feuilles de style du niveau courant doivent être inventoriées
    // avant les sous-dossiers d’assets. Un dossier rempli d’images ne doit jamais
    // consommer tout le budget avant que index.html soit découvert.
    for (const entry of entries.filter((candidate) => candidate.isFile())) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      const isMedia = mediaExtensions.has(extname(entry.name).toLowerCase())
      if (isMedia && mediaFiles >= MAX_MEDIA_FILES) {
        truncated = true
        continue
      }
      files.push(join(folder, entry.name))
      if (isMedia) mediaFiles += 1
    }

    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue
      await visit(join(folder, entry.name))
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

function reportProgress(
  options: AnalyzeProjectOptions,
  phase: ProjectPreparationProgress['phase'],
  step: number,
  label: string,
  detail?: string
): void {
  try {
    options.onProgress?.({ phase, step, total: PROGRESS_TOTAL, label, ...(detail ? { detail } : {}) })
  } catch {
    // Une vue fermée pendant l’analyse ne doit jamais interrompre le diagnostic local.
  }
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

function consolidateProjectIssues(issues: ProjectIssue[], preferredRoute?: string | null): ProjectIssue[] {
  const groups = new Map<string, ProjectIssue[]>()
  for (const issue of issues) {
    const source = issue.source
    const key = [
      issue.rule,
      issue.title,
      source?.file ?? '',
      source?.line ?? '',
      issue.fix?.selector ?? '',
      issue.fix?.property ?? '',
      issue.fix?.before ?? ''
    ].join('\u001f')
    const group = groups.get(key)
    if (group) group.push(issue)
    else groups.set(key, [issue])
  }

  return [...groups.entries()].map(([key, group]) => {
    if (group.length === 1) return group[0]
    const routes = [...new Set(group.map((issue) => issue.routePath).filter((route): route is string => Boolean(route)))]
    const representative = group.find((issue) => issue.routePath === preferredRoute) ?? group[0]
    const routeSummary = routes.length > 1
      ? ` Même règle partagée par ${routes.length} pages ; une seule occurrence est affichée pour éviter les doublons.`
      : ''
    return {
      ...representative,
      id: stableId('consolidated', key),
      description: `${representative.description}${routeSummary}`,
      evidence: representative.evidence
        ? {
            ...representative.evidence,
            measurements: {
              ...representative.evidence.measurements,
              affectedRoutes: routes.length
            }
          }
        : representative.evidence
    }
  })
}

function prioritizeProjectIssues(issues: ProjectIssue[], preferredRoute?: string | null): ProjectIssue[] {
  const severityScore: Record<ProjectIssue['severity'], number> = { bloquant: 300, attention: 200, information: 100 }
  const score = (issue: ProjectIssue): number => severityScore[issue.severity] +
    (issue.coverage === 'standard' ? 24 : issue.coverage === 'heuristique' ? 12 : 0) +
    (issue.confidence === 'certain' ? 10 : issue.confidence === 'probable' ? 5 : 0) +
    (issue.fix?.confidence === 'safe' ? 4 : 0) +
    (issue.routePath === preferredRoute ? 2 : 0)
  const ordered = issues.map((issue, index) => ({ issue, index, score: score(issue) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const perRoute = new Map<string, number>()
  const selected: ProjectIssue[] = []
  for (const entry of ordered) {
    if (selected.length >= MAX_RETURNED_ISSUES) break
    const route = entry.issue.routePath ?? '__project__'
    const count = perRoute.get(route) ?? 0
    if (route !== '__project__' && count >= MAX_RETURNED_ISSUES_PER_ROUTE) continue
    selected.push(entry.issue)
    perRoute.set(route, count + 1)
  }
  return selected
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

function maximumMediaWidth(declaration: Declaration): number | null {
  let parent = declaration.parent as unknown as CssAncestor | undefined
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase() === 'media') {
      const matches = [...(parent.params ?? '').matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)]
      if (matches.length > 0) return Math.min(...matches.map((match) => Number(match[1])))
    }
    parent = parent.parent
  }
  return null
}

function normalizedSelectors(value: string): string[] {
  return value.split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function collectMobileWrappingOverrides(styles: StyleContext[]): Set<string> {
  const selectors = new Set<string>()
  for (const style of styles) {
    let rootNode
    try {
      rootNode = postcss.parse(style.css, { from: style.inline ? undefined : style.file })
    } catch {
      continue
    }
    rootNode.walkDecls('white-space', (declaration) => {
      const maxWidth = maximumMediaWidth(declaration)
      if (maxWidth === null || maxWidth > 900 || /(?:^|\s)nowrap(?:\s|$)/i.test(declaration.value)) return
      const selector = selectorOf(declaration)
      if (!selector) return
      for (const entry of normalizedSelectors(selector)) selectors.add(entry)
    })
  }
  return selectors
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveLocalReference(root: string, fromFile: string, reference: string, absoluteBase = root): string | null {
  const cleanReference = safeDecodeUri(reference.trim().split(/[?#]/, 1)[0])
  if (
    cleanReference.length === 0 ||
    cleanReference.startsWith('#') ||
    cleanReference.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(cleanReference)
  ) return null

  const absolute = cleanReference.startsWith('/')
    ? resolve(absoluteBase, `.${cleanReference}`)
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

function linkedStylesheets(root: string, htmlFile: string, html: string, absoluteBase = root): string[] {
  const styles = new Set<string>()
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesOf(match[0])
    const relValue = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? []
    if (!relValue.includes('stylesheet')) continue
    const href = attributes.get('href')
    if (!href) continue
    const resolved = resolveLocalReference(root, htmlFile, href, absoluteBase)
    if (resolved && extname(resolved).toLowerCase() === '.css') styles.add(resolved)
  }
  return [...styles]
}

function sanitizedExternalReference(reference: string): string | null {
  if (!/^(?:https?:)?\/\//i.test(reference)) return null
  try {
    const url = new URL(reference.startsWith('//') ? `https:${reference}` : reference)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname.toLowerCase())) return null
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return `${url.origin}${url.pathname}`.slice(0, 500)
  } catch {
    return null
  }
}

function blockedExternalResources(html: string): Array<{ url: string; line: number }> {
  const resources: Array<{ url: string; line: number }> = []
  const expression = /<(audio|embed|iframe|img|input|link|object|script|source|track|video)\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = expression.exec(html)) !== null) {
    const tagName = match[1].toLowerCase()
    const attributes = attributesOf(match[0])
    if (tagName === 'link') {
      const rel = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? []
      const loadsResource = rel.some((value) => ['stylesheet', 'icon', 'manifest', 'preload', 'modulepreload', 'preconnect', 'dns-prefetch'].includes(value))
      if (!loadsResource) continue
    }
    const candidates: string[] = []
    const attributeNames = tagName === 'link'
      ? ['href']
      : tagName === 'object'
        ? ['data']
        : tagName === 'video'
          ? ['poster', 'src']
          : ['src']
    for (const name of attributeNames) {
      const value = attributes.get(name)
      if (value) candidates.push(value)
    }
    const srcset = attributes.get('srcset')
    if (srcset) candidates.push(...srcset.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]))
    for (const reference of candidates) {
      const sanitized = sanitizedExternalReference(reference)
      if (sanitized) resources.push({ url: sanitized, line: html.slice(0, match.index).split('\n').length })
    }
  }
  return resources
}

function blockedExternalCssResources(css: string): Array<{ url: string; line: number }> {
  const resources: Array<{ url: string; line: number }> = []
  const expression = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)|@import\s+(?:"([^"]+)"|'([^']+)')/gi
  for (const match of css.matchAll(expression)) {
    const reference = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
    if (!reference) continue
    const sanitized = sanitizedExternalReference(reference)
    if (sanitized) resources.push({ url: sanitized, line: css.slice(0, match.index).split('\n').length })
  }
  return resources
}

function importedStylesheets(root: string, cssFile: string, css: string, absoluteBase = root): string[] {
  const imports = new Set<string>()
  const expression = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s)'";]+))/gi
  for (const match of css.matchAll(expression)) {
    const reference = match[1] ?? match[2] ?? match[3]
    if (!reference) continue
    const resolved = resolveLocalReference(root, cssFile, reference, absoluteBase)
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

function preferredEntryFile(root: string, files: ReadonlySet<string>, value: string | null | undefined): string | null {
  if (!value || value.includes('\0')) return null
  const decoded = safeDecodeUri(value.trim().split(/[?#]/, 1)[0])
  const candidate = resolve(root, decoded.replace(/^[/\\]+/, ''))
  if (!isInsideRoot(root, candidate) || !files.has(candidate) || !['.html', '.htm'].includes(extname(candidate).toLowerCase())) return null
  return candidate
}

function bodyMarkup(html: string): string {
  return html.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|<\/html\s*>|$)/i)?.[1] ?? html
}

function hasVisibleMarkup(html: string): boolean {
  const body = bodyMarkup(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  if (/<(?:img|picture|svg|canvas|video|audio|iframe|object|embed|input|textarea|select|button|hr)\b/i.test(body)) return true
  if (/<[\w:-]+\b[^>]*\bstyle\s*=\s*(?:"[^"]*(?:background|border|width|height|min-height)[^"]*"|'[^']*(?:background|border|width|height|min-height)[^']*')/i.test(body)) return true
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160|#xa0);/gi, ' ')
    .replace(/&(?:[a-z][\w]+|#\d+|#x[\da-f]+);/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0
}

function hasIncompleteStructure(html: string): boolean {
  const normalized = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const structuralTags = new Set(['article', 'aside', 'button', 'div', 'footer', 'form', 'header', 'main', 'nav', 'section', 'table', 'tbody', 'thead', 'tr', 'ul'])
  const stack: string[] = []
  for (const match of normalized.matchAll(/<\s*(\/?)\s*([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = match[2].toLowerCase()
    if (!structuralTags.has(tag)) continue
    if (match[1]) {
      if (stack.at(-1) !== tag) return true
      stack.pop()
    } else if (!/\/\s*>$/.test(match[0])) {
      stack.push(tag)
    }
  }
  return stack.length > 0
}

function runnableScriptReferences(
  projectRoot: string,
  htmlFile: string,
  html: string,
  knownFiles: ReadonlySet<string>,
  absoluteBase = projectRoot
): boolean {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = attributesOf(`<script${match[1]}>`)
    const type = attributes.get('type')?.trim().toLowerCase() ?? ''
    if (['application/json', 'application/ld+json', 'importmap', 'speculationrules'].includes(type)) continue
    const source = attributes.get('src')
    if (!source) {
      if (match[2].trim()) return true
      continue
    }
    const resolved = resolveLocalReference(projectRoot, htmlFile, source, absoluteBase)
    if (!resolved || !knownFiles.has(resolved)) continue
    if (['.js', '.mjs'].includes(extname(resolved).toLowerCase())) return true
  }
  return false
}

function sourceLooksCompiled(html: string): boolean {
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const source = attributesOf(match[0]).get('src')
    if (!source) continue
    const cleanSource = safeDecodeUri(source).split(/[?#]/, 1)[0].replaceAll('\\', '/')
    if (/(?:^|\/)src\/.+/i.test(cleanSource) || /\.(?:ts|tsx|jsx|vue|svelte)$/i.test(cleanSource)) return true
  }
  return false
}

interface ArtifactRootReference {
  path: string
  /** Une référence Web absolue est résolue depuis la racine candidate du mount. */
  fromMountRoot: boolean
}

function artifactRootReferences(html: string): ArtifactRootReference[] {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0]
  const baseHref = baseTag ? attributesOf(baseTag).get('href')?.trim() ?? '' : ''
  const cleanBase = safeDecodeUri(baseHref.split(/[?#]/, 1)[0]).replaceAll('\\', '/')
  const absoluteBase = cleanBase.startsWith('/') && !cleanBase.startsWith('//') ? cleanBase : ''
  const relativeBase = !absoluteBase && cleanBase && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(cleanBase)
    ? cleanBase
    : ''
  const references = new Map<string, ArtifactRootReference>()
  const addReference = (rawValue: string): void => {
    if (references.size >= 128 || !rawValue || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(rawValue)) return
    const cleanValue = safeDecodeUri(rawValue.split(/[?#]/, 1)[0]).replaceAll('\\', '/')
    if (!cleanValue) return
    const fromMountRoot = cleanValue.startsWith('/') || Boolean(absoluteBase)
    const webPath = cleanValue.startsWith('/')
      ? cleanValue
      : absoluteBase
        ? posix.join(absoluteBase, cleanValue)
        : relativeBase
          ? posix.join(relativeBase, cleanValue)
          : cleanValue
    const normalized = posix.normalize(webPath)
    if (!normalized || normalized === '.') return
    const path = fromMountRoot ? normalized.replace(/^\/+/, '') : normalized
    if (!path || fromMountRoot && (path === '..' || path.startsWith('../'))) return
    references.set(`${fromMountRoot ? 'root' : 'entry'}:${path}`, { path, fromMountRoot })
  }
  for (const match of html.matchAll(/<(?:audio|embed|iframe|img|input|link|object|script|source|track|video)\b[^>]*>/gi)) {
    const attributes = attributesOf(match[0])
    for (const name of ['href', 'poster', 'src']) {
      const rawValue = attributes.get(name)?.trim()
      if (rawValue) addReference(rawValue)
    }
    const srcset = attributes.get('srcset')
    if (srcset) for (const candidate of srcset.split(',')) addReference(candidate.trim().split(/\s+/, 1)[0])
  }
  for (const match of html.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi)) {
    addReference(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return [...references.values()]
}

function chooseArtifactMountRoot(
  candidateRoot: string,
  entryFile: string,
  html: string,
  knownFiles: ReadonlySet<string>
): { root: string; uncertain: boolean } {
  const references = artifactRootReferences(html)
  const entryDirectory = dirname(entryFile)
  const htmlFiles = [...knownFiles].filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
  let routeRoot = entryDirectory
  while (routeRoot !== candidateRoot && htmlFiles.some((file) => !isInsideRoot(routeRoot, file))) {
    const parent = dirname(routeRoot)
    if (parent === routeRoot || !isInsideRoot(candidateRoot, parent)) {
      routeRoot = candidateRoot
      break
    }
    routeRoot = parent
  }
  if (references.length === 0) return { root: routeRoot, uncertain: false }

  const candidates: string[] = []
  let current = routeRoot
  while (isInsideRoot(candidateRoot, current)) {
    candidates.push(current)
    if (current === candidateRoot) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  let best = candidateRoot
  let bestMatches = -1
  for (const candidate of candidates) {
    const matches = references.filter((reference) => {
      const target = reference.fromMountRoot
        ? resolve(candidate, reference.path)
        : resolve(entryDirectory, reference.path)
      return isInsideRoot(candidate, target) && knownFiles.has(target)
    }).length
    if (matches === references.length) return { root: candidate, uncertain: false }
    if (matches > bestMatches) {
      best = candidate
      bestMatches = matches
    }
  }
  // Sans preuve complète, on conserve le meilleur ancrage connu. En cas
  // d’égalité sans correspondance, la base d’artefact autorisée est la moins
  // surprenante et évite d’exposer le reste du projet.
  if (bestMatches <= 0) best = candidateRoot
  return { root: best, uncertain: true }
}

async function findArtifact(
  projectRoot: string,
  searchAllowed: boolean,
  sourceEntry: string | undefined,
  sourceHtml: string,
  sourceFiles: string[]
): Promise<ArtifactCandidate | null> {
  const sourceIsShell = !sourceEntry || sourceLooksCompiled(sourceHtml) || !hasVisibleMarkup(sourceHtml)
  if (!searchAllowed || !sourceIsShell) return null

  for (const basePath of artifactDirectories) {
    const candidateRoot = await fs.realpath(join(projectRoot, basePath)).catch(() => null)
    if (!candidateRoot || !isInsideRoot(projectRoot, candidateRoot)) continue
    const inventory = await listProjectFiles(candidateRoot)
    const htmlFiles = inventory.files
      .filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
      .sort((left, right) => entryScore(candidateRoot, right) - entryScore(candidateRoot, left))
    const entryFile = htmlFiles[0]
    if (!entryFile) continue
    const html = await readTextFile(entryFile, projectRoot)
    if (!html || /%(?:PUBLIC_URL|BASE_URL)%|\{\{\s*(?:BASE_URL|PUBLIC_URL)\s*\}\}/i.test(html)) continue
    const mountChoice = chooseArtifactMountRoot(candidateRoot, entryFile, html, new Set(inventory.files))
    const mountedRoot = await fs.realpath(mountChoice.root).catch(() => null)
    if (!mountedRoot || !isInsideRoot(candidateRoot, mountedRoot)) continue
    const mountedInventory = mountedRoot === candidateRoot ? inventory : await listProjectFiles(mountedRoot)
    const knownFiles = new Set(mountedInventory.files)
    if (!hasVisibleMarkup(html) && !runnableScriptReferences(projectRoot, entryFile, html, knownFiles, mountedRoot)) continue

    const sourceMtime = await latestRelevantSourceMtime(sourceFiles)
    const artifactMtime = await latestFileMtime(mountedInventory.files)
    return {
      basePath: posixRelative(projectRoot, mountedRoot),
      root: mountedRoot,
      files: mountedInventory.files,
      entryFile,
      truncated: inventory.truncated || mountedInventory.truncated,
      possiblyStale: sourceMtime > artifactMtime + 1_500,
      mountUncertain: mountChoice.uncertain
    }
  }
  return null
}

const freshnessExtensions = new Set([
  '.astro', '.cjs', '.css', '.htm', '.html', '.js', '.jsx', '.json', '.less', '.mjs',
  '.sass', '.scss', '.svelte', '.ts', '.tsx', '.vue'
])

async function latestFileMtime(files: string[]): Promise<number> {
  const timestamps = await Promise.all(files.map(async (file) => (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0))
  return timestamps.reduce((latest, value) => Math.max(latest, value), 0)
}

async function latestRelevantSourceMtime(files: string[]): Promise<number> {
  return latestFileMtime(files.filter((file) => freshnessExtensions.has(extname(file).toLowerCase())))
}

function referencedLocalFiles(
  projectRoot: string,
  routeContexts: RouteContext[],
  cssCache: ReadonlyMap<string, string>,
  absoluteBase: string
): Set<string> {
  const references = new Set<string>()
  const add = (fromFile: string, reference: string): void => {
    const resolved = resolveLocalReference(projectRoot, fromFile, reference, absoluteBase)
    if (resolved) references.add(resolved)
  }
  for (const context of routeContexts) {
    for (const match of context.html.matchAll(/<[a-z][^>]*>/gi)) {
      const attributes = attributesOf(match[0])
      for (const name of ['href', 'poster', 'src']) {
        const value = attributes.get(name)
        if (value) add(context.file, value)
      }
      const srcset = attributes.get('srcset')
      if (srcset) for (const candidate of srcset.split(',')) add(context.file, candidate.trim().split(/\s+/, 1)[0])
    }
  }
  for (const [file, css] of cssCache) {
    for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi)) {
      const reference = match[1] ?? match[2] ?? match[3]
      if (reference) add(file, reference)
    }
  }
  return references
}

function makeReadiness(
  strategy: PreviewStrategy,
  diagnostics: PreviewDiagnostic[],
  needsBuild: boolean
): PreviewReadiness {
  if (needsBuild) {
    return {
      status: 'needs-build',
      strategy,
      summary: 'Les sources doivent être compilées avant de pouvoir être prévisualisées fidèlement.',
      diagnostics
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'blocking')) {
    return {
      status: 'blocked',
      strategy,
      summary: 'Aucun rendu exploitable ne peut être préparé à partir de l’entrée détectée.',
      diagnostics
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
    return {
      status: 'degraded',
      strategy,
      summary: 'La prévisualisation est disponible, avec des limites à vérifier.',
      diagnostics
    }
  }
  return {
    status: 'ready',
    strategy,
    summary: strategy === 'artifact' ? 'Un artefact compilé local est prêt à être analysé.' : 'Le projet est prêt à être analysé dans le runner local.',
    diagnostics
  }
}

function issueFromDiagnostic(diagnostic: PreviewDiagnostic, routePath?: string): ProjectIssue {
  return makeIssue({
    title: diagnostic.title,
    description: diagnostic.detail,
    severity: diagnostic.severity === 'blocking' ? 'bloquant' : diagnostic.severity === 'warning' ? 'attention' : 'information',
    coverage: 'manuel',
    viewport: 'Préparation du rendu',
    routePath,
    ...(diagnostic.file ? { source: { file: diagnostic.file, line: 1 } } : {}),
    rule: diagnostic.code,
    proposal: 'Corriger ce point dans le projet puis relancer l’analyse locale avant de valider un rendu.',
    ...(diagnostic.file ? { fix: { kind: 'manual' as const, file: diagnostic.file, confidence: 'review' as const } } : {})
  })
}

function roleOfVariable(name: string): ThemeVariable['role'] {
  const normalized = name.toLowerCase()
  if (/(?:^|[-_])(shadow|radius|spacing|duration|font|size|width|height|z)(?:$|[-_])/.test(normalized)) return 'unknown'
  if (/^--(?:text|fg|foreground|ink)(?:$|[-_])/.test(normalized)) return 'text'
  // Une couleur de bouton, de pilule ou de marque n'est pas une surface de page.
  // La reclasser en accent évite qu'un thème généré efface l'identité visuelle.
  if (/(?:^|[-_])(accent|active|brand|button|btn|cta|link|logo|nav|pill|primary|action)(?:$|[-_])/.test(normalized)) return 'accent'
  if (/(?:^|[-_])(muted|subtle|secondary|tertiary|disabled)(?:$|[-_])/.test(normalized)) return 'muted'
  if (/(?:^|[-_])(text|fg|foreground|ink)(?:$|[-_])/.test(normalized)) return 'text'
  if (/(?:^|[-_])(bg|background|canvas|page|paper|base)(?:$|[-_])/.test(normalized)) return 'background'
  if (/(?:^|[-_])(surface|panel|card|elevated|popover)(?:$|[-_])/.test(normalized)) return 'surface'
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

  const rootSurfaceExpressions: Array<{ expression: string; weight: number }> = []
  // Une palette déclarée ne constitue pas une variante disponible. On ne
  // qualifie la surface active qu’à partir de propriétés réellement appliquées
  // aux racines usuelles du document ; les variantes restent détectées via
  // leurs media queries, attributs/classes ou color-scheme explicites.
  for (const block of content.matchAll(/(?:^|[}\s,])(html|body|:root|main|#(?:app|root)|\.(?:app|page|site))(?:[\s.#:[>,+~][^{]*)?\{([^}]*)\}/gim)) {
    const anchor = block[1].toLowerCase()
    const weight = anchor === 'body' ? 4 : anchor === 'html' || anchor === ':root' ? 3 : anchor === 'main' ? 1 : 2
    for (const declaration of block[2].matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gim)) {
      rootSurfaceExpressions.push({ expression: declaration[1].trim(), weight })
    }
  }
  for (const body of content.matchAll(/<body\b[^>]*\bstyle\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
    for (const declaration of body[1].matchAll(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gim)) {
      rootSurfaceExpressions.push({ expression: declaration[1].trim(), weight: 5 })
    }
  }
  const resolveSurfaceColor = (expression: string, visited = new Set<string>()): ParsedColor | null => {
    const direct = parseColor(expression)
    if (direct) return direct
    const variable = expression.match(/var\(\s*(--[\w-]+)/)?.[1]
    if (!variable || visited.has(variable)) return null
    const value = values.get(variable)
    if (!value) return null
    const nextVisited = new Set(visited)
    nextVisited.add(variable)
    return resolveSurfaceColor(value, nextVisited)
  }
  let darkSurfaces = 0
  let lightSurfaces = 0
  let darkWeight = 0
  let lightWeight = 0
  for (const { expression, weight } of rootSurfaceExpressions) {
    const color = resolveSurfaceColor(expression)
    if (!color) continue
    const luminance = luminanceOfColor(color)
    if (luminance < 0.22) {
      darkSurfaces += 1
      darkWeight += weight
    }
    if (luminance > 0.72) {
      lightSurfaces += 1
      lightWeight += weight
    }
  }
  const activeDark = darkWeight > lightWeight || darkWeight > 0 && lightWeight === 0
  const activeLight = lightWeight > darkWeight || lightWeight > 0 && darkWeight === 0
  if (activeDark) {
    hasDark = true
    evidence.push(`${darkSurfaces} surface${darkSurfaces > 1 ? 's' : ''} sombre${darkSurfaces > 1 ? 's' : ''} détectée${darkSurfaces > 1 ? 's' : ''}`)
  }
  if (activeLight) {
    hasLight = true
    evidence.push(`${lightSurfaces} surface${lightSurfaces > 1 ? 's' : ''} claire${lightSurfaces > 1 ? 's' : ''} détectée${lightSurfaces > 1 ? 's' : ''}`)
  }

  const detected: ThemeDetection = hasDark && hasLight ? 'dual' : hasDark ? 'dark' : hasLight ? 'light' : 'unknown'
  if (detected === 'unknown') evidence.push('Aucune surface sémantique fiable ne permet de conclure')
  return { detected, hasDark, hasLight, evidence: [...new Set(evidence)].slice(0, 8), variables }
}

async function detectCapabilities(
  root: string,
  files: string[],
  hasHtml: boolean
): Promise<Omit<ProjectCapabilities, 'previewStrategy'>> {
  const relativeFiles = new Set(files.map((file) => posixRelative(root, file).toLowerCase()))
  const packageFile = files.find((file) => posixRelative(root, file).toLowerCase() === 'package.json')
  const composerFile = files.find((file) => posixRelative(root, file).toLowerCase() === 'composer.json')
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
        ['vite', 'Vite'],
        ['express', 'Node.js / Express']
      ]
      framework = frameworks.find(([dependency]) => dependency in dependencies)?.[1] ?? null
      if ('tailwindcss' in dependencies || '@tailwindcss/vite' in dependencies || '@tailwindcss/postcss' in dependencies) {
        framework = framework ? `${framework} + Tailwind CSS` : 'Tailwind CSS'
      }
      hasBuildScript = typeof packageJson.scripts?.build === 'string'
    } catch {
      // Un package.json invalide ne doit pas empêcher l’analyse du HTML/CSS.
    }
  }
  if (composerFile) {
    try {
      const composerJson = JSON.parse(await readTextFile(composerFile, root)) as {
        require?: Record<string, string>
        'require-dev'?: Record<string, string>
      }
      const dependencies = { ...composerJson['require-dev'], ...composerJson.require }
      const backend = 'symfony/framework-bundle' in dependencies
        ? 'Symfony'
        : 'laravel/framework' in dependencies
          ? 'Laravel'
          : null
      if (backend) framework = framework ? `${backend} + ${framework}` : backend
    } catch {
      // La détection de stack reste informative et ne bloque jamais le rendu.
    }
  }

  let packageManager: string | null = null
  if (relativeFiles.has('pnpm-lock.yaml')) packageManager = 'pnpm'
  else if (relativeFiles.has('yarn.lock')) packageManager = 'Yarn'
  else if (relativeFiles.has('bun.lock') || relativeFiles.has('bun.lockb')) packageManager = 'Bun'
  else if (relativeFiles.has('package-lock.json')) packageManager = 'npm'
  else if (relativeFiles.has('composer.lock')) packageManager = 'Composer'

  const sourceRequiresCompilation = files.some((file) => ['.ts', '.tsx', '.jsx', '.vue', '.svelte'].includes(extname(file).toLowerCase()))
  return {
    interactive: hasHtml,
    staging: hasHtml || files.some((file) => extname(file).toLowerCase() === '.css'),
    framework,
    packageManager,
    buildRequired: hasBuildScript && (sourceRequiresCompilation || framework !== null)
  }
}

async function expandLinkedStyles(
  root: string,
  initialFiles: string[],
  cssCache: Map<string, string>,
  absoluteBase = root
): Promise<string[]> {
  const queue = [...initialFiles]
  const expanded = new Set<string>()
  while (queue.length > 0 && expanded.size < MAX_STYLESHEETS) {
    const file = queue.shift()
    if (!file || expanded.has(file)) continue
    expanded.add(file)
    const css = cssCache.get(file) ?? await readTextFile(file, root)
    cssCache.set(file, css)
    for (const imported of importedStylesheets(root, file, css, absoluteBase)) if (!expanded.has(imported)) queue.push(imported)
  }
  return [...expanded]
}

function analyzeStylesheet(style: StyleContext, mobileWrappingOverrides: ReadonlySet<string> = new Set()): ProjectIssue[] {
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
      !isIntentionalAnimatedNoWrap(declaration, selector) &&
      Boolean(selector && normalizedSelectors(selector).some((entry) => /(?:nav|menu|breadcrumb|heading|headline|title|toolbar|tabs?)/i.test(entry))) &&
      !normalizedSelectors(selector ?? '').some((entry) => /(?:__|[-_])link(?:\b|[.:#])/i.test(entry) && !/breadcrumb/i.test(entry)) &&
      !normalizedSelectors(selector ?? '').some((entry) => mobileWrappingOverrides.has(entry))
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

export async function analyzeProject(root: string, options: AnalyzeProjectOptions = {}): Promise<ProjectSnapshot> {
  const normalizedRoot = await fs.realpath(root).catch(() => resolve(root))
  const sourceInventory = await listProjectFiles(normalizedRoot)
  const sourceFiles = sourceInventory.files
  const sourceHtmlFiles = sourceFiles
    .filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
    .filter((file) => !isAuxiliaryRouteFile(normalizedRoot, file))
    .sort((left, right) => entryScore(normalizedRoot, right) - entryScore(normalizedRoot, left))
  const explicitEntry = preferredEntryFile(normalizedRoot, new Set(sourceFiles), options.preferredEntryPath)
  const detectedCapabilities = await detectCapabilities(normalizedRoot, sourceFiles, sourceHtmlFiles.length > 0)
  const automaticEntry = detectedCapabilities.buildRequired
    ? sourceHtmlFiles.find((file) => !/^public\//i.test(posixRelative(normalizedRoot, file)))
    : sourceHtmlFiles[0]
  const sourceEntry = explicitEntry ?? automaticEntry
  const sourceHtml = sourceEntry ? await readTextFile(sourceEntry, normalizedRoot) : ''
  const sourceRunnable = sourceEntry
    ? runnableScriptReferences(normalizedRoot, sourceEntry, sourceHtml, new Set(sourceFiles))
    : false
  const sourceHasVisibleMarkup = hasVisibleMarkup(sourceHtml)
  const sourceReferencesBuildInput = sourceLooksCompiled(sourceHtml)
  const sourceNeedsBuild = sourceEntry
    ? !sourceRunnable && sourceReferencesBuildInput || detectedCapabilities.buildRequired && (
      sourceReferencesBuildInput || !sourceRunnable && !sourceHasVisibleMarkup
    )
    : detectedCapabilities.buildRequired
  const shouldSearchArtifact = !sourceEntry ||
    sourceReferencesBuildInput && (detectedCapabilities.buildRequired || !sourceRunnable) ||
    !sourceRunnable && !sourceHasVisibleMarkup
  const artifact = explicitEntry ? null : await findArtifact(normalizedRoot, shouldSearchArtifact, sourceEntry, sourceHtml, sourceFiles)
  const analysisFiles = artifact?.files ?? sourceFiles
  const absoluteBase = artifact?.root ?? normalizedRoot
  const htmlFiles = analysisFiles
    .filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()))
    .filter((file) => file === explicitEntry || file === artifact?.entryFile || !isAuxiliaryRouteFile(normalizedRoot, file))
    .sort((left, right) => {
      if (left === explicitEntry) return -1
      if (right === explicitEntry) return 1
      return entryScore(absoluteBase, right) - entryScore(absoluteBase, left)
    })
  const cssFiles = analysisFiles.filter((file) => extname(file).toLowerCase() === '.css')
  const preprocessorFiles = analysisFiles.filter((file) => ['.scss', '.sass', '.less'].includes(extname(file).toLowerCase()))
  const entryFile = artifact?.entryFile ?? explicitEntry ?? htmlFiles[0]
  const needsBuild = sourceNeedsBuild && !artifact
  const previewStrategy: PreviewStrategy = artifact
    ? 'artifact'
    : needsBuild
      ? 'source'
      : entryFile
        ? 'static'
        : 'unsupported'
  reportProgress(
    options,
    'inventory',
    2,
    'Inventaire local terminé',
    `${analysisFiles.length} fichier${analysisFiles.length > 1 ? 's' : ''} dans le périmètre de rendu.`
  )

  const routeContexts: RouteContext[] = []
  const cssCache = new Map<string, string>()
  let truncated = sourceInventory.truncated || artifact?.truncated === true || htmlFiles.length > MAX_ROUTES || cssFiles.length > MAX_STYLESHEETS

  for (const file of htmlFiles.slice(0, MAX_ROUTES)) {
    const relativeFile = posixRelative(normalizedRoot, file)
    const webRelativeFile = artifact ? posixRelative(artifact.root, file) : relativeFile
    const html = await readTextFile(file, normalizedRoot)
    const routePath = `/${webRelativeFile}`
    routeContexts.push({
      file,
      relativeFile,
      html,
      linkedStyles: await expandLinkedStyles(
        normalizedRoot,
        linkedStylesheets(normalizedRoot, file, html, absoluteBase),
        cssCache,
        absoluteBase
      ),
      route: {
        path: routePath,
        label: webRelativeFile,
        sourcePath: relativeFile,
        title: extractTitle(html, basename(webRelativeFile))
      }
    })
  }
  reportProgress(
    options,
    'routes',
    3,
    'Entrées et routes qualifiées',
    artifact
      ? `Artefact local ${artifact.basePath} sélectionné sans exécuter de script.`
      : `${routeContexts.length} route${routeContexts.length > 1 ? 's' : ''} HTML détectée${routeContexts.length > 1 ? 's' : ''}.`
  )

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

    const externalStyleResources = styleContexts.flatMap((style) => (
      blockedExternalCssResources(style.css).map((resource) => ({ ...resource, file: style.relativeFile }))
    ))
    if (externalStyleResources.length > 0 && issues.length < MAX_ISSUES) {
      const origins = [...new Set(externalStyleResources.map((resource) => new URL(resource.url).hostname))]
      issues.push(makeIssue({
        title: 'Ressource externe appelée depuis le CSS',
        description: `${externalStyleResources.length} ressource${externalStyleResources.length > 1 ? 's' : ''} distante${externalStyleResources.length > 1 ? 's' : ''} (${origins.join(', ')}) ${externalStyleResources.length > 1 ? 'ne seront pas chargées' : 'ne sera pas chargée'} par le runner local.`,
        severity: 'information',
        coverage: 'manuel',
        viewport: 'Toutes les tailles',
        routePath: route.path,
        source: { file: externalStyleResources[0].file, line: externalStyleResources[0].line },
        rule: 'network.external-css-resource',
        proposal: 'Télécharger cette ressource dans le projet, vérifier sa licence puis utiliser un chemin CSS local.',
        fix: {
          kind: 'manual',
          file: externalStyleResources[0].file,
          confidence: 'review',
          before: externalStyleResources.map((resource) => resource.url).join('\n')
        }
      }))
    }

    const mobileWrappingOverrides = collectMobileWrappingOverrides(styleContexts)
    for (const styleContext of styleContexts) {
      scannedStyles += 1
      issues.push(...analyzeStylesheet(styleContext, mobileWrappingOverrides).slice(0, Math.max(0, MAX_ISSUES - issues.length)))
    }
    const routeTheme = detectTheme(`${html}\n${styleContexts.map((style) => style.css).join('\n')}`)
    route.theme = routeTheme.detected
    themeProfiles.push(routeTheme)
  }

  // Les styles non liés sont signalés sans produire de faux correctifs. Cela évite
  // qu’un dossier demo/ ou storybook/ pollue les constats de la page réellement testée.
  const auxiliaryHtmlDirectories = new Set(analysisFiles
    .filter((file) => ['.html', '.htm'].includes(extname(file).toLowerCase()) && isAuxiliaryRouteFile(normalizedRoot, file))
    .map((file) => dirname(file)))
  const unlinkedCssFiles = cssFiles.filter((file) => !linkedCssFiles.has(file) &&
    ![...auxiliaryHtmlDirectories].some((directory) => isInsideRoot(directory, file)))
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

  reportProgress(
    options,
    'responsive',
    4,
    'Analyse responsive terminée',
    `${scannedStyles} feuille${scannedStyles > 1 ? 's' : ''} de style analysée${scannedStyles > 1 ? 's' : ''}.`
  )

  const diagnostics: PreviewDiagnostic[] = []
  const entryContext = routeContexts.find((context) => context.file === entryFile)
  const knownFiles = new Set(analysisFiles)
  const entryRunnable = entryContext
    ? runnableScriptReferences(normalizedRoot, entryContext.file, entryContext.html, knownFiles, absoluteBase)
    : false

  if (artifact) {
    diagnostics.push({
      code: 'artifact.detected',
      severity: 'info',
      title: 'Artefact compilé détecté',
      detail: `Le dossier ${artifact.basePath} sera servi comme base du rendu, sans lancer la chaîne de build.`,
      file: posixRelative(normalizedRoot, artifact.entryFile)
    })
    if (artifact.possiblyStale) {
      diagnostics.push({
        code: 'artifact.possibly-stale',
        severity: 'warning',
        title: 'Artefact potentiellement obsolète',
        detail: 'Des sources locales sont plus récentes que les fichiers compilés. Le rendu reste disponible, mais il peut ne pas refléter les dernières modifications.',
        file: posixRelative(normalizedRoot, artifact.entryFile)
      })
    }
    if (artifact.mountUncertain) {
      diagnostics.push({
        code: 'artifact.mount-uncertain',
        severity: 'warning',
        title: 'Racine web de l’artefact à vérifier',
        detail: `Certaines ressources absolues de l’entrée ne correspondent à aucun fichier sous ${artifact.basePath}. La base locale la plus prudente a été montée, sans exécuter le build.`,
        file: posixRelative(normalizedRoot, artifact.entryFile)
      })
    }
  } else if (needsBuild) {
    diagnostics.push({
      code: 'build.required',
      severity: 'warning',
      title: 'Compilation locale requise',
      detail: 'Aucun artefact exploitable n’a été trouvé dans dist, build, out ou .output/public. Responsiver n’exécute aucun script automatiquement.',
      ...(sourceEntry ? { file: posixRelative(normalizedRoot, sourceEntry) } : {})
    })
  }

  if (!entryContext && !needsBuild) {
    diagnostics.push({
      code: 'html.entry-missing',
      severity: 'blocking',
      title: 'Entrée HTML introuvable',
      detail: 'Aucune page HTML locale ne peut être utilisée comme point de départ du rendu.'
    })
  }

  if (entryContext) {
    const visible = hasVisibleMarkup(entryContext.html)
    if (hasIncompleteStructure(entryContext.html)) {
      diagnostics.push({
        code: 'html.incomplete-document',
        severity: visible || entryRunnable ? 'warning' : 'blocking',
        title: 'Document HTML incomplet',
        detail: 'Des éléments structurels non fermés rendent l’interprétation de cette entrée ambiguë.',
        file: entryContext.relativeFile
      })
    }
    if (!visible && !entryRunnable) {
      diagnostics.push({
        code: 'html.no-visible-content',
        severity: 'blocking',
        title: 'Aucun contenu visible',
        detail: 'L’entrée ne contient ni contenu affichable ni script local exécutable capable de construire l’interface.',
        file: entryContext.relativeFile
      })
    }
  }

  const linkedStyleFiles = [...new Set(routeContexts.flatMap((context) => context.linkedStyles))]
  const emptyStyles = linkedStyleFiles.filter((file) => knownFiles.has(file) && !(cssCache.get(file) ?? '').trim())
  if (emptyStyles.length > 0) {
    diagnostics.push({
      code: 'css.empty',
      severity: 'warning',
      title: 'Feuille de style vide',
      detail: `${emptyStyles.length} feuille${emptyStyles.length > 1 ? 's' : ''} de style liée${emptyStyles.length > 1 ? 's sont vides' : ' est vide'}.`,
      file: posixRelative(normalizedRoot, emptyStyles[0])
    })
  }

  if (!entryRunnable) {
    const references = referencedLocalFiles(normalizedRoot, routeContexts, cssCache, absoluteBase)
    const unreferencedAssets = analysisFiles.filter((file) => mediaExtensions.has(extname(file).toLowerCase()) && !references.has(file))
    if (unreferencedAssets.length > 0) {
      diagnostics.push({
        code: 'assets.unreferenced',
        severity: 'warning',
        title: 'Ressources locales non utilisées',
        detail: `${unreferencedAssets.length} ressource${unreferencedAssets.length > 1 ? 's' : ''} média ne ${unreferencedAssets.length > 1 ? 'sont' : 'semble'} référencée${unreferencedAssets.length > 1 ? 's' : ''} par aucune route ou feuille de style analysée.`,
        file: posixRelative(normalizedRoot, unreferencedAssets[0])
      })
    }
  }

  if (truncated) {
    diagnostics.push({
      code: 'analysis.truncated',
      severity: 'warning',
      title: 'Analyse partielle',
      detail: `${analysisFiles.length} fichier${analysisFiles.length > 1 ? 's ont' : ' a'} été inventorié${analysisFiles.length > 1 ? 's' : ''}. Les limites locales de sécurité (${MAX_FILES} fichiers, ${MAX_MEDIA_FILES} médias, ${MAX_ROUTES} routes et ${MAX_STYLESHEETS} feuilles de style) ont empêché une couverture exhaustive.`
    })
  }

  const previewReadiness = makeReadiness(previewStrategy, diagnostics, needsBuild)
  reportProgress(options, 'preview', 5, 'Prévisualisation qualifiée', previewReadiness.summary)

  const includeInformationalDiagnostics = previewReadiness.status === 'blocked' || previewReadiness.status === 'needs-build'
  for (const diagnostic of diagnostics.filter((item) => includeInformationalDiagnostics || item.severity !== 'info')) {
    if (issues.length >= MAX_ISSUES || issues.some((issue) => issue.rule === diagnostic.code && issue.source?.file === diagnostic.file)) continue
    const diagnosticRoute = routeContexts.find((context) => context.relativeFile === diagnostic.file)?.route.path
      ?? entryContext?.route.path
    issues.push(issueFromDiagnostic(diagnostic, diagnosticRoute))
  }

  if (issues.length >= MAX_ISSUES) truncated = true

  const capabilities: ProjectCapabilities = {
    ...detectedCapabilities,
    interactive: previewReadiness.status === 'ready' || previewReadiness.status === 'degraded',
    staging: Boolean(entryFile) && detectedCapabilities.staging && (
      previewReadiness.status === 'ready' || previewReadiness.status === 'degraded'
    ),
    buildRequired: needsBuild,
    previewStrategy
  }
  const entryPath = entryFile
    ? `/${artifact ? posixRelative(artifact.root, entryFile) : posixRelative(normalizedRoot, entryFile)}`
    : null
  const consolidatedIssues = consolidateProjectIssues(issues, entryPath)
  const returnedIssues = prioritizeProjectIssues(consolidatedIssues, entryPath)
  if (returnedIssues.length < consolidatedIssues.length) truncated = true
  const routes = routeContexts
    .map((context) => context.route)
    .sort((left, right) => left.path === entryPath ? -1 : right.path === entryPath ? 1 : left.label.localeCompare(right.label, 'fr'))
  // Le thème du projet suit la route d’entrée. Une démo sombre rangée dans un
  // sous-dossier ne doit pas empêcher de proposer un thème sombre au vrai site.
  const theme = themeProfiles[0] ?? detectTheme('')

  const project: ProjectSnapshot = {
    id: `project-${createHash('sha256').update(normalizedRoot).digest('hex').slice(0, 12)}`,
    name: basename(normalizedRoot),
    root: normalizedRoot,
    kind: artifact
      ? detectedCapabilities.framework
        ? `Projet ${detectedCapabilities.framework} · artefact ${artifact.basePath}`
        : `Projet web local · artefact ${artifact.basePath}`
      : needsBuild
        ? detectedCapabilities.framework ? `Projet ${detectedCapabilities.framework} à compiler` : 'Projet web à compiler'
        : entryFile
          ? detectedCapabilities.framework ? `Projet ${detectedCapabilities.framework}` : 'Projet web local'
          : 'Dossier sans page HTML directement prévisualisable',
    files: new Set([...sourceFiles, ...analysisFiles]).size,
    analyzedAt: new Date().toISOString(),
    source: { kind: 'local-project', readOnly: false, url: null, localRoot: normalizedRoot, network: 'local-only' },
    issues: returnedIssues,
    previewHtml: null,
    previewOrigin: null,
    previewBasePath: artifact?.basePath ?? null,
    previewReadiness,
    entryPath,
    routes,
    theme,
    capabilities,
    analysis: { truncated, scannedFiles: analysisFiles.length, scannedStyles }
  }

  const finalPhase: ProjectPreparationProgress['phase'] = previewReadiness.status === 'blocked' || previewReadiness.status === 'needs-build'
    ? 'blocked'
    : 'ready'
  reportProgress(options, finalPhase, 5, finalPhase === 'ready' ? 'Projet prêt' : 'Préparation interrompue', previewReadiness.summary)
  return project
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
    source: { kind: 'local-project', readOnly: true, url: null, localRoot: 'Projet de démonstration local', network: 'local-only' },
    previewOrigin: null,
    previewBasePath: null,
    previewReadiness: {
      status: 'ready',
      strategy: 'static',
      summary: 'La démonstration locale est prête.',
      diagnostics: []
    },
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
      buildRequired: false,
      previewStrategy: 'static'
    },
    analysis: { truncated: false, scannedFiles: 4, scannedStyles: 1 }
  }
}
