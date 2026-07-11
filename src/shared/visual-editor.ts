export const VISUAL_EDIT_ALLOWED_PROPERTIES = Object.freeze([
  'display',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
  'gap', 'row-gap', 'column-gap',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'color', 'background-color',
  'border-color', 'border-width', 'border-style', 'border-radius', 'box-shadow',
  'opacity', 'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'visibility'
] as const)

export type VisualEditProperty = typeof VISUAL_EDIT_ALLOWED_PROPERTIES[number]

export type VisualEditScope =
  | { kind: 'all' }
  | { kind: 'mobile' }
  | { kind: 'tablet' }
  | { kind: 'custom'; minWidth?: number | null; maxWidth?: number | null }

export type VisualEditRouteScope =
  | { kind: 'all' }
  | { kind: 'current'; path: string }

export interface VisualTargetMetadata {
  matchCount: number
  selectionMode: 'single' | 'matching' | 'document'
  stable: boolean
  editable: boolean
  multipleConfirmed?: boolean
  insideShadowRoot?: boolean
  crossOrigin?: boolean
}

export interface VisualTarget {
  selector: string
  metadata: VisualTargetMetadata
}

export interface VisualEditOperation {
  id: string
  target: VisualTarget
  property: VisualEditProperty
  before: string | null
  after: string
  scope: VisualEditScope
  route: VisualEditRouteScope
}

export interface VisualEditOperationInput {
  id?: string
  target: VisualTarget
  property: string
  before?: string | null
  after: string
  scope: VisualEditScope
  route: VisualEditRouteScope
}

export interface VisualEditAuthorizationContext {
  sourceKind: 'local-project' | 'linked-localhost' | 'remote-url'
  readOnly: boolean
  localRoot: string | null
  artifact?: boolean
}

export interface VisualEditAuthorization {
  allowed: boolean
  persistable: boolean
  strategy: 'managed-css' | 'export-only' | 'read-only'
  reason: string
}

export interface VisualEditConflict {
  key: string
  operationIds: string[]
  reason: string
}

export interface VisualEditInvalid {
  operationId: string
  reason: string
}

export interface CompiledVisualEdits {
  css: string
  operations: VisualEditOperation[]
  conflicts: VisualEditConflict[]
  skipped: string[]
  invalid: VisualEditInvalid[]
}

export class VisualEditValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VisualEditValidationError'
  }
}

const allowedPropertySet = new Set<string>(VISUAL_EDIT_ALLOWED_PROPERTIES)
const maximumOperations = 500
const maximumValueLength = 240
const maximumSelectorLength = 320
const maximumRouteLength = 2_048

function cleanText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function stableHash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

function normalizedSelector(value: string): string {
  const selector = cleanText(value, maximumSelectorLength)
  if (!selector || value.length > maximumSelectorLength) throw new VisualEditValidationError('Le sélecteur visuel est absent ou trop long.')
  if (/[{},;@\u0000]/.test(selector) || selector.includes('>>>')) {
    throw new VisualEditValidationError('Ce sélecteur ne peut pas être persisté dans une feuille CSS standard.')
  }
  return selector
}

function normalizedValue(value: string, label: string): string {
  const next = cleanText(value, maximumValueLength)
  if (!next || value.length > maximumValueLength) throw new VisualEditValidationError(`${label} est absente ou trop longue.`)
  if (/[{};\\\u0000-\u001f\u007f]/.test(next) || /\/\*|\*\//.test(next) || /(?:@import|expression\s*\(|javascript\s*:|url\s*\(|data\s*:|(?:-webkit-)?image-set\s*\(|cross-fade\s*\(|paint\s*\()/i.test(next)) {
    throw new VisualEditValidationError(`${label} contient une construction CSS refusée.`)
  }
  if (/!\s*important/i.test(next)) throw new VisualEditValidationError(`${label} ne doit pas imposer elle-même !important.`)
  return next
}

function normalizedDimension(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) throw new VisualEditValidationError('La plage responsive contient une dimension invalide.')
  return Math.min(3_840, Math.max(240, Math.round(value)))
}

function normalizedScope(value: VisualEditScope): VisualEditScope {
  if (value.kind === 'all' || value.kind === 'mobile' || value.kind === 'tablet') return { kind: value.kind }
  if (value.kind !== 'custom') throw new VisualEditValidationError('La portée responsive est invalide.')
  const minWidth = normalizedDimension(value.minWidth)
  const maxWidth = normalizedDimension(value.maxWidth)
  if (minWidth === null && maxWidth === null) throw new VisualEditValidationError('Une plage personnalisée doit avoir au moins une borne.')
  if (minWidth !== null && maxWidth !== null && minWidth > maxWidth) throw new VisualEditValidationError('La plage responsive personnalisée est inversée.')
  return { kind: 'custom', minWidth, maxWidth }
}

