import assert from 'node:assert/strict'
import test from 'node:test'
import { frameworkSupportFor } from '../src/shared/framework-support.ts'
import type { ProjectSnapshot } from '../src/shared/contracts.ts'

function project(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: 'project', name: 'Projet', root: '/tmp/project', kind: 'Projet', files: 1,
    analyzedAt: new Date(0).toISOString(), issues: [], previewHtml: null, previewOrigin: null,
    previewBasePath: null, entryPath: '/index.html', routes: [],
    source: { kind: 'local-project', readOnly: false, url: null, localRoot: '/tmp/project', network: 'local-only' },
    previewReadiness: { status: 'ready', strategy: 'static', summary: 'Prêt', diagnostics: [] },
    theme: { detected: 'unknown', hasDark: false, hasLight: false, evidence: [], variables: [] },
    capabilities: { interactive: true, staging: true, framework: null, packageManager: null, buildRequired: false, previewStrategy: 'static' },
    analysis: { truncated: false, scannedFiles: 1, scannedStyles: 1 },
    ...overrides
  }
}

test('un projet statique expose le parcours automatique durable', () => {
  const support = frameworkSupportFor(project())
  assert.equal(support.editing, 'automatic-html-css')
  assert.equal(support.durableAutomaticFixes, true)
})

test('un artefact compilé reste corrigeable mais non durable', () => {
  const support = frameworkSupportFor(project({
    previewBasePath: 'dist',
    capabilities: { interactive: true, staging: true, framework: 'React + Tailwind CSS', packageManager: 'npm', buildRequired: false, previewStrategy: 'artifact' }
  }))
  assert.equal(support.stack, 'React + Tailwind CSS')
  assert.equal(support.editing, 'artifact-only')
  assert.equal(support.durableAutomaticFixes, false)
})

test('un localhost associé distingue audit universel et édition pilotée par le serveur', () => {
  const support = frameworkSupportFor(project({
    source: { kind: 'linked-localhost', readOnly: false, url: 'http://127.0.0.1:3000', localRoot: '/tmp/project', network: 'localhost' },
    capabilities: { interactive: true, staging: false, framework: 'Symfony + Tailwind CSS', packageManager: 'Composer', buildRequired: false, previewStrategy: 'source' }
  }))
  assert.equal(support.audit, 'ready')
  assert.equal(support.editing, 'associated-sources')
  assert.equal(support.supportsLiveCss, true)
  assert.equal(support.durableAutomaticFixes, false)
})

test('une URL publique reste strictement en lecture seule', () => {
  const support = frameworkSupportFor(project({
    source: { kind: 'remote-url', readOnly: true, url: 'https://example.test', localRoot: null, network: 'public' }
  }))
  assert.equal(support.audit, 'read-only')
  assert.equal(support.editing, 'read-only')
})
