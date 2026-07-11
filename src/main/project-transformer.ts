import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, extname, posix, resolve, sep } from 'node:path'
import postcss, { type Declaration, type Rule } from 'postcss'
import type {
  ProjectFix,
  ProjectSnapshot,
  StagingChange,
  StagingOutcome,
  StagingRequest,
  StagingSnapshot,
  ThemeMode,
  ThemeProfile,
  ThemeVariable
} from '../shared/contracts'
import { compileVisualEditCss } from '../shared/visual-editor'

export const GENERATED_STYLESHEET = '.responsiver/responsiver.generated.css'
const GENERATED_THEME_ATTRIBUTE = 'data-responsiver-generated-theme'
const GENERATED_INSTRUCTIONS_ATTRIBUTE = 'data-responsiver-generated-instructions'
const GENERATED_ROUTE_ATTRIBUTE = 'data-responsiver-route'
const GENERATED_FILE_HEADER = `/*
 * Généré localement par Responsiver.
 * Chaque règle reste lisible, exportable et réversible.
 */`

function routeScopedVisualSelector(selector: string, token: string): string {
  const routeAttribute = `[${GENERATED_ROUTE_ATTRIBUTE}="${token}"]`
  return /^html(?=$|[\s.#:>+~]|\[)/i.test(selector)
    ? selector.replace(/^html/i, `html${routeAttribute}`)
    : `html${routeAttribute} ${selector}`
}

export interface ProjectStaging {
  /** Chemins relatifs POSIX. Le projet source n’est jamais modifié. */
  overrides: Map<string, Buffer>
  snapshot: StagingSnapshot
}

export interface InstructionInterpretation {
  instruction: string
  recognized: boolean
  title?: string
  css?: string
  requestedTheme?: ThemeMode
}

interface CssReplacement {
  content: string
  before: string
  after: string
}

interface DiffOperation {
  type: 'context' | 'delete' | 'add'
  line: string
}

interface ThemePalette {
  background: string
  surface: string
  surfaceRaised: string
  text: string
  muted: string
  border: string
  accent: string
}

export interface ThemeGenerationAssessment {
  safe: boolean
  reason: string
  mappedRoles: ThemeVariable['role'][]
  contrast: { textOnBackground: number; textOnSurface: number; mutedOnBackground: number }
}

export class ThemeGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThemeGenerationError'
  }
}

const palettes: Record<ThemeMode, ThemePalette> = {
  light: {
    background: '#f4f2ec',
    surface: '#fbfaf6',
    surfaceRaised: '#ffffff',
    text: '#20211e',
    muted: '#65685f',
    border: '#c9c5bb',
    accent: '#b64d32'
  },
  dark: {
    background: '#171916',
    surface: '#21241f',
    surfaceRaised: '#292c27',
    text: '#f2f0e9',
    muted: '#abb0a5',
    border: '#454a42',
    accent: '#ec8060'
  }
}

const namedColors: Record<string, string> = {
  'bleu nuit': '#24435d',
  bleu: '#2764ae',
  cyan: '#168397',
  emeraude: '#247457',
  jade: '#247457',
  jaune: '#b77913',
  orange: '#c15a2e',
  rose: '#b94f72',
  rouge: '#b74538',
  terracotta: '#b64d32',
  vert: '#367252',
  violet: '#7453a6'
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function changeId(...parts: string[]): string {
  return `change-${digest(parts.join('\u001f')).slice(0, 16)}`
}

function normalizeInstruction(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSelector(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\s*([>,+~])\s*/g, '$1').trim()
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized === '.' || normalized.split('/').includes('..')) {
    throw new Error(`Chemin de staging invalide : ${value}`)
  }
  return normalized
}

function absoluteProjectPath(root: string, relativePath: string): string {
  const normalizedRoot = resolve(root)
  const absolute = resolve(normalizedRoot, normalizeRelativePath(relativePath))
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`Chemin hors projet refusé : ${relativePath}`)
  }
  return absolute
}

async function guardedProjectPath(root: string, relativePath: string): Promise<{ path: string; exists: boolean }> {
  const realRoot = await fs.realpath(root)
  const absolute = absoluteProjectPath(realRoot, relativePath)
  try {
    const realFile = await fs.realpath(absolute)
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) {
      throw new Error(`Lien symbolique hors projet refusé : ${relativePath}`)
    }
    return { path: realFile, exists: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let parent = dirname(absolute)
  while (parent !== dirname(parent)) {
    try {
      const realParent = await fs.realpath(parent)
      if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
        throw new Error(`Dossier symbolique hors projet refusé : ${relativePath}`)
      }
      return { path: absolute, exists: false }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      parent = dirname(parent)
    }
  }
  throw new Error(`Parent du fichier introuvable dans le projet : ${relativePath}`)
}

function themeAlreadyExists(theme: ThemeProfile, target: ThemeMode): boolean {
  return target === 'dark' ? theme.hasDark : theme.hasLight
}

export function suggestedComplementaryTheme(theme: ThemeProfile): ThemeMode | null {
  if (theme.hasDark && !theme.hasLight) return 'light'
  if (theme.hasLight && !theme.hasDark) return 'dark'
  // Sans thème source fiable, une palette complémentaire ne peut pas préserver
  // avec assez de certitude les surfaces, le texte et l'identité de marque.
  if (!theme.hasDark && !theme.hasLight) return null
  return null
}

function extractRequestedTheme(instruction: string): ThemeMode | undefined {
  const normalized = normalizeInstruction(instruction)
  if (/(?:theme|mode|version|fond).*(?:sombre|noir)|(?:sombre|dark mode)/.test(normalized)) return 'dark'
  if (/(?:theme|mode|version|fond).*(?:clair|blanc)|(?:clair|light mode)/.test(normalized)) return 'light'
  return undefined
}

