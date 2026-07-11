import type { ProjectSnapshot } from './contracts'

export type FrameworkAuditAccess = 'ready' | 'build-or-localhost' | 'read-only'
export type FrameworkEditingAccess = 'automatic-html-css' | 'associated-sources' | 'artifact-only' | 'read-only' | 'unavailable'

export interface FrameworkSupportSummary {
  stack: string
  audit: FrameworkAuditAccess
  editing: FrameworkEditingAccess
  auditLabel: string
  editingLabel: string
  detail: string
  supportsLiveCss: boolean
  durableAutomaticFixes: boolean
}

type FrameworkProject = Pick<ProjectSnapshot, 'source' | 'capabilities' | 'previewReadiness' | 'previewBasePath'>

export function frameworkSupportFor(project: FrameworkProject): FrameworkSupportSummary {
  const stack = project.capabilities.framework ?? (project.source.kind === 'remote-url' ? 'Site public' : 'HTML / CSS')

  if (project.source.kind === 'remote-url') {
    return {
      stack,
      audit: 'read-only',
      editing: 'read-only',
      auditLabel: 'Audit complet en lecture seule',
      editingLabel: 'Sources non disponibles',
      detail: 'Le rendu peut être mesuré sur plusieurs formats, mais Responsiver ne peut pas reconstruire le code auteur depuis les fichiers servis.',
      supportsLiveCss: false,
      durableAutomaticFixes: false
    }
  }

  if (project.source.kind === 'linked-localhost') {
    const associated = Boolean(project.source.localRoot)
    return {
      stack,
      audit: 'ready',
      editing: associated ? 'associated-sources' : 'read-only',
      auditLabel: 'Rendu réel via localhost',
      editingLabel: associated ? 'Sources associées' : 'Associer le dossier pour modifier',
      detail: associated
        ? 'Le CSS est prévisualisé immédiatement. Les fichiers de framework sont appliqués explicitement puis rechargés par le serveur ou son HMR.'
        : 'L’audit reste disponible ; aucune écriture n’est possible tant que le dossier source n’a pas été choisi.',
      supportsLiveCss: associated,
      durableAutomaticFixes: false
    }
  }

  if (project.previewReadiness.status === 'needs-build' || project.previewReadiness.status === 'blocked') {
    return {
      stack,
      audit: 'build-or-localhost',
      editing: project.capabilities.staging ? 'associated-sources' : 'unavailable',
      auditLabel: 'Build ou localhost requis',
      editingLabel: project.capabilities.staging ? 'Sources consultables' : 'Rendu indisponible',
      detail: 'Responsiver ne lance aucune commande du projet. Produisez une sortie statique ou connectez le serveur de développement déjà lancé.',
      supportsLiveCss: false,
      durableAutomaticFixes: false
    }
  }

  if (project.previewBasePath || project.capabilities.previewStrategy === 'artifact') {
    return {
      stack,
      audit: 'ready',
      editing: 'artifact-only',
      auditLabel: 'Sortie compilée analysée',
      editingLabel: 'Correctifs sur l’artefact',
      detail: 'Les corrections HTML/CSS sont prévisualisables, mais un prochain build peut les écraser. Elles doivent ensuite être reportées dans les sources auteur.',
      supportsLiveCss: true,
      durableAutomaticFixes: false
    }
  }

  return {
    stack,
    audit: 'ready',
    editing: project.capabilities.staging ? 'automatic-html-css' : 'unavailable',
    auditLabel: 'Projet local prêt',
    editingLabel: project.capabilities.staging ? 'Correctifs HTML/CSS durables' : 'Aucun correctif automatique',
    detail: project.capabilities.staging
      ? 'Les transformations HTML/CSS ciblées peuvent être préparées, comparées puis appliquées atomiquement aux sources.'
      : 'Le rendu reste analysable, mais aucun adaptateur de correction sûr n’est disponible pour cette entrée.',
    supportsLiveCss: project.capabilities.staging,
    durableAutomaticFixes: project.capabilities.staging
  }
}
