import type { ProjectIssue } from './contracts'

export type FindingGroup = 'visual' | 'code'
export type FindingVerification = 'source-diff' | 'visual-before-after' | 'both' | 'manual'
export type FindingAction = 'auto-safe' | 'review-required' | 'advisory'
export type FindingOrigin = 'static' | 'runtime' | 'correlated'

export interface FindingPolicy {
  readonly group: FindingGroup
  readonly verification: FindingVerification
  readonly action: FindingAction
  readonly origin: FindingOrigin
  readonly priority: number
  readonly correlatedIssueIds: readonly string[]
}

export interface ClassifiedProjectIssue {
  readonly issue: ProjectIssue
  readonly policy: FindingPolicy
}

export interface PrioritizeProjectIssuesOptions {
  /** Nombre maximal de constats retournés. Une valeur négative équivaut à zéro. */
  readonly max?: number
  /** Limite le résultat à une famille sans modifier la classification. */
  readonly group?: FindingGroup
}

export interface GroupedProjectIssues {
  readonly visual: readonly ClassifiedProjectIssue[]
  readonly code: readonly ClassifiedProjectIssue[]
}

const STATIC_CSS_RESPONSIVE_RULES = new Set([
  'css.fixed-width',
  'css.min-width-mobile',
  'css.nowrap'
])

const MISSING_VIEWPORT_RULES = new Set([
  'html.viewport-meta',
  'responsive.missing-viewport'
])

const VISUAL_RUNTIME_PREFIXES = [
  'layout.',
  'typography.',
  'interaction.',
  'media.'
]

const DETERMINISTIC_VISUAL_RULES = new Set([
  'layout.navigation-wrap',
  'typography.disproportionate'
])

const CODE_RULE_PREFIXES = [
  'artifact.',
  'build.',
  'network.',
  'parse.',
  'page-error',
  'preview.'
]

const VISUAL_IMPACT: Readonly<Record<string, number>> = {
  'layout.element-overlap': 170,
  'layout.viewport-overflow': 165,
  'layout.useful-area-overflow': 160,
  'layout.fixed-obstruction': 150,
  'layout.navigation-wrap': 145,
  'layout.clipped-content': 140,
  'layout.truncated-text': 138,
  'responsive.missing-viewport': 136,
  'html.viewport-meta': 136,
  'layout.density-hierarchy': 128,
  'typography.disproportionate': 124,
  'typography.mobile-readability': 120,
  'media.image-error': 116,
  'media.image-distortion': 108,
  'accessibility.low-contrast': 104,
  'interaction.small-target': 100
}

const SEVERITY_PRIORITY: Readonly<Record<ProjectIssue['severity'], number>> = {
  bloquant: 300,
  attention: 200,
  information: 100
}

function normalizedRoute(issue: ProjectIssue): string {
  const candidate = (issue.routePath ?? issue.evidence?.route ?? '').trim()
  if (!candidate) return ''
  try {
    const parsed = new URL(candidate)
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/'
  } catch {
    return candidate
  }
}

function normalizedSelector(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
}

function issueSelector(issue: ProjectIssue): string {
  return normalizedSelector(issue.evidence?.selector ?? issue.fix?.selector)
}

/**
 * Retourne uniquement une cible que le transformateur local sait convertir en
 * CSS déterministe. Ce garde-fou est partagé avec l’UI afin de ne jamais
 * annoncer un avant/après que le moteur ne peut pas produire.
 */