function findInstructionColor(instruction: string): string | null {
  const hex = instruction.match(/#[\da-f]{3,8}\b/i)?.[0]
  if (hex) return hex
  const normalized = normalizeInstruction(instruction)
  for (const [name, value] of Object.entries(namedColors)) {
    if (new RegExp(`(?:^|\\s)${name.replace(' ', '\\s+')}(?:$|\\s|[.,;])`).test(normalized)) return value
  }
  return null
}

export function interpretLocalInstruction(instruction: string): InstructionInterpretation {
  const normalized = normalizeInstruction(instruction)
  const requestedBreakpoint = Number(normalized.match(/(\d{3,4})\s*px/)?.[1] ?? 768)
  const responsiveBreakpoint = Math.min(2_560, Math.max(320, Number.isFinite(requestedBreakpoint) ? requestedBreakpoint : 768))
  const requestedSelector = instruction.match(/\bcible\s+((?:[a-z][\w-]*)?(?:[.#][\w-]+){1,4}|[a-z][\w-]*)/i)?.[1] ?? null
  const requestedTheme = extractRequestedTheme(instruction)
  if (requestedTheme) {
    return {
      instruction,
      recognized: true,
      title: requestedTheme === 'dark' ? 'Créer la variante sombre' : 'Créer la variante claire',
      requestedTheme
    }
  }

  if (/(?:accent|couleur|bouton|lien|marque)/.test(normalized)) {
    const color = findInstructionColor(instruction)
    if (color) {
      return {
        instruction,
        recognized: true,
        title: `Ajuster la couleur d’accent (${color})`,
        css: `:root {\n  --responsiver-accent: ${color};\n}\n\n:where(a) {\n  color: var(--responsiver-accent);\n}\n\n:where(button, [role="button"], .button, .btn) {\n  background-color: var(--responsiver-accent);\n  border-color: var(--responsiver-accent);\n  accent-color: var(--responsiver-accent);\n}`
      }
    }
  }

  if (/(?:angle(?:s)? droit|sans arrondi|retir(?:e|er).*arrondi|rayon.*(?:zero|0))/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Retirer les arrondis d’interface',
      css: ':where(button, input, select, textarea, dialog, [class*="card" i], [class*="panel" i], [class*="modal" i]) {\n  border-radius: 0 !important;\n}'
    }
  }

  if (/(?:plus arrondi|davantage arrondi|arrondi(?:s)? plus|adoucir.*angle)/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Adoucir les composants',
      css: ':where(button, input, select, textarea, dialog, [class*="card" i], [class*="panel" i], [class*="modal" i]) {\n  border-radius: 0.875rem !important;\n}'
    }
  }

  if (/(?:titre|hero|headline).*(?:born|limit|disproportion|mobile)|(?:born|limit).*(?:titre|hero|headline)/.test(normalized)) {
    const titleSelector = requestedSelector ?? 'h1, [class*="title" i], [class*="headline" i], [class*="hero" i] h1'
    return {
      instruction,
      recognized: true,
      title: 'Borner les grands titres sur mobile',
      css: `@media (max-width: ${responsiveBreakpoint}px) {\n  :where(${titleSelector}) {\n    font-size: clamp(2.25rem, 11vw, 4.25rem) !important;\n    line-height: 1 !important;\n    overflow-wrap: anywhere;\n  }\n}`
    }
  }

  if (/(?:texte|typographie|police).*(?:plus grand|agrand|gross)|augment.*(?:texte|typographie|police)/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Augmenter l’échelle typographique',
      css: 'html {\n  font-size: 106.25%;\n}'
    }
  }

  if (/(?:texte|typographie|police).*(?:plus petit|redui|diminu)|diminu.*(?:texte|typographie|police)/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Réduire l’échelle typographique',
      css: 'html {\n  font-size: 93.75%;\n}'
    }
  }

  if (/(?:plus compact|densifier|moins d'espace|redui.*espacement|interface compacte)/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Densifier les commandes',
      css: ':where(button, input, select, textarea, [role="button"]) {\n  min-height: 2.25rem;\n  padding-block: 0.45rem;\n}\n\n:where(nav, [class*="toolbar" i], [class*="actions" i]) {\n  gap: 0.5rem;\n}'
    }
  }

  if (/(?:plus aer|davantage d'espace|augment.*espacement|respirer davantage)/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Aérer les sections principales',
      css: ':where(main > section, [class*="section" i], [class*="container" i]) {\n  padding-block: clamp(2rem, 6vw, 5rem);\n}\n\n:where(nav, [class*="toolbar" i], [class*="actions" i]) {\n  gap: 1rem;\n}'
    }
  }

  if (/(?:navigation|menu|liens?).*(?:rangee|defil|scroll)|(?:rangee|defil|scroll).*(?:navigation|menu)/.test(normalized)) {
    const navigationRoots = requestedSelector
      ? `${requestedSelector}, ${requestedSelector} > ul, ${requestedSelector} > ol`
      : 'nav, nav > ul, nav > ol, [role="navigation"], [role="navigation"] > ul, [role="navigation"] > ol'
    const navigationContainers = requestedSelector
      ? `${requestedSelector} > ul, ${requestedSelector} > ol, ${requestedSelector}:not(:has(> ul, > ol))`
      : 'nav > ul, nav > ol, nav:not(:has(> ul, > ol)), [role="navigation"] > ul, [role="navigation"] > ol, [role="navigation"]:not(:has(> ul, > ol))'
    const navigationItems = requestedSelector
      ? `${requestedSelector} > a, ${requestedSelector} > button, ${requestedSelector} > ul > li > a, ${requestedSelector} > ul > li > button, ${requestedSelector} > ol > li > a, ${requestedSelector} > ol > li > button`
      : 'nav > a, nav > button, nav > ul > li > a, nav > ul > li > button, nav > ol > li > a, nav > ol > li > button, [role="navigation"] > a, [role="navigation"] > button, [role="navigation"] > ul > li > a, [role="navigation"] > ul > li > button, [role="navigation"] > ol > li > a, [role="navigation"] > ol > li > button'
    return {
      instruction,
      recognized: true,
      title: 'Stabiliser la navigation mobile',
      css: `@media (max-width: ${responsiveBreakpoint}px) {\n  :where(${navigationRoots}) {\n    min-inline-size: 0 !important;\n    max-inline-size: 100%;\n  }\n\n  :where(${navigationContainers}) {\n    flex-wrap: nowrap !important;\n    overflow-x: auto;\n    overscroll-behavior-inline: contain;\n    scrollbar-width: thin;\n  }\n\n  :where(${navigationItems}) {\n    flex: 0 0 auto;\n    min-block-size: 2.75rem;\n  }\n}`
    }
  }

  if (/(?:navigation|menu|liens?).*(?:retour|ligne|wrap|debord)|(?:retour|ligne|wrap).*(?:navigation|menu)/.test(normalized)) {
    return {
      instruction,
      recognized: true,
      title: 'Autoriser le retour à la ligne de la navigation',
      css: '@media (max-width: 640px) {\n  :where(nav, nav ul, [class*="nav" i], [class*="menu" i]) {\n    flex-wrap: wrap !important;\n    white-space: normal !important;\n  }\n}'
    }
  }

  return { instruction, recognized: false }
}

function instructionCssTargets(css: string): Array<{ target: string; value: string }> {
  const targets: Array<{ target: string; value: string }> = []
  const root = postcss.parse(css)
  root.walkDecls((declaration) => {
    let selector = ''
    const contexts: string[] = []
    let parent = declaration.parent
    while (parent && parent.type !== 'root') {
      if (parent.type === 'rule' && !selector) selector = normalizeSelector(parent.selector)
      if (parent.type === 'atrule') contexts.push(`@${parent.name} ${parent.params}`.trim())
      parent = parent.parent
    }
    targets.push({
      target: [...contexts.reverse(), selector, declaration.prop.toLowerCase()].join('\u001f'),
      value: `${declaration.value.trim()}${declaration.important ? ' !important' : ''}`
    })
  })
  return targets
}

function parseRgb(value: string): [number, number, number] | null {
  const source = value.trim()
  const hex = source.match(/^#([\da-f]{3,8})$/i)?.[1]
  if (hex) {
    const normalized = hex.length === 3 || hex.length === 4
      ? hex.slice(0, 3).split('').map((part) => `${part}${part}`).join('')
      : hex.slice(0, 6)
    if (/^[\da-f]{6}$/i.test(normalized)) {
      return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number]
    }
  }
  const rgb = source.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*\d+(?:\.\d+)?)?\s*\)$/i)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