function normalizedRoute(value: VisualEditRouteScope): VisualEditRouteScope {
  if (value.kind === 'all') return { kind: 'all' }
  if (value.kind !== 'current' || typeof value.path !== 'string') throw new VisualEditValidationError('La portée de page est invalide.')
  const path = cleanText(value.path, maximumRouteLength)
  if (!path || value.path.length > maximumRouteLength || !path.startsWith('/')) throw new VisualEditValidationError('La route visuelle doit être un chemin interne.')
  return { kind: 'current', path }
}

function normalizedMetadata(value: VisualTargetMetadata): VisualTargetMetadata {
  if (!value || typeof value !== 'object') throw new VisualEditValidationError('Les métadonnées de sélection sont absentes.')
  const matchCount = Number.isSafeInteger(value.matchCount) ? Math.min(10_000, Math.max(0, value.matchCount)) : 0
  if (!['single', 'matching', 'document'].includes(value.selectionMode)) throw new VisualEditValidationError('Le mode de sélection est invalide.')
  if (!value.editable) throw new VisualEditValidationError('Cet élément est disponible uniquement en inspection.')
  if (value.crossOrigin) throw new VisualEditValidationError('Un élément provenant d’une frame tierce ne peut pas être modifié.')
  if (value.insideShadowRoot) throw new VisualEditValidationError('Une cible Shadow DOM peut être inspectée, mais pas persistée en CSS standard.')
  if (!value.stable) throw new VisualEditValidationError('Le sélecteur de cet élément n’est pas assez stable pour être exporté.')
  if (matchCount < 1) throw new VisualEditValidationError('Le sélecteur ne correspond plus à aucun élément.')
  if (matchCount > 1 && !value.multipleConfirmed) throw new VisualEditValidationError('Ce sélecteur cible plusieurs éléments ; confirmez la modification groupée.')
  return {
    matchCount,
    selectionMode: value.selectionMode,
    stable: true,
    editable: true,
    multipleConfirmed: Boolean(value.multipleConfirmed),
    insideShadowRoot: Boolean(value.insideShadowRoot),
    crossOrigin: false
  }
}

export function authorizeVisualEditor(context: VisualEditAuthorizationContext): VisualEditAuthorization {
  if (context.sourceKind === 'remote-url' || context.readOnly || !context.localRoot) {
    return { allowed: false, persistable: false, strategy: 'read-only', reason: 'Les sources locales sont requises pour modifier visuellement ce site.' }
  }
  if (context.sourceKind === 'linked-localhost') {
    return { allowed: true, persistable: false, strategy: 'export-only', reason: 'La preview est modifiable ; la feuille générée devra être reliée explicitement au framework.' }
  }
  if (context.artifact) {
    return { allowed: true, persistable: false, strategy: 'export-only', reason: 'Cette sortie compilée peut être écrasée par le prochain build.' }
  }
  return { allowed: true, persistable: true, strategy: 'managed-css', reason: 'Une feuille CSS gérée, exportable et réversible sera ajoutée au projet.' }
}

export function createVisualEditOperation(input: VisualEditOperationInput): VisualEditOperation {
  if (!allowedPropertySet.has(input.property)) throw new VisualEditValidationError(`La propriété CSS ${input.property || 'inconnue'} n’est pas autorisée.`)
  const selector = normalizedSelector(input.target.selector)
  const property = input.property as VisualEditProperty
  const before = input.before === null || input.before === undefined || input.before.trim() === '' ? null : normalizedValue(input.before, 'La valeur source')
  const after = normalizedValue(input.after, 'La nouvelle valeur')
  const scope = normalizedScope(input.scope)
  const route = normalizedRoute(input.route)
  const metadata = normalizedMetadata(input.target.metadata)
  const identity = JSON.stringify({ selector, property, scope, route })
  const id = typeof input.id === 'string' && /^visual-[a-f\d]{8,32}$/.test(input.id)
    ? input.id
    : `visual-${stableHash(identity)}`
  return { id, target: { selector, metadata }, property, before, after, scope, route }
}