export function deterministicVisualTarget(issue: ProjectIssue): string | null {
  if (!DETERMINISTIC_VISUAL_RULES.has(issue.rule) || !issue.evidence?.selector) return null
  const rawSelector = issue.evidence.selector.trim()
  const simpleSelector = /^(?:(?:[a-z][\w-]*)?(?:[.#][\w-]+){1,4}|[a-z][\w-]*)$/i
  if (simpleSelector.test(rawSelector)) return rawSelector
  const selectorTail = rawSelector.split(/\s*>\s*/).at(-1)?.trim() ?? ''
  return simpleSelector.test(selectorTail) && /[.#]/.test(selectorTail) ? selectorTail : null
}

function hasRuntimeEvidence(issue: ProjectIssue): boolean {
  return Boolean(issue.evidence) || issue.id.startsWith('runtime:') || issue.id.startsWith('remote-')
}

function intrinsicOrigin(issue: ProjectIssue): Exclude<FindingOrigin, 'correlated'> | 'correlated' {
  const runtime = hasRuntimeEvidence(issue)
  const source = Boolean(issue.source || issue.fix?.file)
  return runtime && source ? 'correlated' : runtime ? 'runtime' : 'static'
}

function isVisualRuntimeRule(rule: string): boolean {
  return VISUAL_RUNTIME_PREFIXES.some((prefix) => rule.startsWith(prefix)) || rule === 'accessibility.low-contrast'
}

function isCodeDiagnosticRule(rule: string): boolean {
  return rule === 'runtime.page-error' ||
    rule.endsWith('.parse') ||
    CODE_RULE_PREFIXES.some((prefix) => rule === prefix || rule.startsWith(prefix))
}

function isArtifactPath(value: string | undefined): boolean {
  if (!value) return false
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.some((segment) => ['dist', 'build', 'out', '.output', '.next', '.nuxt'].includes(segment.toLowerCase()))
}

function hasExactFixTarget(issue: ProjectIssue): boolean {
  const fix = issue.fix
  const source = issue.source
  if (!fix || fix.kind === 'manual' || !source || source.line < 1) return false
  if (!fix.file.trim() || fix.file.replace(/\\/g, '/') !== source.file.replace(/\\/g, '/')) return false

  if (fix.kind === 'html-insert') return Boolean(fix.before?.trim() && fix.after?.trim())
  if (!fix.selector?.trim() || !fix.property?.trim() || !fix.before?.trim() || !fix.after?.trim()) return false
  if (fix.kind === 'css-media-override') return Number.isFinite(fix.breakpoint) && Number(fix.breakpoint) > 0
  return true
}

function matchingCorrelations(issue: ProjectIssue, allIssues: readonly ProjectIssue[]): readonly ProjectIssue[] {
  const origin = intrinsicOrigin(issue)
  const route = normalizedRoute(issue)
  const selector = issueSelector(issue)
  if (route && origin === 'static' && MISSING_VIEWPORT_RULES.has(issue.rule)) {
    return allIssues.filter((candidate) => candidate.id !== issue.id &&
      MISSING_VIEWPORT_RULES.has(candidate.rule) &&
      intrinsicOrigin(candidate) !== 'static' &&
      normalizedRoute(candidate) === route)
  }
  if (!route || !selector) return []

  const issueIsStaticCss = origin === 'static' && STATIC_CSS_RESPONSIVE_RULES.has(issue.rule)
  const issueIsVisualRuntime = origin !== 'static' && isVisualRuntimeRule(issue.rule)
  if (!issueIsStaticCss && !issueIsVisualRuntime) return []

  return allIssues.filter((candidate) => {
    if (candidate === issue || candidate.id === issue.id) return false
    if (normalizedRoute(candidate) !== route || issueSelector(candidate) !== selector) return false
    const candidateOrigin = intrinsicOrigin(candidate)
    if (issueIsStaticCss) return candidateOrigin !== 'static' && isVisualRuntimeRule(candidate.rule)
    return candidateOrigin === 'static' && STATIC_CSS_RESPONSIVE_RULES.has(candidate.rule)
  })
}

function verificationFor(issue: ProjectIssue, group: FindingGroup, origin: FindingOrigin): FindingVerification {
  if (MISSING_VIEWPORT_RULES.has(issue.rule)) return 'both'
  if (origin === 'correlated') return 'both'
  if (group === 'visual' && origin === 'runtime') return 'visual-before-after'
  if (isCodeDiagnosticRule(issue.rule)) return 'manual'
  if (origin === 'static' && issue.source && issue.fix && issue.fix.kind !== 'manual') return 'source-diff'
  return 'manual'
}

function isSafeAutomaticFix(issue: ProjectIssue, verification: FindingVerification, origin: FindingOrigin): boolean {
  return issue.fix?.confidence === 'safe' &&
    verification === 'source-diff' &&
    origin === 'static' &&
    !isArtifactPath(issue.source?.file) &&
    !isArtifactPath(issue.fix.file) &&
    !isCodeDiagnosticRule(issue.rule) &&
    hasExactFixTarget(issue)
}

function actionFor(issue: ProjectIssue, group: FindingGroup, verification: FindingVerification, origin: FindingOrigin): FindingAction {
  if (isSafeAutomaticFix(issue, verification, origin)) return 'auto-safe'
  if (group === 'visual') {
    return deterministicVisualTarget(issue) || (issue.fix && issue.fix.kind !== 'manual') ? 'review-required' : 'advisory'
  }
  if (STATIC_CSS_RESPONSIVE_RULES.has(issue.rule) || (issue.fix && issue.fix.kind !== 'manual')) return 'review-required'
  return 'advisory'
}

function priorityFor(issue: ProjectIssue, group: FindingGroup, origin: FindingOrigin, action: FindingAction): number {
  const groupPriority = group === 'visual' ? 10_000 : 0
  const severity = SEVERITY_PRIORITY[issue.severity]
  const impact = VISUAL_IMPACT[issue.rule] ?? (group === 'visual' ? 80 : 20)
  const correlation = origin === 'correlated' ? 30 : 0
  const confidence = issue.confidence === 'certain' ? 16 : issue.confidence === 'probable' ? 8 : 0
  const coverage = issue.coverage === 'standard' ? 12 : issue.coverage === 'heuristique' ? 6 : 0
  // À impact comparable, une proposition réellement prévisualisable doit
  // apparaître avant une longue série de diagnostics purement consultatifs.
  const actionability = action === 'auto-safe' ? 80 : action === 'review-required' ? 60 : 0
  return groupPriority + severity + impact + correlation + confidence + coverage + actionability
}

/**
 * Établit la présentation et le niveau d'automatisation autorisé pour un
 * constat. La fonction est pure : `allIssues` n'est utilisé que pour trouver
 * une preuve runtime ayant exactement la même route et le même sélecteur.
 */
export function classifyProjectIssue(issue: ProjectIssue, allIssues: readonly ProjectIssue[] = [issue]): FindingPolicy {
  const correlations = matchingCorrelations(issue, allIssues)
  const baseOrigin = intrinsicOrigin(issue)
  const origin: FindingOrigin = baseOrigin === 'correlated' || correlations.length > 0 ? 'correlated' : baseOrigin
  const runtimeVisual = baseOrigin !== 'static' && isVisualRuntimeRule(issue.rule)
  const correlatedStaticVisual = STATIC_CSS_RESPONSIVE_RULES.has(issue.rule) && (baseOrigin === 'correlated' || correlations.length > 0)
  const group: FindingGroup = MISSING_VIEWPORT_RULES.has(issue.rule) || runtimeVisual || correlatedStaticVisual
    ? 'visual'
    : 'code'
  const verification = verificationFor(issue, group, origin)
  const action = actionFor(issue, group, verification, origin)

  return {
    group,
    verification,
    action,
    origin,
    priority: priorityFor(issue, group, origin, action),
    correlatedIssueIds: correlations.map((candidate) => candidate.id)
  }
}

export function classifyProjectIssues(issues: readonly ProjectIssue[]): readonly ClassifiedProjectIssue[] {
  return issues.map((issue) => ({ issue, policy: classifyProjectIssue(issue, issues) }))
}

export function prioritizeProjectIssues(
  issues: readonly ProjectIssue[],
  options: PrioritizeProjectIssuesOptions | number = {}
): readonly ClassifiedProjectIssue[] {
  const normalizedOptions = typeof options === 'number' ? { max: options } : options
  const max = normalizedOptions.max === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.floor(Number.isFinite(normalizedOptions.max) ? normalizedOptions.max : 0))

  return classifyProjectIssues(issues)
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => !normalizedOptions.group || finding.policy.group === normalizedOptions.group)
    .sort((left, right) => right.finding.policy.priority - left.finding.policy.priority || left.index - right.index)
    .slice(0, max)
    .map(({ finding }) => finding)
}

export function groupProjectIssues(issues: readonly ProjectIssue[]): GroupedProjectIssues {
  const groups: { visual: ClassifiedProjectIssue[]; code: ClassifiedProjectIssue[] } = { visual: [], code: [] }
  for (const finding of prioritizeProjectIssues(issues)) groups[finding.policy.group].push(finding)
  return groups
}

const SEVERITY_RANK: Readonly<Record<ProjectIssue['severity'], number>> = {
  information: 0,
  attention: 1,
  bloquant: 2
}

/**
 * Fusionne une heuristique CSS statique avec sa preuve visuelle exacte
 * (même route et même sélecteur). L’identifiant et le correctif source sont
 * conservés, tandis que le titre, le viewport et la preuve viennent du rendu.
 * Un signal runtime n’est consommé qu’une fois afin d’éviter les doublons.
 */
export function consolidateProjectIssues(
  issues: readonly ProjectIssue[],
  allIssues: readonly ProjectIssue[] = issues
): readonly ProjectIssue[] {
  const visibleIds = new Set(issues.map((issue) => issue.id))
  const byId = new Map(allIssues.map((issue) => [issue.id, issue]))
  const consumedRuntimeIds = new Set<string>()
  const replacements = new Map<string, ProjectIssue>()

  for (const issue of issues) {
    if (intrinsicOrigin(issue) !== 'static' || (!STATIC_CSS_RESPONSIVE_RULES.has(issue.rule) && !MISSING_VIEWPORT_RULES.has(issue.rule))) continue
    const candidates = classifyProjectIssue(issue, allIssues).correlatedIssueIds
      .map((id) => byId.get(id))
      .filter((candidate): candidate is ProjectIssue => Boolean(candidate && visibleIds.has(candidate.id) && !consumedRuntimeIds.has(candidate.id)))
      .sort((left, right) => priorityFor(right, 'visual', intrinsicOrigin(right), 'review-required') - priorityFor(left, 'visual', intrinsicOrigin(left), 'review-required'))
    const runtime = candidates[0]
    if (!runtime) continue
    consumedRuntimeIds.add(runtime.id)
    replacements.set(issue.id, {
      ...issue,
      title: runtime.title,
      description: runtime.description,
      viewport: runtime.viewport,
      routePath: runtime.routePath ?? issue.routePath,
      evidence: runtime.evidence,
      severity: SEVERITY_RANK[runtime.severity] > SEVERITY_RANK[issue.severity] ? runtime.severity : issue.severity,
      coverage: runtime.coverage ?? issue.coverage
    })
  }

  return issues
    .filter((issue) => !consumedRuntimeIds.has(issue.id))
    .map((issue) => replacements.get(issue.id) ?? issue)
}