function relativeLuminance(value: string): number | null {
  const rgb = parseRgb(value)
  if (!rgb) return null
  const [red, green, blue] = rgb
    .map((component) => Math.min(255, component) / 255)
    .map((component) => component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  if (firstLuminance === null || secondLuminance === null) return 0
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function valueForRole(variable: ThemeVariable, palette: ThemePalette): string | null {
  switch (variable.role) {
    case 'background': return palette.background
    case 'surface': return /(?:raised|elevated|popover)/i.test(variable.name) ? palette.surfaceRaised : palette.surface
    case 'text': return palette.text
    case 'muted': return palette.muted
    case 'border': return palette.border
    // Les accents, logos et couleurs de marque sont laissés intacts. Si leur
    // usage textuel n'est pas compatible avec la nouvelle surface, le contrôle
    // visuel doit le signaler au lieu de recolorer silencieusement la marque.
    case 'accent': return null
    case 'unknown': return null
  }
}

function resolvedThemeColor(variable: ThemeVariable, variables: ThemeVariable[], visited = new Set<string>()): string | null {
  if (parseRgb(variable.value)) return variable.value
  const reference = variable.value.match(/var\(\s*(--[\w-]+)/)?.[1]
  if (!reference || visited.has(reference)) return null
  const next = variables.find((candidate) => candidate.name === reference)
  if (!next) return null
  const nextVisited = new Set(visited)
  nextVisited.add(reference)
  return resolvedThemeColor(next, variables, nextVisited)
}

export function assessComplementaryTheme(project: ProjectSnapshot, target: ThemeMode): ThemeGenerationAssessment {
  const palette = palettes[target]
  const contrast = {
    textOnBackground: contrastRatio(palette.text, palette.background),
    textOnSurface: contrastRatio(palette.text, palette.surface),
    mutedOnBackground: contrastRatio(palette.muted, palette.background)
  }
  const mapped = project.theme.variables.filter((variable) =>
    variable.role !== 'unknown' && variable.role !== 'accent' && Boolean(resolvedThemeColor(variable, project.theme.variables)))
  const mappedRoles = [...new Set(mapped.map((variable) => variable.role))]
  const hasSurfaceFoundation = mappedRoles.includes('background') && mappedRoles.includes('text')
  const palettePasses = contrast.textOnBackground >= 4.5 && contrast.textOnSurface >= 4.5 && contrast.mutedOnBackground >= 4.5

  if (themeAlreadyExists(project.theme, target)) {
    return { safe: false, reason: `La variante ${target === 'dark' ? 'sombre' : 'claire'} existe déjà.`, mappedRoles, contrast }
  }
  if (project.theme.detected === 'unknown') {
    return { safe: false, reason: 'Le thème source n’est pas assez fiable pour générer une variante sans risque visuel.', mappedRoles, contrast }
  }
  if (!hasSurfaceFoundation) {
    return {
      safe: false,
      reason: 'Génération refusée : aucun couple fiable de rôles fond/texte n’a été identifié. Les images et couleurs de marque restent inchangées.',
      mappedRoles,
      contrast
    }
  }
  if (!palettePasses) {
    return { safe: false, reason: 'Génération refusée : la palette déterministe ne satisfait pas les contrastes requis.', mappedRoles, contrast }
  }
  return { safe: true, reason: 'Rôles fond/texte identifiés et contrastes vérifiés.', mappedRoles, contrast }
}

function enrichAccentInstruction(css: string, variables: ThemeVariable[]): string {
  const color = css.match(/--responsiver-accent\s*:\s*([^;]+)/)?.[1]?.trim()
  if (!color) return css
  const semanticOverrides = [...new Map(variables
    .filter((variable) => variable.role === 'accent' && !variable.name.startsWith('--responsiver-'))
    .map((variable) => [variable.name, variable])).values()]
    .map((variable) => `  ${variable.name}: ${color};`)
  if (semanticOverrides.length === 0) return css
  return `${css}\n\n:root {\n${semanticOverrides.join('\n')}\n}`
}

export function generateComplementaryThemeCss(project: ProjectSnapshot, target: ThemeMode): string {
  const assessment = assessComplementaryTheme(project, target)
  if (!assessment.safe) throw new ThemeGenerationError(assessment.reason)
  const palette = palettes[target]
  const semanticVariables = project.theme.variables.filter((variable) =>
    variable.role !== 'unknown' && variable.role !== 'accent' && Boolean(resolvedThemeColor(variable, project.theme.variables)))
  const declarations = semanticVariables
    .map((variable) => {
      const value = valueForRole(variable, palette)
      return value ? `  ${variable.name}: ${value};` : null
    })
    .filter((value): value is string => Boolean(value))

  const variableBlock = declarations.length > 0 ? `\n${declarations.join('\n')}` : ''
  const themeSelector = `html[${GENERATED_THEME_ATTRIBUTE}="${target}"]`
  return `/* Variante ${target === 'dark' ? 'sombre' : 'claire'} déterministe — Responsiver
 * Contrastes vérifiés : texte/fond ${assessment.contrast.textOnBackground.toFixed(2)}:1 ; texte/surface ${assessment.contrast.textOnSurface.toFixed(2)}:1.
 * Les images, filtres et couleurs de marque ne sont jamais modifiés automatiquement.
 */
${themeSelector} {
  color-scheme: ${target};
  --responsiver-background: ${palette.background};
  --responsiver-surface: ${palette.surface};
  --responsiver-surface-raised: ${palette.surfaceRaised};
  --responsiver-text: ${palette.text};
  --responsiver-muted: ${palette.muted};
  --responsiver-border: ${palette.border};
  --responsiver-accent: ${palette.accent};${variableBlock}
}

${themeSelector},
${themeSelector} body {
  background-color: var(--responsiver-background);
  color: var(--responsiver-text);
}

${themeSelector} :where(input, select, textarea) {
  color-scheme: ${target};
}`
}

function scopeInstructionCss(css: string): string {
  let root
  try {
    root = postcss.parse(css)
  } catch {
    return css
  }
  const rootSelector = `html[${GENERATED_INSTRUCTIONS_ATTRIBUTE}]`
  root.walkRules((rule) => {
    rule.selectors = rule.selectors.map((selector) => {
      const trimmed = selector.trim()
      if (trimmed === ':root' || trimmed === 'html') return rootSelector
      if (trimmed.startsWith(':root')) return trimmed.replace(/^:root/, rootSelector)
      if (trimmed.startsWith('html')) return trimmed.replace(/^html/, rootSelector)
      if (trimmed.startsWith('body')) return `${rootSelector} ${trimmed}`
      return `${rootSelector} ${trimmed}`
    })
  })
  return root.toString()
}

function insertViewport(html: string): string | null {
  if (/<meta\s+[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html)) return null
  const meta = '<meta name="viewport" content="width=device-width, initial-scale=1">'
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n    ${meta}`)
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n<head>\n    ${meta}\n</head>`)
  }
  return `<head>\n    ${meta}\n</head>\n${html}`
}

function replaceCssDeclaration(css: string, fix: ProjectFix, preferredLine?: number): CssReplacement | null {
  if (!fix.selector || !fix.property || fix.before === undefined || fix.after === undefined) return null
  let root
  try {
    root = postcss.parse(css)
  } catch {
    return null
  }

  const expectedSelector = normalizeSelector(fix.selector)
  const candidates: Declaration[] = []
  root.walkDecls((declaration) => {
    if (declaration.prop.toLowerCase() !== fix.property?.toLowerCase()) return
    if (declaration.value.trim() !== fix.before?.trim()) return
    const parent = declaration.parent
    if (parent?.type !== 'rule' || normalizeSelector((parent as Rule).selector) !== expectedSelector) return
    candidates.push(declaration)
  })
  if (candidates.length === 0) return null
  candidates.sort((left, right) => {
    const leftLine = left.source?.start?.line ?? 1
    const rightLine = right.source?.start?.line ?? 1
    return preferredLine === undefined ? leftLine - rightLine : Math.abs(leftLine - preferredLine) - Math.abs(rightLine - preferredLine)
  })
  const declaration = candidates[0]
  const important = declaration.important ? ' !important' : ''
  const before = `${fix.selector} { ${declaration.prop}: ${declaration.value}${important}; }`
  declaration.value = fix.after
  const after = `${fix.selector} { ${declaration.prop}: ${declaration.value}${important}; }`
  return { content: root.toString(), before, after }
}

function replaceEmbeddedCss(html: string, fix: ProjectFix): CssReplacement | null {
  let replacement: CssReplacement | null = null
  const content = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (full, opening: string, css: string, closing: string) => {
    if (replacement) return full
    const result = replaceCssDeclaration(css, fix)
    if (!result) return full
    replacement = result
    return `${opening}${result.content}${closing}`
  })
  if (!replacement) return null
  const applied = replacement as CssReplacement
  return { content, before: applied.before, after: applied.after }
}

