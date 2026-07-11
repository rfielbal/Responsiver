import assert from 'node:assert/strict'
import test from 'node:test'

import type { ProjectIssue } from '../src/shared/contracts.ts'
import {
  classifyProjectIssue,
  consolidateProjectIssues,
  deterministicVisualTarget,
  groupProjectIssues,
  prioritizeProjectIssues
} from '../src/shared/finding-policy.ts'

function issue(overrides: Partial<ProjectIssue> & Pick<ProjectIssue, 'id' | 'rule'>): ProjectIssue {
  return {
    title: overrides.rule,
    description: 'Constat de test.',
    severity: 'attention',
    coverage: 'heuristique',
    viewport: '390 × 844',
    proposal: 'Corriger puis vérifier.',
    ...overrides
  }
}

function runtimeIssue(id: string, rule: string, route = '/index.html', selector = '.hero'): ProjectIssue {
  return issue({
    id,
    rule,
    routePath: route,
    evidence: {
      selector,
      route,
      viewport: { width: 390, height: 844 },
      measurements: { runtime: true }
    }
  })
}

test('classe les défauts visuels runtime sans promettre un correctif inexistant', () => {
  for (const rule of ['layout.element-overlap', 'typography.mobile-readability', 'interaction.small-target', 'media.image-distortion', 'accessibility.low-contrast']) {
    const policy = classifyProjectIssue(runtimeIssue(`runtime:${rule}`, rule))
    assert.equal(policy.group, 'visual')
    assert.equal(policy.origin, 'runtime')
    assert.equal(policy.verification, 'visual-before-after')
    assert.equal(policy.action, 'advisory')
  }

  const navigation = runtimeIssue('runtime:navigation', 'layout.navigation-wrap', '/index.html', 'header > .site-nav')
  assert.equal(deterministicVisualTarget(navigation), '.site-nav')
  assert.equal(classifyProjectIssue(navigation).action, 'review-required')
})

test('impose une double vérification au viewport manquant, même avec un correctif sûr', () => {
  const viewport = issue({
    id: 'viewport-static',
    rule: 'html.viewport-meta',
    severity: 'bloquant',
    coverage: 'standard',
    source: { file: 'index.html', line: 1 },
    fix: {
      kind: 'html-insert',
      file: 'index.html',
      confidence: 'safe',
      before: '<head>',
      after: '<meta name="viewport" content="width=device-width">'
    }
  })
  const policy = classifyProjectIssue(viewport)
  assert.equal(policy.group, 'visual')
  assert.equal(policy.origin, 'static')
  assert.equal(policy.verification, 'both')
  assert.equal(policy.action, 'review-required')
})

test('conserve les heuristiques CSS statiques dans le code tant que le rendu ne les confirme pas', () => {
  for (const rule of ['css.fixed-width', 'css.min-width-mobile', 'css.nowrap']) {
    const finding = issue({
      id: rule,
      rule,
      routePath: '/index.html',
      source: { file: 'styles.css', line: 12 },
      fix: {
        kind: 'css-replace',
        file: 'styles.css',
        confidence: 'review',
        selector: '.hero',
        property: 'width',
        before: '900px',
        after: 'min(100%, 900px)'
      }
    })
    const policy = classifyProjectIssue(finding)
    assert.equal(policy.group, 'code')
    assert.equal(policy.origin, 'static')
    assert.equal(policy.verification, 'source-diff')
    assert.equal(policy.action, 'review-required')
  }

  const unresolved = classifyProjectIssue(issue({ id: 'nowrap-manual', rule: 'css.nowrap' }))
  assert.equal(unresolved.group, 'code')
  assert.equal(unresolved.verification, 'manual')
  assert.equal(unresolved.action, 'review-required')
})

test('corrèle seulement une heuristique CSS et une preuve runtime de même route et même sélecteur', () => {
  const staticFinding = issue({
    id: 'static-width',
    rule: 'css.fixed-width',
    routePath: '/produit',
    source: { file: 'styles.css', line: 8 },
    fix: {
      kind: 'css-replace', file: 'styles.css', confidence: 'review', selector: '.hero > img',
      property: 'width', before: '900px', after: 'min(100%, 900px)'
    }
  })
  const runtimeFinding = runtimeIssue('runtime:overflow', 'layout.viewport-overflow', '/produit', '.hero>img')
  const wrongRoute = runtimeIssue('runtime:other', 'layout.viewport-overflow', '/autre', '.hero>img')

  const correlated = classifyProjectIssue(staticFinding, [staticFinding, runtimeFinding, wrongRoute])
  assert.equal(correlated.group, 'visual')
  assert.equal(correlated.origin, 'correlated')
  assert.equal(correlated.verification, 'both')
  assert.deepEqual(correlated.correlatedIssueIds, ['runtime:overflow'])

  const notCorrelated = classifyProjectIssue(staticFinding, [staticFinding, wrongRoute])
  assert.equal(notCorrelated.group, 'code')
  assert.equal(notCorrelated.origin, 'static')
})

