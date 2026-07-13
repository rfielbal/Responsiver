import type { VisualElementSnapshot, VisualGestureCommit, VisualGestureKind, VisualGestureMutation, VisualGestureStrategy } from './contracts'
import {
  createVisualEditOperation,
  visualEditOperationKey,
  type VisualEditOperation,
  type VisualEditRouteScope,
  type VisualEditScope
} from './visual-editor'

const allowedKinds = new Set<VisualGestureKind>(['move', 'resize', 'reorder', 'nudge'])
const allowedStrategies = new Set<VisualGestureStrategy>(['flow-translate', 'responsive-size', 'flex-order', 'grid-order'])
const propertiesByStrategy: Record<VisualGestureStrategy, ReadonlySet<string>> = {
  'flow-translate': new Set(['translate']),
  'responsive-size': new Set(['box-sizing', 'width', 'height', 'min-height', 'max-width', 'translate']),
  'flex-order': new Set(['order']),
  'grid-order': new Set(['order'])
}
const maximumMutations = 60

function clean(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) : ''
}

function finite(value: unknown, minimum: number, maximum: number): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : null
}

function sanitizedRoutePath(value: unknown): string {
  const route = clean(value, 1_024)
  const path = route.split('#', 1)[0].split('?', 1)[0]
  return path.startsWith('/') ? path || '/' : '/'
}

function sanitizeSnapshot(value: unknown): VisualElementSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VisualElementSnapshot>
  const selector = clean(source.selector, 320)
  const tag = clean(source.tag, 32).toLowerCase()
  if (!selector || !tag || selector === '*' || selector.includes('>>>') || source.editable === false || source.insideFrame) return null
  const occurrences = Math.trunc(finite(source.occurrences, 0, 10_000) ?? 0)
  if (occurrences !== 1) return null
  const rectangle = source.rect
  const x = finite(rectangle?.x, -10_000_000, 10_000_000)
  const y = finite(rectangle?.y, -10_000_000, 10_000_000)
  const width = finite(rectangle?.width, 0, 10_000_000)
  const height = finite(rectangle?.height, 0, 10_000_000)
  if (x === null || y === null || width === null || height === null) return null
  const styles: Record<string, string> = {}
  if (source.styles && typeof source.styles === 'object') {
    for (const [property, raw] of Object.entries(source.styles).slice(0, 48)) {
      const name = clean(property, 64)
      const content = clean(raw, 240)
      if (name && content && !/(?:url\s*\(|data\s*:|javascript\s*:)/i.test(content)) styles[name] = content
    }
  }
  return {
    selector,
    tag,
    classes: Array.isArray(source.classes) ? source.classes.slice(0, 12).map((entry) => clean(entry, 80)).filter(Boolean) : [],
    rect: { x, y, width, height },
    styles,
    occurrences: 1,
    route: sanitizedRoutePath(source.route),
    // Le protocole de composition ne transporte jamais de contenu utilisateur.
    text: '',
    role: null,
    ariaLabel: null,
    editable: true,
    insideFrame: false
  }
}

function sanitizeMutation(value: unknown, strategy: VisualGestureStrategy): VisualGestureMutation | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VisualGestureMutation>
  const target = sanitizeSnapshot(source.target)
  const property = clean(source.property, 64)
  const after = clean(source.after, 240)
  const before = source.before === null || source.before === undefined ? null : clean(source.before, 240)
  if (!target || !propertiesByStrategy[strategy].has(property) || !after) return null
  return { target, property, before: before || null, after }
}

export function sanitizeVisualGestureCommit(value: unknown): VisualGestureCommit | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VisualGestureCommit>
  const kind = source.kind
  const strategy = source.strategy
  if (source.protocol !== 1 || !kind || !strategy || !allowedKinds.has(kind) || !allowedStrategies.has(strategy)) return null
  const sessionId = clean(source.sessionId, 80)
  const documentId = clean(source.documentId, 80)
  const gestureId = clean(source.gestureId, 80)
  const revision = Math.trunc(finite(source.revision, 1, Number.MAX_SAFE_INTEGER) ?? 0)
  if (!sessionId || !documentId || !gestureId || !revision || !Array.isArray(source.mutations) || source.mutations.length < 1 || source.mutations.length > maximumMutations) return null
  const mutations = source.mutations.map((entry) => sanitizeMutation(entry, strategy))
  if (mutations.some((entry) => !entry)) return null
  if ((strategy === 'flow-translate' && !['move', 'nudge'].includes(kind)) || (strategy === 'responsive-size' && kind !== 'resize') || (strategy.endsWith('-order') && kind !== 'reorder')) return null
  const warning = source.warning === 'flow-preserved' || source.warning === 'visual-order-only' || source.warning === 'fixed-height' ? source.warning : undefined
  return { protocol: 1, sessionId, documentId, revision, gestureId, kind, strategy, mutations: mutations as VisualGestureMutation[], warning }
}

export function visualGestureOperations(commit: VisualGestureCommit, context: { scope: VisualEditScope; route: VisualEditRouteScope }): VisualEditOperation[] {
  return commit.mutations.map((mutation) => createVisualEditOperation({
    target: {
      selector: mutation.target.selector,
      metadata: {
        matchCount: 1,
        selectionMode: 'single',
        stable: true,
        editable: true,
        insideShadowRoot: false,
        crossOrigin: false
      }
    },
    property: mutation.property,
    before: mutation.before,
    after: mutation.after,
    scope: context.scope,
    route: context.route
  }))
}

/**
 * Remplace atomiquement les propriétés touchées par un geste. Les clés sont
 * calculées avant de retirer les no-op afin qu’un retour à la valeur source
 * supprime bien une ancienne surcharge au lieu de la laisser active.
 */
export function mergeVisualGestureOperations(current: readonly VisualEditOperation[], batch: readonly VisualEditOperation[]): VisualEditOperation[] {
  const currentByKey = new Map(current.map((operation) => [visualEditOperationKey(operation), operation]))
  const replacementOrder: string[] = []
  const replacements = new Map<string, VisualEditOperation>()
  for (const operation of batch) {
    const key = visualEditOperationKey(operation)
    const previous = currentByKey.get(key)
    const replacement = !previous ? operation : previous.after === operation.after ? previous : { ...operation, before: previous.before }
    if (!replacements.has(key)) replacementOrder.push(key)
    replacements.set(key, replacement)
  }
  const noOp = (operation: VisualEditOperation): boolean => {
    if (operation.before === operation.after) return true
    if (operation.property !== 'translate') return false
    const normalize = (value: string | null): string => {
      const compact = (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
      return compact === 'none' || /^0(?:\.0+)?(?:px)?(?: 0(?:\.0+)?(?:px)?)?$/.test(compact) ? 'none' : compact
    }
    return normalize(operation.before) === normalize(operation.after)
  }
  const next: VisualEditOperation[] = []
  const consumed = new Set<string>()
  for (const operation of current) {
    const key = visualEditOperationKey(operation)
    const replacement = replacements.get(key)
    if (!replacement) {
      next.push(operation)
      continue
    }
    if (!consumed.has(key) && !noOp(replacement)) next.push(replacement)
    consumed.add(key)
  }
  for (const key of replacementOrder) {
    if (consumed.has(key)) continue
    const replacement = replacements.get(key)
    if (replacement && !noOp(replacement)) next.push(replacement)
  }
  return next
}