function mediaOverride(fix: ProjectFix): string | null {
  if (!fix.selector || !fix.property || !fix.after) return null
  const breakpoint = Math.max(240, Math.min(2_560, fix.breakpoint ?? 640))
  return `@media (max-width: ${breakpoint}px) {\n  ${fix.selector} {\n    ${fix.property}: ${fix.after} !important;\n  }\n}`
}

function stylesheetHref(htmlFile: string, stylesheet: string): string {
  const relativePath = posix.relative(posix.dirname(htmlFile), stylesheet)
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

function htmlFileForRoute(project: ProjectSnapshot, routePath: string): string | null {
  const route = project.routes.find((candidate) => candidate.path === routePath)
  const source = route?.sourcePath ?? routePath.replace(/^\//, '')
  return source && ['.html', '.htm'].includes(extname(source).toLowerCase())
    ? normalizeRelativePath(source)
    : null
}

function insertStylesheetLink(html: string, stylesheet: string, htmlFile: string): string | null {
  const href = stylesheetHref(htmlFile, stylesheet)
  if (html.includes(href)) return null
  const link = `<link rel="stylesheet" href="${href}" data-responsiver-generated>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `  ${link}\n</head>`)
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${link}`)
  return `${link}\n${html}`
}

function setHtmlAttribute(html: string, name: string, value?: string): string | null {
  const expression = new RegExp(`\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'i')
  const serialized = value === undefined ? name : `${name}="${value}"`
  if (/<html\b[^>]*>/i.test(html)) {
    const next = html.replace(/<html\b[^>]*>/i, (tag) => expression.test(tag)
      ? tag.replace(expression, ` ${serialized}`)
      : tag.replace(/>$/, ` ${serialized}>`))
    return next === html ? null : next
  }
  return `<html ${serialized}>\n${html}\n</html>`
}

function splitLines(value: string): string[] {
  const lines = value.split('\n')
  if (value.endsWith('\n')) lines.pop()
  return lines
}

function diffOperations(before: string, after: string): DiffOperation[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) suffix += 1

  const operations: DiffOperation[] = oldLines.slice(0, prefix).map((line) => ({ type: 'context', line }))
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)

  if (oldMiddle.length * newMiddle.length > 750_000) {
    operations.push(...oldMiddle.map((line): DiffOperation => ({ type: 'delete', line })))
    operations.push(...newMiddle.map((line): DiffOperation => ({ type: 'add', line })))
  } else {
    const width = newMiddle.length + 1
    const table = new Uint32Array((oldMiddle.length + 1) * width)
    for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex -= 1) {
        const position = oldIndex * width + newIndex
        table[position] = oldMiddle[oldIndex] === newMiddle[newIndex]
          ? table[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(table[(oldIndex + 1) * width + newIndex], table[oldIndex * width + newIndex + 1])
      }
    }

    let oldIndex = 0
    let newIndex = 0
    while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
      if (oldIndex < oldMiddle.length && newIndex < newMiddle.length && oldMiddle[oldIndex] === newMiddle[newIndex]) {
        operations.push({ type: 'context', line: oldMiddle[oldIndex] })
        oldIndex += 1
        newIndex += 1
      } else if (
        newIndex < newMiddle.length &&
        (oldIndex >= oldMiddle.length || table[oldIndex * width + newIndex + 1] >= table[(oldIndex + 1) * width + newIndex])
      ) {
        operations.push({ type: 'add', line: newMiddle[newIndex] })
        newIndex += 1
      } else {
        operations.push({ type: 'delete', line: oldMiddle[oldIndex] })
        oldIndex += 1
      }
    }
  }

  operations.push(...oldLines.slice(oldLines.length - suffix).map((line): DiffOperation => ({ type: 'context', line })))
  if (before.endsWith('\n') !== after.endsWith('\n')) {
    const lastIndex = operations.length - 1
    const last = operations[lastIndex]
    if (last?.type === 'context') {
      operations.splice(lastIndex, 1, { type: 'delete', line: last.line }, { type: 'add', line: last.line })
    }
  }
  return operations
}

function formatRange(start: number, count: number): string {
  if (count === 1) return String(start)
  return `${start},${count}`
}

function unifiedFileDiff(path: string, before: string | null, after: string): string {
  if (before === after) return ''
  if (before === null || before.length === 0) {
    const lines = splitLines(after)
    const patchLines = [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.flatMap((line, index) => index === lines.length - 1 && !after.endsWith('\n')
        ? [`+${line}`, '\\ No newline at end of file']
        : [`+${line}`]),
      ''
    ]
    return patchLines.join('\n')
  }

  const operations = diffOperations(before, after)
  const changedIndexes = operations
    .map((operation, index) => operation.type === 'context' ? -1 : index)
    .filter((index) => index >= 0)
  if (changedIndexes.length === 0) return ''

  const clusters: Array<{ first: number; last: number }> = []
  for (const index of changedIndexes) {
    const current = clusters.at(-1)
    if (!current || index - current.last > 7) clusters.push({ first: index, last: index })
    else current.last = index
  }

  const lines = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`
  ]
  for (const cluster of clusters) {
    const startIndex = Math.max(0, cluster.first - 3)
    const endIndex = Math.min(operations.length, cluster.last + 4)
    const hunk = operations.slice(startIndex, endIndex)
    let oldStart = 1
    let newStart = 1
    for (const operation of operations.slice(0, startIndex)) {
      if (operation.type !== 'add') oldStart += 1
      if (operation.type !== 'delete') newStart += 1
    }
    const oldCount = hunk.filter((operation) => operation.type !== 'add').length
    const newCount = hunk.filter((operation) => operation.type !== 'delete').length
    if (oldCount === 0) oldStart -= 1
    if (newCount === 0) newStart -= 1
    lines.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`)
    let oldLine = oldStart
    let newLine = newStart
    const oldTotal = splitLines(before).length
    const newTotal = splitLines(after).length
    for (const operation of hunk) {
      lines.push(`${operation.type === 'context' ? ' ' : operation.type === 'delete' ? '-' : '+'}${operation.line}`)
      const touchesOldEnd = operation.type !== 'add' && oldLine === oldTotal
      const touchesNewEnd = operation.type !== 'delete' && newLine === newTotal
      if ((touchesOldEnd && !before.endsWith('\n')) || (touchesNewEnd && !after.endsWith('\n'))) {
        lines.push('\\ No newline at end of file')
      }
      if (operation.type !== 'add') oldLine += 1
      if (operation.type !== 'delete') newLine += 1
    }
  }
  lines.push('')
  return lines.join('\n')
}

async function availableGeneratedPath(root: string, previewBasePath: string | null): Promise<{ path: string; existing: string | null }> {
  const generatedDirectory = previewBasePath
    ? `${normalizeRelativePath(previewBasePath)}/.responsiver`
    : '.responsiver'
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0
      ? `${generatedDirectory}/responsiver.generated.css`
      : `${generatedDirectory}/responsiver.generated.${index}.css`
    const state = await guardedProjectPath(root, candidate)
    if (!state.exists) return { path: candidate, existing: null }
    const metadata = await fs.stat(state.path).catch(() => null)
    if (!metadata?.isFile() || metadata.size > 4 * 1024 * 1024) continue
    const existing = await fs.readFile(state.path, 'utf8').catch(() => null)
    if (existing?.startsWith(GENERATED_FILE_HEADER)) return { path: candidate, existing }
  }
  throw new Error('Impossible de réserver un nom pour la feuille Responsiver.')
}

export async function buildProjectStaging(
  root: string,
  project: ProjectSnapshot,
  request: StagingRequest
): Promise<ProjectStaging> {
  const normalizedRoot = await fs.realpath(root)
  const originals = new Map<string, Buffer | null>()
  const currentTexts = new Map<string, string>()
  const overrides = new Map<string, Buffer>()
  const changes: StagingChange[] = []
  const outcomes: StagingOutcome[] = []
  const generatedSections: string[] = []
  const generatedOperations = new Set<string>()
  const operationChangeIds = new Map<string, string[]>()
  const generatedRoutePaths = new Set<string>()
  const generatedRouteTokens = new Map<string, string>()
  const recognizedInstructions: string[] = []
  const ignoredInstructions: string[] = []
  let generatedTheme: ThemeMode | null = null
  let hasGeneratedInstructions = false
  let hasGeneratedGlobalVisual = false

  async function originalBuffer(path: string): Promise<Buffer | null> {
    const relativePath = normalizeRelativePath(path)
    if (originals.has(relativePath)) return originals.get(relativePath) ?? null
    const state = await guardedProjectPath(normalizedRoot, relativePath)
    if (!state.exists) {
      originals.set(relativePath, null)
      return null
    }
    const buffer = await fs.readFile(state.path)
    originals.set(relativePath, buffer)
    return buffer
  }

  async function currentText(path: string): Promise<string> {
    const relativePath = normalizeRelativePath(path)
    const existing = currentTexts.get(relativePath)
    if (existing !== undefined) return existing
    const original = await originalBuffer(relativePath)
    if (!original) throw new Error(`Fichier source introuvable : ${relativePath}`)
    const value = original.toString('utf8')
    currentTexts.set(relativePath, value)
    return value
  }

  function setText(path: string, value: string): void {
    const relativePath = normalizeRelativePath(path)
    currentTexts.set(relativePath, value)
    overrides.set(relativePath, Buffer.from(value, 'utf8'))
  }

  const requestedIssueIds = [...new Set(request.issueIds)]
  const acceptedIssues = new Set(requestedIssueIds)
  const issueById = new Map(project.issues.map((issue) => [issue.id, issue]))
  const sourceIdentityFor = (issue: ProjectSnapshot['issues'][number]): string => issue.source
    ? `${normalizeRelativePath(issue.source.file)}:${issue.source.line}`
    : 'source-inconnue'
  const operationKeyFor = (issue: ProjectSnapshot['issues'][number]): string => {
    const fix = issue.fix!
    return [fix.kind, normalizeRelativePath(fix.file), sourceIdentityFor(issue), normalizeSelector(fix.selector ?? ''), fix.property, fix.before, fix.after, fix.breakpoint].join('\u001f')
  }
  const targetKeyFor = (issue: ProjectSnapshot['issues'][number]): string => {
    const fix = issue.fix!
    return fix.kind === 'html-insert'
      ? `${normalizeRelativePath(fix.file)}\u001f${sourceIdentityFor(issue)}\u001fhead`
      : [normalizeRelativePath(fix.file), sourceIdentityFor(issue), normalizeSelector(fix.selector ?? ''), fix.property, fix.breakpoint].join('\u001f')
  }
  const candidatesByTarget = new Map<string, Array<{ issueId: string; operationKey: string }>>()
  const conflictingIssueIds = new Set<string>()

  for (const issueId of requestedIssueIds) {
    const issue = issueById.get(issueId)
    if (!issue) {
      outcomes.push({ proposalId: issueId, findingIds: [issueId], kind: 'issue', status: 'skipped', changeIds: [], reason: 'Le constat n’existe plus dans cette analyse.' })
      continue
    }
    if (!issue.fix || issue.fix.kind === 'manual') {
      outcomes.push({ proposalId: issueId, findingIds: [issueId], kind: 'issue', status: 'skipped', changeIds: [], reason: 'Aucune transformation automatique sûre n’est définie pour ce constat.' })
      continue
    }
    const targetKey = targetKeyFor(issue)
    const entries = candidatesByTarget.get(targetKey) ?? []
    entries.push({ issueId, operationKey: operationKeyFor(issue) })
    candidatesByTarget.set(targetKey, entries)
  }

  for (const entries of candidatesByTarget.values()) {
    if (new Set(entries.map((entry) => entry.operationKey)).size <= 1) continue
    for (const entry of entries) conflictingIssueIds.add(entry.issueId)
  }
  for (const issueId of conflictingIssueIds) {
    outcomes.push({ proposalId: issueId, findingIds: [issueId], kind: 'issue', status: 'conflict', changeIds: [], reason: 'Une autre proposition modifie la même cible avec une valeur différente.' })
  }

  for (const issue of project.issues) {
    if (!acceptedIssues.has(issue.id) || !issue.fix || issue.fix.kind === 'manual' || conflictingIssueIds.has(issue.id)) continue
    const fix = issue.fix
    const operationKey = operationKeyFor(issue)
    if (fix.kind === 'css-media-override') generatedRoutePaths.add(issue.routePath ?? project.entryPath ?? '')
    if (generatedOperations.has(operationKey)) {
      outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'applied', changeIds: operationChangeIds.get(operationKey) ?? [], reason: 'Transformation identique regroupée avec une autre proposition.' })
      continue
    }

    if (fix.kind === 'html-insert') {
      const beforeContent = await currentText(fix.file)
      const afterContent = insertViewport(beforeContent)
      if (!afterContent || afterContent === beforeContent) {
        outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'skipped', changeIds: [], reason: 'La cible HTML est déjà corrigée ou n’existe plus.' })
        continue
      }
      setText(fix.file, afterContent)
      generatedOperations.add(operationKey)
      const change: StagingChange = {
        id: changeId(issue.id, operationKey),
        title: issue.title,
        file: normalizeRelativePath(fix.file),
        kind: 'html',
        before: 'Balise viewport absente',
        after: '<meta name="viewport" content="width=device-width, initial-scale=1">',
        confidence: fix.confidence
      }
      changes.push(change)
      operationChangeIds.set(operationKey, [change.id])
      outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'applied', changeIds: [change.id], reason: 'Transformation HTML préparée.' })
      continue
    }

    if (fix.kind === 'css-replace') {
      const beforeContent = await currentText(fix.file)
      const extension = extname(fix.file).toLowerCase()
      const replacement = ['.html', '.htm'].includes(extension)
        ? replaceEmbeddedCss(beforeContent, fix)
        : replaceCssDeclaration(beforeContent, fix, issue.source?.line)
      if (!replacement || replacement.content === beforeContent) {
        outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'skipped', changeIds: [], reason: 'La déclaration ciblée a changé ou n’existe plus.' })
        continue
      }
      setText(fix.file, replacement.content)
      generatedOperations.add(operationKey)
      const change: StagingChange = {
        id: changeId(issue.id, operationKey),
        title: issue.title,
        file: normalizeRelativePath(fix.file),
        kind: extension === '.html' || extension === '.htm' ? 'html' : 'css',
        before: replacement.before,
        after: replacement.after,
        confidence: fix.confidence
      }
      changes.push(change)
      operationChangeIds.set(operationKey, [change.id])
      outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'applied', changeIds: [change.id], reason: 'Remplacement CSS préparé.' })
      continue
    }

    if (fix.kind === 'css-media-override') {
      const css = mediaOverride(fix)
      if (!css) {
        outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'skipped', changeIds: [], reason: 'La media query ne peut plus être générée avec ces paramètres.' })
        continue
      }
      generatedOperations.add(operationKey)
      generatedSections.push(`/* ${issue.rule} · ${issue.source?.file ?? fix.file}:${issue.source?.line ?? 1} */\n${css}`)
      const change: StagingChange = {
        id: changeId(issue.id, operationKey),
        title: issue.title,
        file: GENERATED_STYLESHEET,
        kind: 'css',
        before: `${fix.selector ?? ''} { ${fix.property ?? ''}: ${fix.before ?? ''}; }`,
        after: css,
        confidence: fix.confidence
      }
      changes.push(change)
      operationChangeIds.set(operationKey, [change.id])
      outcomes.push({ proposalId: issue.id, findingIds: [issue.id], kind: 'issue', status: 'applied', changeIds: [change.id], reason: 'Surcharge responsive préparée.' })
    }
  }

  const visualCompilation = compileVisualEditCss(request.visualEdits ?? [])
  for (const invalid of visualCompilation.invalid) {
    outcomes.push({ proposalId: invalid.operationId, findingIds: [], kind: 'visual', status: 'conflict', changeIds: [], reason: invalid.reason })
  }
  for (const conflict of visualCompilation.conflicts) {
    for (const operationId of conflict.operationIds) {
      outcomes.push({ proposalId: operationId, findingIds: [], kind: 'visual', status: 'conflict', changeIds: [], reason: conflict.reason })
    }
  }
  for (const operationId of visualCompilation.skipped) {
    outcomes.push({ proposalId: operationId, findingIds: [], kind: 'visual', status: 'skipped', changeIds: [], reason: 'Modification visuelle identique regroupée.' })
  }
  for (const operation of visualCompilation.operations) {
    let persistedOperation = operation
    if (operation.route.kind === 'current') {
      const htmlFile = htmlFileForRoute(project, operation.route.path)
      if (!htmlFile) {
        outcomes.push({ proposalId: operation.id, findingIds: [], kind: 'visual', status: 'conflict', changeIds: [], reason: 'Cette route dynamique ne possède pas de page HTML distincte. Utilisez la portée « Toutes les pages » ou reliez la règle dans le composant du framework.' })
        continue
      }
      const token = `route-${digest(operation.route.path).slice(0, 10)}`
      const existingToken = generatedRouteTokens.get(htmlFile)
      if (existingToken && existingToken !== token) {
        outcomes.push({ proposalId: operation.id, findingIds: [], kind: 'visual', status: 'conflict', changeIds: [], reason: 'Plusieurs routes dynamiques partagent la même page HTML. Utilisez une portée globale ou modifiez le composant source dans Code.' })
        continue
      }
      generatedRouteTokens.set(htmlFile, token)
      persistedOperation = {
        ...operation,
        target: { ...operation.target, selector: routeScopedVisualSelector(operation.target.selector, token) }
      }
    }
    const css = compileVisualEditCss([persistedOperation]).css
    if (!css) continue
    if (operation.route.kind === 'current') generatedRoutePaths.add(operation.route.path)
    else hasGeneratedGlobalVisual = true
    const routeLabel = operation.route.kind === 'current' ? ` · ${operation.route.path}` : ' · toutes les pages'
    generatedSections.push(`/* Atelier visuel${routeLabel} · ${operation.id} */\n${css}`)
    const change: StagingChange = {
      id: changeId('visual', operation.id, operation.after),
      title: `Ajuster ${operation.property} sur ${operation.target.selector}`,
      file: GENERATED_STYLESHEET,
      kind: 'visual',
      before: `${operation.target.selector} { ${operation.property}: ${operation.before ?? 'valeur calculée'}; }`,
      after: css,
      confidence: operation.target.metadata.matchCount === 1 ? 'safe' : 'review'
    }
    changes.push(change)
    outcomes.push({ proposalId: operation.id, findingIds: [], kind: 'visual', status: 'applied', changeIds: [change.id], reason: 'Surcharge visuelle responsive préparée.' })
  }

  const interpretations = request.instructions
    .map((instruction) => instruction.trim())
    .filter(Boolean)
    .map(interpretLocalInstruction)
  const instructionProposalId = (instruction: string): string => changeId('instruction-proposal', instruction)
  const conflictingProposalIds = new Set<string>()
  const conflictKinds = new Map<string, StagingOutcome['kind']>()
  const themeRequests: Array<{ proposalId: string; target: ThemeMode; kind: StagingOutcome['kind'] }> = []
  if (request.themeTarget) themeRequests.push({ proposalId: `theme:${request.themeTarget}`, target: request.themeTarget, kind: 'theme' })
  for (const interpretation of interpretations) {
    if (interpretation.requestedTheme) themeRequests.push({ proposalId: instructionProposalId(interpretation.instruction), target: interpretation.requestedTheme, kind: 'instruction' })
  }
  if (new Set(themeRequests.map((entry) => entry.target)).size > 1) {
    for (const entry of themeRequests) {
      conflictingProposalIds.add(entry.proposalId)
      conflictKinds.set(entry.proposalId, entry.kind)
    }
  }

  const cssTargets = new Map<string, Array<{ proposalId: string; value: string }>>()
  for (const interpretation of interpretations) {
    if (!interpretation.recognized || !interpretation.css) continue
    const proposalId = instructionProposalId(interpretation.instruction)
    for (const target of instructionCssTargets(interpretation.css)) {
      const entries = cssTargets.get(target.target) ?? []
      entries.push({ proposalId, value: target.value })
      cssTargets.set(target.target, entries)
    }
  }
  for (const entries of cssTargets.values()) {
    if (new Set(entries.map((entry) => entry.value)).size <= 1) continue
    for (const entry of entries) {
      conflictingProposalIds.add(entry.proposalId)
      conflictKinds.set(entry.proposalId, 'instruction')
    }
  }
  for (const proposalId of conflictingProposalIds) {
    outcomes.push({
      proposalId,
      findingIds: [],
      kind: conflictKinds.get(proposalId) ?? 'instruction',
      status: 'conflict',
      changeIds: [],
      reason: 'Une autre proposition modifie la même cible avec une valeur incompatible.'
    })
  }

  let effectiveTheme = request.themeTarget && !conflictingProposalIds.has(`theme:${request.themeTarget}`) ? request.themeTarget : null
  for (const interpretation of interpretations) {
    if (interpretation.requestedTheme && !conflictingProposalIds.has(instructionProposalId(interpretation.instruction))) effectiveTheme = interpretation.requestedTheme
  }

  if (effectiveTheme && !themeAlreadyExists(project.theme, effectiveTheme)) {
    const themeCss = generateComplementaryThemeCss(project, effectiveTheme)
    generatedTheme = effectiveTheme
    generatedSections.push(themeCss)
    const change: StagingChange = {
      id: changeId('theme', effectiveTheme, project.id),
      title: effectiveTheme === 'dark' ? 'Créer le thème sombre complémentaire' : 'Créer le thème clair complémentaire',
      file: GENERATED_STYLESHEET,
      kind: 'theme',
      before: project.theme.detected,
      after: themeCss,
      confidence: project.theme.variables.some((variable) => variable.role !== 'unknown') ? 'safe' : 'review'
    }
    changes.push(change)
    outcomes.push({ proposalId: `theme:${effectiveTheme}`, findingIds: [], kind: 'theme', status: 'applied', changeIds: [change.id], reason: 'Variante de thème préparée.' })
  } else if (effectiveTheme) {
    outcomes.push({ proposalId: `theme:${effectiveTheme}`, findingIds: [], kind: 'theme', status: 'skipped', changeIds: [], reason: 'Cette variante existe déjà dans le projet.' })
  }

  const instructionChangeIds = new Map<string, string[]>()
  for (const interpretation of interpretations) {
    const proposalId = instructionProposalId(interpretation.instruction)
    if (conflictingProposalIds.has(proposalId)) continue
    const existingInstructionChanges = instructionChangeIds.get(interpretation.instruction)
    if (existingInstructionChanges) {
      outcomes.push({ proposalId, findingIds: [], kind: 'instruction', status: 'applied', changeIds: existingInstructionChanges, reason: 'Instruction identique regroupée.' })
      continue
    }
    if (!interpretation.recognized) {
      ignoredInstructions.push(interpretation.instruction)
      outcomes.push({ proposalId, findingIds: [], kind: 'instruction', status: 'skipped', changeIds: [], reason: 'Instruction non reconnue par le moteur déterministe.' })
      continue
    }
    if (interpretation.requestedTheme) {
      const themeChange = changes.find((change) => change.kind === 'theme' && generatedTheme === interpretation.requestedTheme)
      if (themeAlreadyExists(project.theme, interpretation.requestedTheme)) {
        ignoredInstructions.push(interpretation.instruction)
        outcomes.push({ proposalId, findingIds: [], kind: 'instruction', status: 'skipped', changeIds: [], reason: 'La variante demandée existe déjà.' })
      } else {
        recognizedInstructions.push(interpretation.instruction)
        const changeIds = themeChange ? [themeChange.id] : []
        instructionChangeIds.set(interpretation.instruction, changeIds)
        outcomes.push({ proposalId, findingIds: [], kind: 'instruction', status: 'applied', changeIds, reason: 'Instruction de thème préparée.' })
      }
      continue
    }
    if (!interpretation.css || !interpretation.title) {
      ignoredInstructions.push(interpretation.instruction)
      outcomes.push({ proposalId, findingIds: [], kind: 'instruction', status: 'skipped', changeIds: [], reason: 'Cette instruction ne produit aucune transformation sûre.' })
      continue
    }
    recognizedInstructions.push(interpretation.instruction)
    hasGeneratedInstructions = true
    const instructionCss = scopeInstructionCss(enrichAccentInstruction(interpretation.css, project.theme.variables))
    generatedSections.push(`/* Instruction locale : ${interpretation.instruction.replace(/\*\//g, '* /')} */\n${instructionCss}`)
    const change: StagingChange = {
      id: changeId('instruction', interpretation.instruction),
      title: interpretation.title,
      file: GENERATED_STYLESHEET,
      kind: 'instruction',
      before: interpretation.instruction,
      after: instructionCss,
      confidence: 'review'
    }
    changes.push(change)
    instructionChangeIds.set(interpretation.instruction, [change.id])
    outcomes.push({ proposalId, findingIds: [], kind: 'instruction', status: 'applied', changeIds: [change.id], reason: 'Ajustement déterministe préparé.' })
  }

  let generatedFile: string | null = null
  let generatedCss = ''
  if (generatedSections.length > 0) {
    const generatedTarget = await availableGeneratedPath(normalizedRoot, project.previewBasePath)
    generatedFile = generatedTarget.path
    const existing = generatedTarget.existing?.trim() ?? ''
    const duplicateChangeIds = new Set(changes
      .filter((change) => change.file === GENERATED_STYLESHEET && existing && existing.includes(change.after.trim()))
      .map((change) => change.id))
    if (duplicateChangeIds.size) {
      for (let index = changes.length - 1; index >= 0; index -= 1) {
        if (duplicateChangeIds.has(changes[index].id)) changes.splice(index, 1)
      }
      for (const outcome of outcomes) {
        if (!outcome.changeIds.some((id) => duplicateChangeIds.has(id))) continue
        outcome.changeIds = outcome.changeIds.filter((id) => !duplicateChangeIds.has(id))
        if (outcome.changeIds.length === 0) {
          outcome.status = 'skipped'
          outcome.reason = 'Cette transformation est déjà couverte par la feuille Responsiver gérée.'
        }
      }
    }
    const freshSections = generatedSections.filter((section) => {
      const trimmed = section.trim()
      const withoutLeadingComment = trimmed.replace(/^\/\*[\s\S]*?\*\/\s*/, '')
      return !existing.includes(trimmed) && !existing.includes(withoutLeadingComment)
    })
    generatedCss = [existing || GENERATED_FILE_HEADER, ...freshSections].filter(Boolean).join('\n\n')
    await originalBuffer(generatedFile)
    if (!existing || freshSections.length > 0) setText(generatedFile, `${generatedCss.trim()}\n`)

    for (const change of changes) {
      if (change.file === GENERATED_STYLESHEET) change.file = generatedFile
    }

    const htmlFiles = new Set<string>()
    const routeFile = (routePath: string): string | null => htmlFileForRoute(project, routePath)
    for (const routePath of generatedRoutePaths) {
      const candidate = routeFile(routePath)
      if (candidate) htmlFiles.add(candidate)
    }
    const entryRoute = project.routes.find((route) => route.path === project.entryPath)
    const entrySource = entryRoute?.sourcePath ?? project.entryPath
    const entryFile = entrySource && ['.html', '.htm'].includes(extname(entrySource).toLowerCase())
      ? normalizeRelativePath(entrySource)
      : null
    const auxiliarySegments = new Set(['demo', 'demos', 'example', 'examples', 'fixture', 'fixtures', 'storybook', 'test', 'tests'])
    const primaryHtmlFiles = new Set<string>()
    for (const route of project.routes) {
      const candidate = routeFile(route.path)
      if (!candidate) continue
      const isAuxiliary = candidate.split('/').some((segment) => auxiliarySegments.has(segment.toLowerCase()))
      if (!isAuxiliary || candidate === entryFile) primaryHtmlFiles.add(candidate)
    }
    if (entryFile) primaryHtmlFiles.add(entryFile)
    if (generatedTheme || hasGeneratedInstructions || hasGeneratedGlobalVisual) {
      for (const primaryFile of primaryHtmlFiles) htmlFiles.add(primaryFile)
    } else if (entryFile && htmlFiles.size === 0) {
      htmlFiles.add(entryFile)
    }

    for (const htmlFile of htmlFiles) {
      let beforeContent: string
      try {
        beforeContent = await currentText(htmlFile)
      } catch {
        continue
      }
      let preparedContent = beforeContent
      const isPrimaryFile = primaryHtmlFiles.has(htmlFile)
      const visualRouteToken = generatedRouteTokens.get(htmlFile)
      if (visualRouteToken) {
        const routedContent = setHtmlAttribute(preparedContent, GENERATED_ROUTE_ATTRIBUTE, visualRouteToken)
        if (routedContent) {
          preparedContent = routedContent
          changes.push({
            id: changeId('visual-route-attribute', htmlFile, visualRouteToken),
            title: 'Limiter les ajustements visuels à cette page',
            file: htmlFile,
            kind: 'html',
            before: `Attribut ${GENERATED_ROUTE_ATTRIBUTE} absent`,
            after: `${GENERATED_ROUTE_ATTRIBUTE}="${visualRouteToken}"`,
            confidence: 'safe'
          })
        }
      }
      if (isPrimaryFile && generatedTheme) {
        const themedContent = setHtmlAttribute(preparedContent, GENERATED_THEME_ATTRIBUTE, generatedTheme)
        if (themedContent) {
          preparedContent = themedContent
          changes.push({
            id: changeId('theme-attribute', htmlFile, generatedTheme),
            title: generatedTheme === 'dark' ? 'Activer la variante sombre' : 'Activer la variante claire',
            file: htmlFile,
            kind: 'html',
            before: `Attribut ${GENERATED_THEME_ATTRIBUTE} absent`,
            after: `${GENERATED_THEME_ATTRIBUTE}="${generatedTheme}"`,
            confidence: 'safe'
          })
        }
      }
      if (isPrimaryFile && hasGeneratedInstructions) {
        const instructedContent = setHtmlAttribute(preparedContent, GENERATED_INSTRUCTIONS_ATTRIBUTE)
        if (instructedContent) {
          preparedContent = instructedContent
          changes.push({
            id: changeId('instructions-attribute', htmlFile),
            title: 'Activer les ajustements demandés',
            file: htmlFile,
            kind: 'html',
            before: `Attribut ${GENERATED_INSTRUCTIONS_ATTRIBUTE} absent`,
            after: GENERATED_INSTRUCTIONS_ATTRIBUTE,
            confidence: 'safe'
          })
        }
      }
      const afterContent = insertStylesheetLink(preparedContent, generatedFile, htmlFile) ?? preparedContent
      if (!afterContent || afterContent === beforeContent) continue
      setText(htmlFile, afterContent)
      changes.push({
        id: changeId('link', htmlFile, generatedFile),
        title: 'Relier les correctifs générés',
        file: htmlFile,
        kind: 'html',
        before: 'Aucune feuille Responsiver liée',
        after: `<link rel="stylesheet" href="${stylesheetHref(htmlFile, generatedFile)}" data-responsiver-generated>`,
        confidence: 'safe'
      })
    }
  }

  // Ne conserver que les fichiers réellement différents de leur source.
  for (const [path, buffer] of [...overrides]) {
    const original = await originalBuffer(path)
    if (original?.equals(buffer)) overrides.delete(path)
  }

  const changedFiles = [...overrides.keys()].sort((left, right) => left.localeCompare(right, 'fr'))
  const sourceHashes: Record<string, string> = {}
  const patchParts: string[] = []
  for (const path of changedFiles) {
    const original = await originalBuffer(path)
    const after = overrides.get(path)?.toString('utf8') ?? ''
    sourceHashes[path] = original ? digest(original) : 'nouveau-fichier'
    patchParts.push(unifiedFileDiff(path, original?.toString('utf8') ?? null, after))
  }

  const snapshot: StagingSnapshot = {
    previewOrigin: null,
    changes,
    patch: patchParts.filter(Boolean).join('\n'),
    generatedCss,
    generatedFile,
    themeTarget: effectiveTheme,
    instructions: request.instructions,
    recognizedInstructions,
    ignoredInstructions,
    visualEdits: visualCompilation.operations,
    changedFiles,
    sourceHashes,
    outcomes,
    createdAt: new Date().toISOString()
  }
  return { overrides, snapshot }
}