test('fusionne la cause CSS et sa preuve runtime en un seul constat actionnable', () => {
  const staticFinding = issue({
    id: 'static-navigation',
    title: 'Largeur minimale rigide',
    rule: 'css.min-width-mobile',
    routePath: '/journal.html',
    source: { file: 'styles.css', line: 42 },
    fix: {
      kind: 'css-media-override', file: 'styles.css', confidence: 'review', selector: '.site-nav',
      property: 'min-width', before: '720px', after: '0', breakpoint: 768
    }
  })
  const runtimeFinding = runtimeIssue('runtime:navigation', 'layout.navigation-wrap', '/journal.html', '.site-nav')
  runtimeFinding.title = 'Navigation déséquilibrée à cette largeur'

  const consolidated = consolidateProjectIssues([staticFinding, runtimeFinding])
  assert.equal(consolidated.length, 1)
  assert.equal(consolidated[0].id, staticFinding.id)
  assert.equal(consolidated[0].title, runtimeFinding.title)
  assert.deepEqual(consolidated[0].source, staticFinding.source)
  assert.deepEqual(consolidated[0].evidence, runtimeFinding.evidence)
  const policy = classifyProjectIssue(consolidated[0], [staticFinding, runtimeFinding])
  assert.equal(policy.group, 'visual')
  assert.equal(policy.verification, 'both')
})

test('regroupe aussi le viewport manquant statique et runtime', () => {
  const staticViewport = issue({
    id: 'viewport-static', rule: 'html.viewport-meta', routePath: '/index.html',
    source: { file: 'index.html', line: 2 },
    fix: { kind: 'html-insert', file: 'index.html', confidence: 'safe', before: '<head>', after: '<meta name="viewport" content="width=device-width">' }
  })
  const runtimeViewport = runtimeIssue('viewport-runtime', 'responsive.missing-viewport', '/index.html', 'html')
  runtimeViewport.title = 'Viewport mobile non configuré'
  const consolidated = consolidateProjectIssues([staticViewport, runtimeViewport])
  assert.equal(consolidated.length, 1)
  assert.equal(consolidated[0].id, staticViewport.id)
  assert.equal(consolidated[0].title, runtimeViewport.title)
})

test('garde les diagnostics de build, réseau, parsing et page en conseil manuel', () => {
  for (const rule of ['build.required', 'network.external-resource', 'css.parse', 'runtime.page-error']) {
    const finding = rule === 'runtime.page-error'
      ? runtimeIssue(`runtime:${rule}`, rule)
      : issue({ id: rule, rule, source: { file: 'styles.css', line: 1 }, fix: { kind: 'manual', file: 'styles.css', confidence: 'review' } })
    const policy = classifyProjectIssue(finding)
    assert.equal(policy.group, 'code')
    assert.equal(policy.verification, 'manual')
    assert.equal(policy.action, 'advisory')
  }
})

test('n’autorise auto-safe que pour une cible source exacte, statique et non compilée', () => {
  const safe = issue({
    id: 'safe-css',
    rule: 'css.exact-replacement',
    source: { file: 'src/styles.css', line: 6 },
    fix: {
      kind: 'css-replace', file: 'src/styles.css', confidence: 'safe', selector: '.card',
      property: 'width', before: '800px', after: '100%'
    }
  })
  assert.equal(classifyProjectIssue(safe).action, 'auto-safe')

  const artifact = {
    ...safe,
    id: 'artifact-css',
    source: { file: 'dist/styles.css', line: 6 },
    fix: { ...safe.fix!, file: 'dist/styles.css' }
  }
  assert.equal(classifyProjectIssue(artifact).action, 'review-required')

  const ambiguous = { ...safe, id: 'runtime-safe', evidence: runtimeIssue('source', 'layout.viewport-overflow').evidence }
  const policy = classifyProjectIssue(ambiguous)
  assert.equal(policy.origin, 'correlated')
  assert.notEqual(policy.action, 'auto-safe')
})

test('priorise les défauts visuels impactants, respecte le maximum et groupe le résultat', () => {
  const findings = [
    issue({ id: 'build', rule: 'build.required', severity: 'bloquant' }),
    runtimeIssue('contrast', 'accessibility.low-contrast'),
    runtimeIssue('overlap', 'layout.element-overlap'),
    issue({ id: 'code', rule: 'css.nowrap', severity: 'information' })
  ]

  const firstTwo = prioritizeProjectIssues(findings, { max: 2 })
  assert.deepEqual(firstTwo.map(({ issue: finding }) => finding.id), ['overlap', 'contrast'])
  assert.ok(firstTwo.every(({ policy }) => policy.group === 'visual'))
  assert.deepEqual(prioritizeProjectIssues(findings, { group: 'code', max: 1 }).map(({ issue: finding }) => finding.id), ['build'])
  assert.deepEqual(prioritizeProjectIssues(findings, -1), [])

  const groups = groupProjectIssues(findings)
  assert.deepEqual(groups.visual.map(({ issue: finding }) => finding.id), ['overlap', 'contrast'])
  assert.deepEqual(groups.code.map(({ issue: finding }) => finding.id), ['build', 'code'])
})

test('place une correction visuelle actionnable avant les diagnostics consultatifs comparables', () => {
  const advisory = runtimeIssue('overflow', 'layout.viewport-overflow', '/index.html', '.site-nav')
  const actionable = runtimeIssue('navigation', 'layout.navigation-wrap', '/index.html', '.site-nav')
  assert.deepEqual(prioritizeProjectIssues([advisory, actionable]).map(({ issue: finding }) => finding.id), ['navigation', 'overflow'])
})
