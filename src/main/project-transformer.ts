import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, extname, posix, resolve, sep } from 'node:path'
import postcss, { type Declaration, type Rule } from 'postcss'
import type {
  ProjectFix,
  ProjectSnapshot,
  StagingChange,
  StagingRequest,
  StagingSnapshot,
  ThemeMode,
  ThemeProfile,
  ThemeVariable
} from '../shared/contracts'

export const GENERATED_STYLESHEET = '.responsiver/responsiver.generated.css'
const GENERATED_THEME_ATTRIBUTE = 'data-responsiver-generated-theme'
const GENERATED_INSTRUCTIONS_ATTRIBUTE = 'data-responsiver-generated-instructions'

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

const accessibleAccents: Record<ThemeMode, string[]> = {
  light: ['#9e412d', '#315f8c', '#376548', '#684d8e', '#855712'],
  dark: ['#ec8060', '#7fb0d8', '#78b894', '#b09add', '#e0b760']
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
  if (!theme.hasDark && !theme.hasLight) return 'dark'
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

function parseRgb(value: string): [number, number, number] | null {
  const hex = value.match(/#([\da-f]{3,8})\b/i)?.[1]
  if (hex) {
    const normalized = hex.length === 3 || hex.length === 4
      ? hex.slice(0, 3).split('').map((part) => `${part}${part}`).join('')
      : hex.slice(0, 6)
    if (/^[\da-f]{6}$/i.test(normalized)) {
      return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number]
    }
  }
  const rgb = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i)
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

function valueForRole(variable: ThemeVariable, palette: ThemePalette, index: number): string | null {
  switch (variable.role) {
    case 'background': return palette.background
    case 'surface': return index % 2 === 0 ? palette.surface : palette.surfaceRaised
    case 'text': return palette.text
    case 'muted': return palette.muted
    case 'border': return palette.border
    case 'accent': {
      if (contrastRatio(variable.value, palette.background) >= 4.5) return variable.value
      const alternatives = accessibleAccents[palette === palettes.dark ? 'dark' : 'light']
      const stableIndex = [...variable.name].reduce((total, character) => total + character.charCodeAt(0), index) % alternatives.length
      return alternatives[stableIndex]
    }
    case 'unknown': return null
  }
}

function enrichAccentInstruction(css: string, variables: ThemeVariable[]): string {
  const color = css.match(/--responsiver-accent\s*:\s*([^;]+)/)?.[1]?.trim()
  if (!color) return css
  const semanticOverrides = variables
    .filter((variable) => variable.role === 'accent')
    .map((variable) => `  ${variable.name}: ${color};`)
  if (semanticOverrides.length === 0) return css
  return `${css}\n\n:root {\n${semanticOverrides.join('\n')}\n}`
}

export function generateComplementaryThemeCss(project: ProjectSnapshot, target: ThemeMode): string {
  const palette = palettes[target]
  const semanticVariables = project.theme.variables.filter((variable) => variable.role !== 'unknown')
  const declarations = semanticVariables
    .map((variable, index) => {
      const value = valueForRole(variable, palette, index)
      return value ? `  ${variable.name}: ${value};` : null
    })
    .filter((value): value is string => Boolean(value))

  const variableBlock = declarations.length > 0 ? `\n${declarations.join('\n')}` : ''
  const themeSelector = `html[${GENERATED_THEME_ATTRIBUTE}="${target}"]`
  return `/* Variante ${target === 'dark' ? 'sombre' : 'claire'} déterministe — Responsiver */
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

${themeSelector} :where([class*="card" i], [class*="panel" i], [class*="surface" i], dialog) {
  background-color: var(--responsiver-surface);
  color: var(--responsiver-text);
  border-color: var(--responsiver-border);
}

${themeSelector} :where(input, select, textarea, button) {
  border-color: var(--responsiver-border);
}

${themeSelector} :where(a, button, [role="button"]) {
  accent-color: var(--responsiver-accent);
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

async function availableGeneratedPath(root: string): Promise<string> {
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0
      ? GENERATED_STYLESHEET
      : `.responsiver/responsiver.generated.${index}.css`
    const state = await guardedProjectPath(root, candidate)
    if (!state.exists) return candidate
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
  const generatedSections: string[] = []
  const generatedOperations = new Set<string>()
  const generatedRoutePaths = new Set<string>()
  const recognizedInstructions: string[] = []
  const ignoredInstructions: string[] = []
  let generatedTheme: ThemeMode | null = null
  let hasGeneratedInstructions = false

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

  const acceptedIssues = new Set(request.issueIds)
  for (const issue of project.issues) {
    if (!acceptedIssues.has(issue.id) || !issue.fix || issue.fix.kind === 'manual') continue
    const fix = issue.fix
    const operationKey = [fix.kind, fix.file, fix.selector, fix.property, fix.before, fix.after, fix.breakpoint].join('\u001f')
    if (fix.kind === 'css-media-override') generatedRoutePaths.add(issue.routePath ?? project.entryPath ?? '')
    if (generatedOperations.has(operationKey)) continue

    if (fix.kind === 'html-insert') {
      const beforeContent = await currentText(fix.file)
      const afterContent = insertViewport(beforeContent)
      if (!afterContent || afterContent === beforeContent) continue
      setText(fix.file, afterContent)
      generatedOperations.add(operationKey)
      changes.push({
        id: changeId(issue.id, operationKey),
        title: issue.title,
        file: normalizeRelativePath(fix.file),
        kind: 'html',
        before: 'Balise viewport absente',
        after: '<meta name="viewport" content="width=device-width, initial-scale=1">',
        confidence: fix.confidence
      })
      continue
    }

    if (fix.kind === 'css-replace') {
      const beforeContent = await currentText(fix.file)
      const extension = extname(fix.file).toLowerCase()
      const replacement = ['.html', '.htm'].includes(extension)
        ? replaceEmbeddedCss(beforeContent, fix)
        : replaceCssDeclaration(beforeContent, fix, issue.source?.line)
      if (!replacement || replacement.content === beforeContent) continue
      setText(fix.file, replacement.content)
      generatedOperations.add(operationKey)
      changes.push({
        id: changeId(issue.id, operationKey),
        title: issue.title,
        file: normalizeRelativePath(fix.file),
        kind: extension === '.html' || extension === '.htm' ? 'html' : 'css',
        before: replacement.before,
        after: replacement.after,
        confidence: fix.confidence
      })
      continue
    }

    if (fix.kind === 'css-media-override') {
      const css = mediaOverride(fix)
      if (!css) continue
      generatedOperations.add(operationKey)
      generatedSections.push(`/* ${issue.rule} · ${issue.source?.file ?? fix.file}:${issue.source?.line ?? 1} */\n${css}`)
      changes.push({
        id: changeId(issue.id, operationKey),
        title: issue.title,
        file: GENERATED_STYLESHEET,
        kind: 'css',
        before: `${fix.selector ?? ''} { ${fix.property ?? ''}: ${fix.before ?? ''}; }`,
        after: css,
        confidence: fix.confidence
      })
    }
  }

  const interpretations = request.instructions
    .map((instruction) => instruction.trim())
    .filter(Boolean)
    .map(interpretLocalInstruction)
  let effectiveTheme = request.themeTarget
  for (const interpretation of interpretations) {
    if (interpretation.requestedTheme) effectiveTheme = interpretation.requestedTheme
  }

  if (effectiveTheme && !themeAlreadyExists(project.theme, effectiveTheme)) {
    const themeCss = generateComplementaryThemeCss(project, effectiveTheme)
    generatedTheme = effectiveTheme
    generatedSections.push(themeCss)
    changes.push({
      id: changeId('theme', effectiveTheme, project.id),
      title: effectiveTheme === 'dark' ? 'Créer le thème sombre complémentaire' : 'Créer le thème clair complémentaire',
      file: GENERATED_STYLESHEET,
      kind: 'theme',
      before: project.theme.detected,
      after: themeCss,
      confidence: project.theme.variables.some((variable) => variable.role !== 'unknown') ? 'safe' : 'review'
    })
  }

  for (const interpretation of interpretations) {
    if (!interpretation.recognized) {
      ignoredInstructions.push(interpretation.instruction)
      continue
    }
    if (interpretation.requestedTheme) {
      if (themeAlreadyExists(project.theme, interpretation.requestedTheme)) ignoredInstructions.push(interpretation.instruction)
      else recognizedInstructions.push(interpretation.instruction)
      continue
    }
    if (!interpretation.css || !interpretation.title) {
      ignoredInstructions.push(interpretation.instruction)
      continue
    }
    recognizedInstructions.push(interpretation.instruction)
    hasGeneratedInstructions = true
    const instructionCss = scopeInstructionCss(enrichAccentInstruction(interpretation.css, project.theme.variables))
    generatedSections.push(`/* Instruction locale : ${interpretation.instruction.replace(/\*\//g, '* /')} */\n${instructionCss}`)
    changes.push({
      id: changeId('instruction', interpretation.instruction),
      title: interpretation.title,
      file: GENERATED_STYLESHEET,
      kind: 'instruction',
      before: interpretation.instruction,
      after: instructionCss,
      confidence: 'review'
    })
  }

  let generatedFile: string | null = null
  let generatedCss = ''
  if (generatedSections.length > 0) {
    generatedFile = await availableGeneratedPath(normalizedRoot)
    generatedCss = `/*\n * Généré localement par Responsiver.\n * Chaque règle reste lisible, exportable et réversible.\n */\n\n${generatedSections.join('\n\n')}`
    await originalBuffer(generatedFile)
    setText(generatedFile, `${generatedCss.trim()}\n`)

    for (const change of changes) {
      if (change.file === GENERATED_STYLESHEET) change.file = generatedFile
    }

    const htmlFiles = new Set<string>()
    const routeFile = (routePath: string): string | null => {
      const route = project.routes.find((candidate) => candidate.path === routePath)
      const candidate = route?.label && ['.html', '.htm'].includes(extname(route.label).toLowerCase())
        ? route.label
        : routePath.replace(/^\//, '')
      return ['.html', '.htm'].includes(extname(candidate).toLowerCase())
        ? normalizeRelativePath(candidate)
        : null
    }
    for (const routePath of generatedRoutePaths) {
      const candidate = routeFile(routePath)
      if (candidate) htmlFiles.add(candidate)
    }
    const entryFile = project.entryPath && ['.html', '.htm'].includes(extname(project.entryPath).toLowerCase())
      ? normalizeRelativePath(project.entryPath)
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
    if (generatedTheme || hasGeneratedInstructions) {
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
    changedFiles,
    sourceHashes,
    createdAt: new Date().toISOString()
  }
  return { overrides, snapshot }
}