export function validateVisualEditOperation(value: unknown): { valid: true; operation: VisualEditOperation } | { valid: false; reason: string } {
  try {
    if (!value || typeof value !== 'object') throw new VisualEditValidationError('L’opération visuelle est invalide.')
    const operation = value as Partial<VisualEditOperationInput>
    if (!operation.target || typeof operation.target !== 'object' || typeof operation.target.selector !== 'string' || !operation.target.metadata) throw new VisualEditValidationError('La cible visuelle est invalide.')
    if (typeof operation.property !== 'string' || typeof operation.after !== 'string' || !operation.scope || !operation.route) throw new VisualEditValidationError('L’opération visuelle est incomplète.')
    return { valid: true, operation: createVisualEditOperation(operation as VisualEditOperationInput) }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : 'L’opération visuelle est invalide.' }
  }
}

function scopeKey(scope: VisualEditScope): string {
  return scope.kind === 'custom' ? `custom:${scope.minWidth ?? ''}:${scope.maxWidth ?? ''}` : scope.kind
}

function routeKey(route: VisualEditRouteScope): string {
  return route.kind === 'current' ? `current:${route.path}` : 'all'
}

export function visualEditOperationKey(operation: Pick<VisualEditOperation, 'target' | 'property' | 'scope' | 'route'>): string {
  return [operation.target.selector, operation.property, scopeKey(operation.scope), routeKey(operation.route)].join('\u001f')
}

function mediaQuery(scope: VisualEditScope): string | null {
  if (scope.kind === 'all') return null
  if (scope.kind === 'mobile') return '(max-width: 767px)'
  if (scope.kind === 'tablet') return '(min-width: 768px) and (max-width: 1024px)'
  const parts: string[] = []
  if (scope.minWidth !== null && scope.minWidth !== undefined) parts.push(`(min-width: ${scope.minWidth}px)`)
  if (scope.maxWidth !== null && scope.maxWidth !== undefined) parts.push(`(max-width: ${scope.maxWidth}px)`)
  return parts.join(' and ')
}

function operationCss(operation: VisualEditOperation): string {
  const routeComment = operation.route.kind === 'current' ? ` · route ${operation.route.path.replace(/\*\//g, '* /')}` : ''
  const rule = `/* Ajustement visuel${routeComment} */\n${operation.target.selector} {\n  ${operation.property}: ${operation.after} !important;\n}`
  const media = mediaQuery(operation.scope)
  return media ? `@media ${media} {\n  ${rule.replace(/\n/g, '\n  ')}\n}` : rule
}

function documentRoute(value: string): string {
  const path = value.split('#', 1)[0].split('?', 1)[0] || '/'
  return path.endsWith('/') ? `${path}index.html` : path
}

export function compileVisualEditCss(values: readonly unknown[], previewRoute?: string): CompiledVisualEdits {
  if (!Array.isArray(values) || values.length > maximumOperations) {
    return { css: '', operations: [], conflicts: [], skipped: [], invalid: [{ operationId: 'visual-request', reason: 'Le nombre de modifications visuelles dépasse la limite autorisée.' }] }
  }
  const normalized: VisualEditOperation[] = []
  const invalid: VisualEditInvalid[] = []
  for (const [index, value] of values.entries()) {
    const result = validateVisualEditOperation(value)
    if (result.valid) normalized.push(result.operation)
    else invalid.push({ operationId: value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' ? String((value as { id: string }).id).slice(0, 64) : `visual-${index + 1}`, reason: result.reason })
  }
  const applicable = typeof previewRoute === 'string'
    ? normalized.filter((operation) => operation.route.kind === 'all' || documentRoute(operation.route.path) === documentRoute(previewRoute))
    : normalized
  const grouped = new Map<string, VisualEditOperation[]>()
  for (const operation of applicable) {
    const key = visualEditOperationKey(operation)
    const entries = grouped.get(key) ?? []
    entries.push(operation)
    grouped.set(key, entries)
  }
  const conflicts: VisualEditConflict[] = []
  const skipped: string[] = []
  const operations: VisualEditOperation[] = []
  for (const [key, entries] of grouped) {
    if (new Set(entries.map((entry) => entry.after)).size > 1) {
      conflicts.push({ key, operationIds: entries.map((entry) => entry.id), reason: 'Plusieurs valeurs modifient la même propriété sur la même cible et la même portée.' })
      continue
    }
    operations.push(entries[0])
    skipped.push(...entries.slice(1).map((entry) => entry.id))
  }
  operations.sort((left, right) => visualEditOperationKey(left).localeCompare(visualEditOperationKey(right), 'fr'))
  return { css: operations.map(operationCss).join('\n\n'), operations, conflicts, skipped, invalid }
}
