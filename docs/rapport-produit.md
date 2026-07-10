# Rapport produit — Responsiver 0.6

## Résultat

Responsiver 0.6 élargit le laboratoire local à trois usages cohérents : travailler sur un projet local, auditer une URL publique en lecture seule et inspecter un localhost éventuellement lié à ses sources.

La version ajoute un rendu distant Chromium réellement navigable, un audit visuel sur cinq largeurs, un espace Monaco avec overlays et application explicite, un assistant facultatif connecté uniquement à Ollama ou llama.cpp en local, ainsi qu’un compagnon Chrome minimal. Les workflows déterministes de proposition, thème, avant/après, staging et export restent disponibles pour les projets locaux.

La direction UI conserve sa propre grammaire — rail graphite, papier minéral, accent vermillon, densité d’outil professionnel et panneaux maître/détail — en s’inspirant des principes opérationnels observés dans [Agency Agents](https://github.com/msitarzewski/agency-agents), sans reprendre son code, ses assets ou son identité.

## Traçabilité des demandes

| Demande | Livraison 0.6 | Limite ou preuve |
| --- | --- | --- |
| Déposer un fichier ou dossier | Sélecteurs, chemin et glisser-déposer | Pipeline local testé |
| Analyser dès l’import | Inventaire, routes, CSS, readiness et runner avant redirection | Progression IPC et tests moteur |
| Éviter les previews blanches | Verdict `ready/degraded/blocked/needs-build` et smoke-test runtime | Fixtures incomplètes et bundle en erreur |
| Retrouver les anciens projets | Historique de chemins, sans cache de code, avec réanalyse | Store privé et atomique |
| Voir plusieurs appareils | Presets, dimensions libres, rotation, poignées et plein écran | Preview locale et distante |
| Naviguer dans le site | Navigation multi-page locale ; arrière/avant/rechargement/adresse en URL | La route reste dans le périmètre autorisé |
| Auditer une URL publique | Session `WebContentsView` HTTPS en lecture seule | DNS et redirections anti-SSRF |
| Auditer un localhost | Boucle locale uniquement | Aucun accès LAN implicite |
| Travailler sur Symfony/MySQL/Docker | Connexion au localhost déjà lancé | Responsiver ne démarre ni backend, DB, conteneur ou migration |
| Associer le code au localhost | Dossier source facultatif, session `linked-localhost` | L’association est explicite |
| Détecter des problèmes visuels | Balayage distant 360/390/768/1024/1440 et audit runtime local sur huit règles | Routes visitées cumulées, pas de crawler autonome |
| Détecter les défauts objectifs | Overflow, clipping, texte, tactile, fixe, image, contraste, runtime | Ce n’est pas une note esthétique universelle |
| Ouvrir un constat dans son contexte | Route exacte, viewport, sélecteur, scroll et contour temporaire | L’interface signale si le sélecteur n’existe plus |
| Conserver l’audit URL | Agrégation de session, synthèse copiable et rapport JSON | Aucune persistance sans export explicite |
| Voir l’avant/après | Source et Proposition séparées | Projets locaux déterministes |
| Accepter ou refuser chaque correctif | Consultation sans effet puis décision explicite | Staging reconstruit uniquement avec les choix retenus |
| Prévisualiser clair/sombre | Activation native ou proposition complémentaire | Validation du thème séparée |
| Modifier le code soi-même | Monaco, explorateur, overlay, diff, écarter/appliquer | Écriture seulement via **Appliquer au fichier** |
| Voir immédiatement le résultat | Runner workspace local ; injection CSS sur localhost lié | HTML/JS distant dépendent du rechargement du serveur de dev |
| Protéger les sources | Secrets, binaires, builds, dépendances et symlinks exclus | Hash, version et renommage atomique |
| Ajouter une IA sans cloud | Connecteurs loopback Ollama et llama.cpp | Moteur et modèle non embarqués |
| Donner du contexte à l’IA | Constats, route, viewport, capture et fichiers bornés avec liste et cases d’inclusion | Aucun terminal ni accès disque direct |
| Valider une proposition IA | Chargement dans l’overlay Monaco, puis diff | Sortie modèle considérée non fiable |
| Ouvrir depuis Chrome | Manifest V3 `activeTab` + `nativeMessaging`, HTTPS public ou HTTP(S) loopback | Host acquitté, desktop non acquitté ; installation manuelle |
| Minimiser les données Chrome | URL/titre/viewport/DPR après clic | Aucun DOM, cookie, historique ou `<all_urls>` |
| Fonctionnement local-first | Pas de compte, télémétrie, API cloud ou fallback distant | Une URL auditée contacte nécessairement son site |
| Distribution GitHub | Paquets, notices, SBOM, hashes et ressources du compagnon | Paquets et compagnon encore non signés / partiellement manuels |

## Choix techniques

- **Electron** : desktop multi-plateforme, `WebContentsView`, sandbox et dialogues natifs.
- **React + TypeScript** : interface et contrats partagés renderer/preload/main.
- **PostCSS** : analyse et transformations CSS déterministes.
- **Serveurs Node loopback** : previews locale, proposition, staging et workspace.
- **Chrome DevTools Protocol** : métriques d’appareil et collecte visuelle dans la session distante.
- **Monaco Editor** : édition locale des sources texte.
- **Overlays en mémoire** : prévisualisation avant décision ou écriture.
- **Ollama / llama.cpp** : moteurs facultatifs externes, joints uniquement sur loopback.
- **Native Messaging** : compagnon Chrome sans permission globale sur les sites.
- **Playwright** : validation Electron et navigateur.
- **electron-builder** : paquets desktop et ressources compagnon.

## Deux cycles de modification

### Correctifs déterministes

```text
Source → Proposition éphémère → Accepter/Écarter → Staging → Export
```

La source reste intacte. Les fichiers sont re-hachés avant l’export et une modification concurrente invalide le staging.

### Éditeur et assistant

```text
Source → Overlay Monaco → Preview + Diff → Appliquer au fichier
```

La frappe et les propositions IA restent en mémoire. Le clic **Appliquer au fichier** autorise une écriture atomique dans la source. Si son hash ou sa version a changé, Responsiver refuse l’opération.

Cette distinction est volontaire : le staging sert à préparer une livraison non destructive ; Monaco sert à modifier réellement un fichier après confirmation.

## Analyse visuelle

Le moteur distant exécute les mêmes mesures sur cinq viewports et conserve des preuves structurées : sélecteur, rectangle, style, valeur observée, seuil attendu et confiance. Les résultats de la page sont assainis dans le processus principal avant de devenir des constats. Chaque nouvelle route visitée est auditée automatiquement et rejoint l’historique de session ; une réanalyse remplace seulement cette route. Les plafonds atteints sont visibles et exportés.

Le runner local complète désormais l’analyse statique avec huit familles de mesures runtime sur le viewport actif. Son message est à nouveau borné et assaini dans le renderer, car le JavaScript du projet reste une entrée non fiable.

Cette méthode détecte des incohérences mesurables, mais pas toutes les fautes de direction artistique. Sans maquette ou baseline approuvée, Responsiver ne peut pas savoir si une composition volontaire est « belle ». L’assistant local peut commenter une capture avec un modèle multimodal compatible, mais son avis reste probabiliste et non bloquant.

## IA locale et confidentialité

Le mode IA n’est ni une connexion ChatGPT, Claude ou Gemini, ni une API cloud. L’utilisateur fournit un moteur Ollama ou llama.cpp déjà actif sur sa machine et choisit un modèle installé.

Responsiver refuse toute adresse non loopback, toute redirection et tout identifiant dans l’endpoint. Il n’installe et ne télécharge aucun modèle. Le contexte transmis au processus local est sélectionné et borné ; les secrets et fichiers de données sont exclus de l’espace code.

Le modèle ne dispose d’aucun outil système. Ses propositions sont filtrées puis placées dans un overlay, jamais écrites directement. Cette architecture limite les conséquences d’une hallucination ou d’une prompt injection, mais ne remplace pas une revue du diff.

Un service présent sur loopback reste un logiciel distinct : l’utilisateur doit s’assurer qu’il s’agit bien de son moteur, contrôler ses journaux et vérifier la licence du modèle.

## Compagnon Chrome

Le compagnon est implémenté et empaqueté comme ressource, mais son installation reste destinée au développement et aux utilisateurs techniques :

- chargement manuel depuis `chrome://extensions` ;
- manifeste Native Messaging associé à l’identifiant exact ;
- host Node disponible sur macOS/Linux ;
- aucun host Windows autonome à ce stade ;
- aucun lancement automatique de Responsiver ;
- demandes supprimées si elles ont plus de dix minutes.

Ces limites sont détaillées dans [compagnon-chrome.md](compagnon-chrome.md). Le projet n’inclut plus de chantier Safari.

## Confidentialité, licences et coût

Responsiver ne nécessite aucun serveur ou abonnement. Une installation Ollama/llama.cpp et le téléchargement volontaire d’un modèle peuvent toutefois consommer stockage, mémoire et réseau en dehors de Responsiver.

Les projets locaux, overlays et conversations restent dans la session. Une URL publique produit une connexion normale au site ; Google Fonts reste l’exception réseau du runner local lorsqu’un projet la référence déjà.

Les composants distribués sont couverts par les avis du dépôt. Ollama, llama.cpp et surtout les modèles choisis par l’utilisateur possèdent leurs propres licences. « Modèle local » ne signifie pas automatiquement « redistribuable ».

Les paquets restent non signés. Une diffusion sans avertissements système et une publication Chrome Web Store nécessiteront signature, comptes développeur et conformité aux politiques concernées.

## Limites assumées

- L’audit public exige HTTPS ; le mode localhost reste limité à la boucle locale.
- L’audit distant cumule les routes visitées sur cinq largeurs, mais ne parcourt pas seul tout le site ni tous les breakpoints possibles.
- Le rendu est Chromium/Electron ; Firefox et WebKit ne sont pas automatisés.
- Une URL publique ne donne pas accès aux sources auteur et ne peut pas être corrigée sur le serveur.
- Un localhost lié permet l’édition locale ; seule la CSS est injectée directement dans la session distante.
- Le moteur visuel applique des règles objectives mais ne remplace pas une revue UI/UX humaine.
- L’assistant dépend d’un moteur et d’un modèle locaux installés séparément ; aucun modèle n’est embarqué.
- Une sortie IA peut être incorrecte, vulnérable ou trop large malgré les filtres.
- Responsiver ne lance aucun build, backend, base, Docker Compose ou migration.
- Le compagnon Chrome ne s’installe ni ne démarre l’app automatiquement ; Windows attend encore son host natif.
- La signature et la notarisation restent hors du paquet actuel.

## Validation réalisée pour la livraison 0.6

Contrôles reproductibles exécutés sur l’état consolidé :

- `npm run typecheck` : réussi ;
- `npm test` : 58 tests applicatifs réussis ;
- `npm run test:native-host` : 17 tests du protocole Chrome réussis ;
- `npm run test:e2e:remote` : redirection, historique multi-route, ciblage, rapport et formulaire localhost réussis ;
- `npm run build` : réussi ;
- `npm run package:dir` : paquet macOS arm64 construit ;
- `npm audit --audit-level=moderate` : aucune vulnérabilité signalée ;
- ressources `companion/chrome` et `companion/native-host` présentes dans l’application ;
- bit exécutable du host macOS conservé.

Les tests couvrent notamment analyseur, readiness, historique, URL/SSRF, audits local et distant, assainissement des messages du projet, workspace, assistant local, file Chrome, serveur de preview, staging et exports. Le parcours E2E Electron complet et les deux projets réels fournis ont été rejoués sur macOS ; cette validation locale ne remplace pas la matrice de release sur chaque plateforme.
