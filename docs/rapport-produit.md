# Rapport produit — Responsiver 0.5

## Résultat

Responsiver est un atelier desktop local utilisable sur des projets statiques ou déjà compilés. La version 0.5 fiabilise l’entrée dans le laboratoire : préparation complète dès l’import, artefact compilé monté automatiquement, projet incomplet bloqué avec diagnostic, smoke-test du rendu réel et historique local sans cache de code. Les propositions, validations et exports de la version précédente restent séparés et non destructifs.

La direction UI s’appuie sur les principes observés dans [Agency Agents](https://github.com/msitarzewski/agency-agents) et son application compagnon — espace de travail opérationnel, hiérarchie nette, panneau maître/détail et traçabilité — sans copier leur code, leurs assets ou leur identité. Le résultat adopte sa propre grammaire : rail graphite, papier minéral, accent vermillon, densité d’outil professionnel, contrôles compacts et absence de gradients ou de cartes SaaS décoratives.

## Traçabilité des demandes

| Demande | Livraison | Preuve ou critère de validation |
|---|---|---|
| Déposer un fichier ou dossier | Sélecteurs séparés, chemin local et glisser-déposer | API preload typée + parcours Electron |
| Analyser dès l’import | Pipeline en six étapes avant redirection, overlay différé si l’attente devient visible | Progression IPC + E2E Electron |
| Éviter toute preview blanche silencieuse | Readiness statique puis smoke-test runtime à 600/1 800 ms | Fixture incomplète et bundle en erreur |
| Réutiliser les anciens projets | Chemins locaux persistés, disponibilité vérifiée et réanalyse complète | Store atomique + parcours Electron |
| Prévisualiser une sortie compilée existante | Détection et mount canonique, y compris imbriqué, de `dist`, `build`, `out`, `.output/public` | Tests moteur et serveur |
| Voir le vrai site | Serveur loopback interactif, scripts et assets locaux | Démo et Portfolio V.0.4 servis |
| Naviguer dans toutes les pages et démos | Routes détectées, liens, ancres, historique, popups internes | Navigation `index ↔ journal` et routes Portfolio |
| Smartphone, tablette, ordinateur | Familles séparées, modèles connus, dimensions libres, rotation | UI + test E2E |
| Redimensionner comme une fenêtre | Poignées sur les bords et angles, synchronisées avec les dimensions personnalisées | Dimensions modifiées par geste puis relues dans les champs |
| Voir le site en grand | Scène de preview en plein écran, fermeture explicite et touche Échap | Entrée/sortie plein écran en E2E |
| Comparer plusieurs tailles | Trois aperçus simultanés | Test E2E, trois iframes |
| Éviter la pollution des démos | Analyse CSS par route et filtre « Page active / Toutes les pages » | Portfolio : entrée racine prioritaire |
| Détecter les défauts responsive | Règles HTML/CSS + mesure runtime des débordements | Tests moteur et serveur |
| Corriger sans IA | Transformations PostCSS et overrides CSS déterministes | Patch comparé aux overlays |
| Ouvrir un constat dans son contexte | Activation de sa route, recherche de son sélecteur, centrage et repère visuel | Messages bridge + vérification dans les deux previews |
| Voir l’avant/après avant de décider | Origines Source et Proposition distinctes, synchronisées par route et taille | Comparaison contextualisée en E2E |
| Accepter ou refuser chaque correctif | Consultation sans effet, puis actions explicites « Valider » et « Écarter » | Sélection retenue vérifiée avant staging |
| Séparer proposition et export | Proposition éphémère non exportable ; staging reconstruit avec les seules décisions validées | E2E proposition → validation → staging |
| Copier ou télécharger le code changé | Presse-papiers, `.patch`, fichiers modifiés, copie complète | IPC et sécurités d’export |
| Ne pas masquer la nature d’un artefact | Avertissement au laboratoire, en révision et à l’export ; patch à reporter dans les sources | Présence conditionnelle sur `previewBasePath` |
| Demander un ajustement par chat | Grammaire locale couleur/espacement/rayon/texte/navigation | E2E conversation sans IA |
| Prévisualiser un thème clair ou sombre | Le choix affiche une proposition si la variante manque, ou active la variante native si elle existe | Attribut, palette et origine contrôlés dans la preview |
| Valider le thème séparément | Aperçu non validé, validation ou rejet explicite, puis inclusion conditionnelle au staging | État candidat/validé vérifié en E2E |
| Générer un thème complémentaire | Génération sémantique claire pour un site sombre, sombre pour un site clair | Démo sombre → variante claire |
| Ne pas proposer un doublon | Détection `dark/light/dual` statique et runtime | Test dédié thème existant |
| Démo fonctionnelle | Atelier Nord multi-page, filtres et panier | Même runner, E2E packagé |
| UI/UX premium et lisible | Workbench à quatre destinations, inspecteur maître/détail, modes Appareils et Avant/Après séparés | QA à 1024/1280 et Electron Retina |
| Fonctionnement local et open source | Aucune API produit, télémétrie ou IA ; licences documentées | Audit npm et notices |
| Distribution GitHub | Paquets macOS/Windows/Linux, notices embarquées, SBOM et `SHA256SUMS` | Workflow bloquant sur formats, tag et empreintes |
| Commits français | Historique découpé par capacité | Vérification Git finale |

## Choix techniques

- **Electron** : distribution desktop multi-plateforme, dialogues et isolation de contexte.
- **React + TypeScript** : interface structurée et contrats partagés renderer/main.
- **PostCSS** : lecture et modification ciblée des déclarations CSS sans génération probabiliste.
- **Serveur HTTP Node local** : comportement navigateur réaliste, navigation et assets relatifs.
- **Store JSON main-process** : historique MRU minimal, privé, atomique et indépendant du renderer.
- **Overlays en mémoire** : une couche de proposition remplaçable pour décider, puis une couche de staging reconstruite pour exporter.
- **Playwright** : validation du parcours Electron réel et du paquet construit.
- **electron-builder** : DMG/ZIP, NSIS/ZIP, AppImage/DEB et automatisation GitHub.

Les réglages de la fenêtre suivent les recommandations de sécurité d’[Electron](https://www.electronjs.org/docs/latest/tutorial/security) : isolation de contexte, sandbox, CSP, restrictions de navigation et validation IPC.

## Cycle de décision

Le laboratoire conserve trois références distinctes :

- **Source** : rendu original en lecture seule, jamais transformé sur disque.
- **Proposition** : rendu temporaire du constat ou du thème en cours d’examen. Ouvrir, redimensionner ou afficher ce rendu en plein écran ne l’accepte pas.
- **Staging** : rendu cumulatif des seuls constats acceptés, du thème validé et des instructions locales retenues ; il sert à la révision finale et aux exports.

Un clic sur un constat active son chemin de page et transmet son sélecteur aux deux previews Avant / Après. Le bridge centre et signale la cible lorsqu’elle existe. Cette contextualisation permet de décider au niveau de l’élément concerné sans mélanger la comparaison d’un correctif avec le mode de comparaison des familles d’appareils.

Le thème suit le même contrat lorsqu’une variante doit être créée : cliquer sur **Clair** ou **Sombre** affiche immédiatement la proposition, mais un bouton distinct est nécessaire pour la valider. Une variante déjà présente est simplement activée dans la source pour inspection et n’ajoute aucun faux correctif. Un rejet n’affecte ni la source ni les décisions déjà retenues. À chaque étape, les données restent dans la session locale et une nouvelle proposition remplace la précédente.

## Confidentialité, licences et coût

Le runtime ne nécessite aucun abonnement, serveur ou clé API. Google Fonts reste la seule exception réseau autorisée pour conserver le rendu d’un projet qui la référence déjà. Les workflows GitHub et le téléchargement npm interviennent uniquement pendant le développement et la construction.

L’historique contient seulement les chemins canoniques et des métadonnées sommaires. Les sources, previews et correctifs ne sont pas dupliqués ; rouvrir signifie toujours valider le chemin, réanalyser et recréer le runner.

Les licences MIT/Apache-2.0 imposent de conserver leurs avis ; elles ne demandent pas de paiement. GitHub et Google Fonts ont également leurs propres conditions. Le projet est donc sans coût logiciel obligatoire, mais pas « sans aucune obligation juridique ». Les fichiers `LICENSE`, `NOTICE` et `THIRD_PARTY_NOTICES.md` organisent ces obligations.

Les binaires sont non signés par défaut. C’est compatible avec une distribution gratuite depuis GitHub, mais les systèmes d’exploitation peuvent avertir l’utilisateur. Supprimer ces avertissements demanderait des certificats et, selon la plateforme, un programme développeur payant.

## Limites assumées

- Le runner cible les sites statiques ou les sorties déjà compilées ; il n’exécute pas de build arbitraire, de backend ou de SSR.
- Un projet sans contenu exploitable ne peut pas être « rendu compatible » automatiquement : Responsiver expose précisément les fichiers incomplets au lieu d’inventer l’interface.
- Les heuristiques CSS proposent des corrections à relire, pas une preuve universelle de défaut.
- Un constat sans sélecteur exploitable ouvre sa route mais ne peut pas garantir un centrage au niveau d’un élément précis.
- Le rendu correspond à Chromium/Electron ; un futur élargissement pourra automatiser Firefox et WebKit.
- Les dépendances distantes hors Google Fonts sont bloquées et doivent être intégrées localement après vérification de licence.
- La signature/notarisation des paquets reste volontairement hors scope tant qu’elle n’est pas décidée et financée.

## Validation réalisée pour la livraison 0.5

Le dépôt contient 35 tests unitaires et d’intégration. Sur le diff consolidé, les contrôles reproductibles dans l’environnement local restreint ont donné :

- `npm run typecheck` et `npm run build` : réussis ;
- analyseur : 18/18, historique : 6/6, sécurité d’export : 4/4 ;
- syntaxe du bridge injecté, du scénario Electron et du workflow YAML : validée ;
- génération locale du SBOM : SPDX 2.3, inventaire non vide ;
- dernier parcours `npm run test:e2e` complet : réussi après la consolidation renderer (runtime, thème par route, SPA, clavier, plein écran, staging et historique) ;
- les six tests HTTP restants, le nouvel E2E complet et `package:dir` doivent être rejoués par la CI dans un environnement autorisant l’écoute `127.0.0.1` et les téléchargements Electron ; le sandbox local final a refusé ces deux capacités.

Les scénarios fonctionnels déjà exercés couvrent :

- démo : navigation, constat → route et sélecteur → Avant / Après → rejet ou validation → staging ;
- thème : clic Clair → proposition immédiate → validation explicite → staging conditionnel ;
- preview : dimensions prédéfinies → redimensionnement manuel → plein écran avec focus dans l’iframe → retour par Échap ;
- import : squelette HTML incomplet → quatre diagnostics manuels → aucun runner blanc ; bundle JS en erreur → détection runtime ;
- historique : anciens projets relus depuis leur chemin puis retrait sans suppression des sources ;
- Portfolio V.0.4 : `/index.html` sélectionné, 3 routes navigables, thème sombre détecté, variante claire prévisualisée sans validation implicite, ressource Font Awesome distante signalée et démos séparées.
- Site Jessica réel : `index.html` incomplet, CSS vide et médias orphelins correctement classés `blocked` ; aucune correction responsive fictive n’est générée.
