import type { AuditSourceKind } from '../../shared/contracts'

export const GUIDE_DESTINATIONS = ['projects', 'lab', 'matrix', 'visual', 'code', 'review', 'export'] as const

export type GuideDestination = typeof GUIDE_DESTINATIONS[number]
export type GuideChapterId = 'welcome' | 'sources' | 'laboratory' | 'diagnosis' | 'workspaces' | 'delivery'
export type GuideLabMode = 'device' | 'studio'

export interface PageGuidanceContext {
  sourceKind?: AuditSourceKind | null
  labMode?: GuideLabMode
  hasStaging?: boolean
}

export interface PageGuidanceStep {
  title: string
  detail: string
}

export interface PageGuidance {
  destination: GuideDestination
  label: string
  title: string
  steps: PageGuidanceStep[]
  note: {
    title: string
    detail: string
  }
  tourChapter: GuideChapterId
}

function projectsGuidance(): PageGuidance {
  return {
    destination: 'projects',
    label: 'Projets',
    title: 'Ouvrir la bonne source',
    tourChapter: 'sources',
    steps: [
      { title: 'Choisissez le niveau d’accès', detail: 'Un projet local est modifiable, un localhost peut être associé à ses sources et une URL publique reste en lecture seule.' },
      { title: 'Laissez préparer le rendu', detail: 'Responsiver inventorie les routes, analyse le code et vérifie la preview avant d’ouvrir le Laboratoire.' },
      { title: 'Reprenez sans dupliquer', detail: 'Les anciens projets mémorisent leur chemin puis sont relus depuis le disque à chaque ouverture.' }
    ],
    note: { title: 'Local par défaut', detail: 'Aucune source n’est envoyée et Responsiver ne lance ni build, backend, base de données ou conteneur.' }
  }
}

function laboratoryGuidance(context: PageGuidanceContext): PageGuidance {
  const studio = context.labMode === 'studio'
  const sourceKind = context.sourceKind ?? null
  const note = sourceKind === 'remote-url'
    ? 'Les vues liées partagent navigation et défilement. Clics, champs et formulaires restent isolés entre les sessions distantes.'
    : sourceKind === 'linked-localhost'
      ? 'Le localhost reste une session réelle : navigation et défilement peuvent suivre le pilote, jamais les clics ni les formulaires.'
      : 'Le Studio accélère l’exploration ; la Matrice fournit ensuite la preuve reproductible. Les interactions sûres ne sont partagées que si vous les activez.'
  return {
    destination: 'lab',
    label: 'Laboratoire',
    title: studio ? 'Piloter une planche d’écrans' : 'Examiner un écran précis',
    tourChapter: 'laboratory',
    steps: [
      studio
        ? { title: 'Composez la planche', detail: 'Affichez de un à cinq formats, puis choisissez une disposition Alignés, Grille ou Focus.' }
        : { title: 'Réglez le viewport', detail: 'Choisissez un appareil, saisissez ses dimensions ou redimensionnez directement le cadre.' },
      { title: 'Maîtrisez la synchronisation', detail: 'Le pilote diffuse route et défilement aux vues liées ; une vue isolée conserve son propre parcours.' },
      { title: 'Ouvrez la preuve utile', detail: 'Inspectez un élément ou ouvrez un constat dans son contexte avant de comparer et valider un correctif.' }
    ],
    note: { title: 'Exploration, puis vérification', detail: note }
  }
}

function matrixGuidance(): PageGuidance {
  return {
    destination: 'matrix',
    label: 'Matrice',
    title: 'Vérifier sans régression',
    tourChapter: 'diagnosis',
    steps: [
      { title: 'Mesurez la source', detail: 'Responsiver rejoue les routes, tailles et états canoniques dans un Chromium isolé.' },
      { title: 'Comparez le candidat', detail: 'Préparez des corrections, puis mesurez exactement cette version avant toute autorisation d’écriture.' },
      { title: 'Ouvrez une cellule', detail: 'Un clic restaure la route, le viewport et l’état concernés dans le Laboratoire.' }
    ],
    note: { title: 'Preuve locale', detail: 'La Matrice est réservée au runner local et ne modifie aucun fichier pendant ses passages.' }
  }
}

function visualGuidance(context: PageGuidanceContext): PageGuidance {
  const sourceKind = context.sourceKind ?? null
  const note = sourceKind === 'remote-url'
    ? 'Une URL sans sources reste inspectable dans le Laboratoire, mais ne peut pas être modifiée dans l’Atelier.'
    : sourceKind === 'linked-localhost'
      ? 'Le CSS peut être prévisualisé sur le localhost. La composition directe reste désactivée et le résultat se prépare comme CSS à intégrer.'
      : 'Les réglages restent dans une preview temporaire jusqu’à Réviser sans modifier ou Appliquer aux fichiers.'
  return {
    destination: 'visual',
    label: 'Atelier visuel',
    title: 'Ajuster depuis le rendu',
    tourChapter: 'workspaces',
    steps: [
      { title: 'Choisissez le bon mode', detail: 'Composer manipule la page figée, Inspecter cible un élément, Tester rend les interactions et Avant/après compare.' },
      { title: 'Définissez la portée', detail: 'Limitez chaque réglage aux tailles et aux pages réellement concernées.' },
      { title: 'Contrôlez avant d’écrire', detail: 'Testez le vrai site, relisez les changements puis révisez ou appliquez explicitement.' }
    ],
    note: { title: 'Preview réversible', detail: note }
  }
}

