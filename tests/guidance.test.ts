import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GUIDE_DESTINATIONS,
  getPageGuidance,
  type GuideChapterId,
  type GuideDestination
} from '../src/renderer/src/guidance.ts'

const expectedDestinations: GuideDestination[] = ['projects', 'lab', 'matrix', 'visual', 'code', 'review', 'export']
const chapters = new Set<GuideChapterId>(['welcome', 'sources', 'laboratory', 'diagnosis', 'workspaces', 'delivery'])

test('le contenu contextuel couvre exactement les sept destinations du menu', () => {
  assert.deepEqual([...GUIDE_DESTINATIONS], expectedDestinations)
  assert.equal(new Set(GUIDE_DESTINATIONS).size, 7)

  for (const destination of GUIDE_DESTINATIONS) {
    const guidance = getPageGuidance(destination)
    assert.equal(guidance.destination, destination)
    assert.ok(guidance.label.trim())
    assert.ok(guidance.title.trim())
    assert.ok(guidance.steps.length > 0 && guidance.steps.length <= 3, `${destination} expose ${guidance.steps.length} étapes.`)
    assert.ok(guidance.steps.every((step) => step.title.trim() && step.detail.trim()))
    assert.ok(guidance.note.title.trim() && guidance.note.detail.trim())
    assert.equal(chapters.has(guidance.tourChapter), true, `Chapitre inconnu pour ${destination}.`)
  }
})

test('chaque page mène au chapitre pertinent du guide complet', () => {
  assert.deepEqual(Object.fromEntries(GUIDE_DESTINATIONS.map((destination) => [destination, getPageGuidance(destination).tourChapter])), {
    projects: 'sources',
    lab: 'laboratory',
    matrix: 'diagnosis',
    visual: 'workspaces',
    code: 'workspaces',
    review: 'delivery',
    export: 'delivery'
  })
})

test('le Laboratoire explique le mode actif et les limites de synchronisation distantes', () => {
  const device = getPageGuidance('lab', { sourceKind: 'local-project', labMode: 'device' })
  const studio = getPageGuidance('lab', { sourceKind: 'local-project', labMode: 'studio' })
  const remote = getPageGuidance('lab', { sourceKind: 'remote-url', labMode: 'studio' })

  assert.notEqual(device.title, studio.title)
  assert.match(device.steps[0].detail, /dimensions|cadre/i)
  assert.match(studio.steps[0].detail, /un à cinq|Alignés|Grille|Focus/i)
  assert.match(remote.note.detail, /navigation et défilement/i)
  assert.match(remote.note.detail, /Clics, champs et formulaires restent isolés/i)
  assert.match(studio.note.detail, /Matrice/i)
})

test('les notes d’édition distinguent projet local, localhost lié et URL publique', () => {
  const localCode = getPageGuidance('code', { sourceKind: 'local-project' })
  const linkedCode = getPageGuidance('code', { sourceKind: 'linked-localhost' })
  const remoteCode = getPageGuidance('code', { sourceKind: 'remote-url' })
  const linkedVisual = getPageGuidance('visual', { sourceKind: 'linked-localhost' })

  assert.match(localCode.note.detail, /overlay en mémoire/i)
  assert.match(linkedCode.note.detail, /CSS est injecté immédiatement/i)
  assert.match(linkedCode.note.detail, /serveur/i)
  assert.match(remoteCode.note.detail, /ne reconstruit pas les sources auteur/i)
  assert.match(linkedVisual.note.detail, /composition directe reste désactivée/i)
})

test('Exporter adapte le parcours et la livraison au niveau d’accès', () => {
  const local = getPageGuidance('export', { sourceKind: 'local-project', hasStaging: true })
  const linked = getPageGuidance('export', { sourceKind: 'linked-localhost', hasStaging: true })
  const remote = getPageGuidance('export', { sourceKind: 'remote-url' })

  assert.match(local.title, /version révisée/i)
  assert.match(local.note.detail, /patch.*fichiers modifiés.*copie complète/i)
  assert.match(linked.note.detail, /framework associé/i)
  assert.match(remote.title, /rapport d’audit/i)
  assert.match(remote.steps[0].detail, /Markdown/i)
  assert.match(remote.steps[1].detail, /JSON/i)
  assert.match(remote.note.detail, /aucune modification distante/i)
})

test('Révision annonce clairement la frontière d’écriture', () => {
  const prepared = getPageGuidance('review', { sourceKind: 'local-project', hasStaging: true })
  const unavailable = getPageGuidance('review', { sourceKind: 'remote-url' })

  assert.match(prepared.title, /version préparée/i)
  assert.match(prepared.note.detail, /Aucune source n’est écrite avant Appliquer au projet/i)
  assert.match(unavailable.note.detail, /exige un projet local durable/i)
})