function codeGuidance(context: PageGuidanceContext): PageGuidance {
  const sourceKind = context.sourceKind ?? null
  const note = sourceKind === 'remote-url'
    ? 'Responsiver ne reconstruit pas les sources auteur d’un site public : cet espace reste en lecture seule sans dossier associé.'
    : sourceKind === 'linked-localhost'
      ? 'Le CSS est injecté immédiatement ; les templates et scripts ne changent le rendu qu’après validation du fichier et rechargement par votre serveur.'
      : 'La frappe reste dans un overlay en mémoire. Le disque change uniquement avec Appliquer au fichier.'
  return {
    destination: 'code',
    label: 'Code',
    title: 'Modifier avec le rendu visible',
    tourChapter: 'workspaces',
    steps: [
      { title: 'Choisissez le fichier', detail: 'L’explorateur limite la liste aux sources texte pertinentes et exclut secrets, dépendances et binaires.' },
      { title: 'Contrôlez le résultat', detail: 'La preview, l’inspecteur et le diff restent disponibles pendant l’édition.' },
      { title: 'Validez un fichier', detail: 'Écartez l’overlay ou appliquez uniquement le fichier relu, avec contrôle de version avant écriture.' }
    ],
    note: { title: 'Écriture explicite', detail: note }
  }
}

function reviewGuidance(context: PageGuidanceContext): PageGuidance {
  const sourceKind = context.sourceKind ?? null
  const note = sourceKind === 'local-project'
    ? 'Aucune source n’est écrite avant Appliquer au projet ; la dernière application validée reste annulable.'
    : 'La révision d’une version corrigée exige un projet local durable. Utilisez l’Atelier ou Exporter pour cette source.'
  return {
    destination: 'review',
    label: 'Révision',
    title: context.hasStaging ? 'Relire la version préparée' : 'Préparer une version à relire',
    tourChapter: 'delivery',
    steps: [
      { title: 'Comparez le rendu', detail: 'Vérifiez la version actuelle et la version corrigée au même viewport et sur la même route.' },
      { title: 'Relisez les fichiers', detail: 'Contrôlez chaque diff, le nombre de changements et les fichiers réellement touchés.' },
      { title: 'Choisissez la sortie', detail: 'Supprimez la préparation, copiez le patch ou appliquez exactement la version révisée.' }
    ],
    note: { title: 'Dernière autorisation', detail: note }
  }
}

function exportGuidance(context: PageGuidanceContext): PageGuidance {
  const sourceKind = context.sourceKind ?? null
  const remote = sourceKind === 'remote-url'
  const linked = sourceKind === 'linked-localhost'
  const note = remote
    ? 'Un audit URL produit une synthèse Markdown ou un rapport JSON ; aucune modification distante n’est possible.'
    : linked
      ? 'Le CSS préparé et le rapport peuvent être livrés sans écrire silencieusement dans le framework associé.'
      : 'Le patch, les fichiers modifiés ou la copie complète sont générés sans altérer le projet original.'
  return {
    destination: 'export',
    label: 'Exporter',
    title: remote ? 'Livrer le rapport d’audit' : context.hasStaging ? 'Livrer la version révisée' : 'Préparer une livraison',
    tourChapter: 'delivery',
    steps: remote ? [
      { title: 'Copiez la synthèse', detail: 'Un résumé Markdown reprend routes, viewports, constats et solutions à vérifier.' },
      { title: 'Conservez les preuves', detail: 'Le rapport JSON garde les mesures et le contexte de chaque constat.' },
      { title: 'Poursuivez dans les sources', detail: 'Associez le projet local si vous souhaitez transformer ces constats en changements.' }
    ] : [
      { title: 'Choisissez le périmètre', detail: 'Copiez le patch, exportez seulement les fichiers changés ou créez une copie complète.' },
      { title: 'Conservez la traçabilité', detail: 'Le rapport d’analyse et le fichier .patch restent disponibles séparément.' },
      { title: 'Vérifiez la destination', detail: 'Responsiver écrit uniquement dans l’emplacement choisi et laisse l’original intact.' }
    ],
    note: { title: 'Sortie maîtrisée', detail: note }
  }
}

export function getPageGuidance(destination: GuideDestination, context: PageGuidanceContext = {}): PageGuidance {
  switch (destination) {
    case 'projects': return projectsGuidance()
    case 'lab': return laboratoryGuidance(context)
    case 'matrix': return matrixGuidance()
    case 'visual': return visualGuidance(context)
    case 'code': return codeGuidance(context)
    case 'review': return reviewGuidance(context)
    case 'export': return exportGuidance(context)
  }
}
