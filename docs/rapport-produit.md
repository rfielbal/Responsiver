# Rapport produit — Responsiver 0.8

## Résultat

Responsiver 0.8 transforme le laboratoire en chaîne de correction vérifiable et en poste de test multi-écrans : explorer rapidement de un à cinq rendus locaux ou distants, comprendre la priorité calculée dans la cascade CSS, couvrir automatiquement les vues importantes et appliquer seulement la version exacte qui vient de passer l’anti-régression.

La version ajoute un Studio de un à cinq écrans pour projet local, URL publique ou localhost, un catalogue de plus de 60 profils, des suites réutilisables, un pilotage sélectif et trois dispositions. Son panneau de constats démarre replié pour préserver la surface de travail. La superposition de maquette et la capture de planche complètent les runners locaux. La Matrice conserve sa preuve Chromium isolée dans une interface plus compacte et progressive. Un guide en six chapitres et une aide contextuelle sur les sept pages accompagnent ces outils sans les ouvrir automatiquement.

La direction UI conserve sa propre grammaire — rail graphite, papier minéral, accent vermillon, densité d’outil professionnel et panneaux maître/détail — en s’inspirant des principes opérationnels observés dans [Agency Agents](https://github.com/msitarzewski/agency-agents), sans reprendre son code, ses assets ou son identité.

## Traçabilité des demandes

| Demande | Livraison 0.8 | Limite ou preuve |
| --- | --- | --- |
| Déposer un fichier ou dossier | Sélecteurs, chemin et glisser-déposer | Pipeline local testé |
| Comprendre l’application au premier lancement | Visite illustrée en six chapitres, progression libre et parcours clavier | Masquage local facultatif et relance permanente par `?` |
| Retrouver une aide sans quitter sa tâche | Guide contextuel sur les sept pages, trois étapes au plus et lien vers le bon chapitre complet | Contenu local adapté au type de source |
| Analyser dès l’import | Inventaire, routes, CSS, readiness et runner avant redirection | Progression IPC et tests moteur |
| Éviter les previews blanches | Verdict `ready/degraded/blocked/needs-build` et smoke-test runtime | Fixtures incomplètes et bundle en erreur |
| Retrouver les anciens projets | Historique de chemins, sans cache de code, avec réanalyse | Store privé et atomique |
| Voir plusieurs appareils | Mode Appareil détaillé et Studio de 1 à 5 vues locales ou distantes | Cinq sessions Chromium maximum par projet distant |
| Retrouver les formats utiles | Catalogue local de plus de 60 profils, recherche, favoris, formats personnalisés et suites | Données de préférence locales, cinq vues actives maximum |
| Synchroniser les écrans | Pilote, vues liées ou isolées, navigation et scroll par repère/progression | Interactions sûres facultatives en local ; clics et formulaires toujours isolés à distance |
| Organiser la planche | Alignés, Grille ou Focus, rotation par écran et constats repliés par défaut | Le viewport CSS reste celui du profil, même si la preview est réduite visuellement |
| Comparer à une maquette | Image locale superposée, opacité réglable | Runner local uniquement ; overlay éphémère, sans envoi ni écriture projet |
| Capturer le Studio | PNG de la planche locale actuellement visible | Runner local uniquement ; pas une capture pleine page de chaque site |
| Naviguer dans le site | Navigation multi-page locale ; arrière/avant/rechargement/adresse en URL | Une ancre ordinaire ne recrée pas la vue et ne relance pas l’audit |
| Auditer une URL publique | Session `WebContentsView` HTTPS en lecture seule | DNS et redirections anti-SSRF |
| Auditer un localhost | Boucle locale uniquement | Aucun accès LAN implicite |
| Travailler sur Symfony/MySQL/Docker | Connexion au localhost déjà lancé | Responsiver ne démarre ni backend, DB, conteneur ou migration |
| Associer le code au localhost | Dossier source facultatif, session `linked-localhost` | L’association est explicite |
| Détecter des problèmes visuels | Balayage distant 360/390/768/1024/1440 et audit runtime local : overflow, navigation, collisions, densité, typographie, interaction, médias et contraste | Routes visitées cumulées, pas de crawler autonome |
| Séparer code et visuel | Catégories **Rendu & responsive** / **Code & structure**, priorités bornées et badges d’action | Les constats sans transformateur restent consultatifs |
| Éviter les doublons | Fusion cause CSS + preuve runtime sur route/sélecteur exacts, y compris viewport | L’identifiant du correctif source reste canonique |
| Détecter les défauts objectifs | Overflow, clipping, texte, tactile, fixe, image, contraste, runtime | Ce n’est pas une note esthétique universelle |
| Ouvrir un constat dans son contexte | Route exacte, viewport, sélecteur, scroll et contour temporaire | L’interface signale si le sélecteur n’existe plus |
| Conserver l’audit URL | Agrégation de session, synthèse copiable et rapport JSON | Aucune persistance sans export explicite |
| Voir l’avant/après | **Version actuelle** et **Correctif temporaire** séparés | Projets locaux déterministes |
| Corriger vite sans sacrifier la sûreté | **Correction Express** avec staging, matrice, preuve du défaut supprimé et jeton à usage unique | Projets locaux durables et transformations traçables uniquement |
| Couvrir plusieurs pages et états | Matrice compacte routes × Mobile/Tablette/Bureau × état initial/navigation | Action principale visible, détails progressifs ; cellules tronquées ou expirées jamais validées |
| Comprendre la cascade | Onglets **Calculés / Origine**, priorité calculée, règles écrasées, conditions et lien Monaco vers une ligne estimée | Source locale de même origine ; cas complexes et feuilles externes signalés partiels |
| Inspecter comme avec F12 | Sélection DOM intégrée dans Laboratoire et Code, sans ouvrir les DevTools natifs | Photographie bornée ; aucune valeur de formulaire, HTML ou stockage |
| Modifier visuellement | Atelier sémantique : cible, propriété, portée écran/page, undo/redo et preview CSS | Projet local durable ou export CSS avec sources associées |
| Travailler sur une seule taille | Portées toutes tailles/mobile/tablette/personnalisée, synchronisées avec le viewport | Media queries explicites et visibles avant application |
| Limiter une modification à la page | Attribut de route déterministe et règle préfixée | Refus sur une route dynamique non distinguable |
| Accepter ou refuser chaque correctif | Consultation sans effet puis décision explicite | Version corrigée reconstruite uniquement avec les choix retenus |
| Corriger une navbar rapidement | Avant/Après puis **Appliquer le plan maintenant** | Sources locales durables uniquement, route conservée |
| Annuler l’application | Sauvegarde de la dernière écriture, contrôle des hashes et restauration fichiers/dossiers | Refus si un fichier a changé depuis |
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
- **Catalogue local typé** : plus de 60 profils intégrés, formats et suites personnalisés bornés, indépendant des profils canoniques de la Matrice.
- **Bridge Studio fermé** : navigation, scroll sémantique et interactions explicitement sûres entre les iframes locales ; intentions de navigation bornées et scroll structurel via IPC pour les vues distantes.
- **PostCSS** : analyse et transformations CSS déterministes.
- **Serveurs Node loopback** : previews de la version actuelle, du correctif temporaire, de la version corrigée et du workspace.
- **Chrome DevTools Protocol** : métriques d’appareil et collecte visuelle dans la session distante.
- **CDP Overlay** : inspecteur intégré des URL/localhost sans DevTools natifs.
- **Monaco Editor** : édition locale des sources texte.
- **Overlays en mémoire** : prévisualisation avant décision ou écriture.
- **Ollama / llama.cpp** : moteurs facultatifs externes, joints uniquement sur loopback.
- **Native Messaging** : compagnon Chrome sans permission globale sur les sites.
- **Playwright** : validation Electron et navigateur.
- **electron-builder** : paquets desktop et ressources compagnon.

## Quatre niveaux de modification

### Correctif isolé et rapide

```text
Constat → Avant/Après → Appliquer le plan maintenant → Réanalyse sur la même route → Annuler si besoin
```

Sans autre choix validé, ce raccourci applique uniquement la proposition observée. Si un plan existe déjà, son libellé annonce l’application du plan complet et la proposition y est fusionnée sans perdre les choix précédents. Il est limité aux sources HTML/CSS locales durables. Le moteur prévérifie tous les hashes, remplace chaque fichier par renommage atomique, restaure le lot en cas d’échec et garde une sauvegarde d’annulation en mémoire.

### Plan de correctifs avancé

```text
Sélection → Comparaison groupée → Valider/Écarter → Version corrigée → Révision → Appliquer ou exporter
```

La source reste intacte jusqu’à l’action explicite **Appliquer au projet**. La page **Révision** est réservée aux projets locaux ; un localhost lié utilise l’export CSS ou l’espace Code et une URL publique reste limitée au rapport d’audit. Les fichiers sont re-hachés avant écriture ou export et une modification concurrente invalide la version corrigée. Les conflits entre correctifs, thèmes, instructions et gestes visuels bloquent la construction au lieu de produire un lot partiel silencieux.

### Éditeur et assistant

```text
Source → Overlay Monaco → Preview + Diff → Appliquer au fichier
```

La frappe et les propositions IA restent en mémoire. Le clic **Appliquer au fichier** autorise une écriture atomique dans la source. Si son hash ou sa version a changé, Responsiver refuse l’opération.

### Atelier visuel

```text
Composer dans la page figée → Portée écran/page → Tester le vrai site → Avant/Après → Appliquer ou exporter
```

L’Atelier conserve des opérations structurées et refuse le placement absolu automatique. Un déplacement visuel peut sortir de son conteneur tout en préservant sa place dans le flux. Le fantôme suit la géométrie demandée pendant le geste ; au relâchement, Responsiver la convertit en `translate`, dimensions ou `order`, sans déplacement ni reparentage du nœud dans l’arbre DOM. La cascade et le layout pouvant ajuster le résultat, l’Atelier vérifie ensuite la géométrie réellement rendue et recale son contour sur celle-ci. Le redimensionnement reste borné au viewport pour préserver une prise et l’adaptation aux écrans plus étroits ; les médias conservent leur ratio. La page est figée pendant le geste, puis **Tester** réactive liens, formulaires et navigation avec la feuille temporaire ; les scripts du site restent chargés pendant les deux modes. L’application locale produit une feuille Responsiver gérée et réversible. Un localhost lié reçoit uniquement les réglages CSS en direct puis un export à intégrer au framework ; la composition gestuelle reste locale. Une URL publique reste en inspection seule.

Cette distinction est volontaire : le parcours court optimise une correction détectée, l’Atelier une retouche visuelle ciblée, la version corrigée une livraison groupée non destructive et Monaco la modification manuelle fichier par fichier.

## Studio multi-écrans et Matrice

Le mode **Appareil** reste la surface de précision : un viewport, redimensionnement manuel, zoom, inspection, ciblage d’un constat et Avant/Après. Le mode **Studio** est une planche d’exploration disponible pour un projet local, une URL publique ou un localhost. Une suite charge de un à cinq profils ; l’utilisateur peut ensuite changer la disposition, choisir le pilote, isoler un écran, pivoter un modèle compatible et redimensionner sa vue. Le panneau de constats y démarre replié et conserve une préférence distincte du mode Appareil. Sur un runner local, l’utilisateur peut aussi ajouter une maquette et capturer la composition visible.

Le pilote partage la navigation et le défilement avec les vues liées ; une vue isolée conserve son propre parcours. Sur le runner local, le scroll utilise un élément sémantique puis la progression du conteneur dominant en repli, y compris une zone interne `overflow` de dashboard ou de SPA. Une ancre HTML ordinaire déplace les vues sans recréer leur document ; seuls les fragments `#/…` et `#!/…` restent des routes applicatives. Les interactions restent désactivées par défaut et leur protocole ne rejoue que des commandes bornées et jugées non sensibles : aucun lien, submit, fichier, mot de passe, coordonnée, libellé destructif ou élément ambigu n’est diffusé.

Pour une URL ou un localhost, Responsiver conserve une vue native principale et crée au besoin jusqu’à quatre `WebContentsView` supplémentaires, chacune avec son stockage éphémère et sa politique réseau. La route du pilote devient une intention idempotente pour les seules vues liées, avec jusqu’à quatre reprises différées bornées si une cible est encore occupée. Une ancre ordinaire reste dans le document courant et n’ouvre pas un nouvel audit. Toutes les 240 ms, le scroll transmet progression, type et rang d’un repère structurel, sans texte ni sélecteur. Le document est prioritaire lorsqu’il défile ; une zone interne dominante prend le relais sinon, avec arrondi et tolérance pour absorber les faibles écarts de rendu. Les clics, saisies et formulaires restent propres à chaque vue. La maquette et la capture groupée sont désactivées, car ces surfaces Chromium natives ne peuvent pas être composées de façon fiable dans l’overlay React.

Cette planche ne remplace pas la page **Matrice**. Le Studio est volontairement interactif et dépend des gestes de la session ; sa capture est une preuve visuelle de travail. La Matrice repart au contraire d’états fermés, nettoie le stockage de chaque cellule et compare les mêmes routes et formats entre source et candidat. Son en-tête compact expose l’action principale, range les alternatives et n’ouvre les détails du verdict que lorsqu’ils demandent une décision. Seule cette chaîne peut contribuer au jeton Correction Express.

L’audit multi-viewport distant reste distinct du mur interactif : il est lancé depuis le pilote et agrège les preuves par route et largeur. Comme pour le runner local, une planche visuellement satisfaisante ne devient jamais une certification anti-régression.

## Analyse visuelle

Le moteur distant exécute les mêmes mesures sur cinq viewports et conserve des preuves structurées : sélecteur, rectangle, style, valeur observée, seuil attendu et confiance. Il cible aussi les navigations déséquilibrées, collisions, pertes de zone utile, densités de commandes et échelles typographiques anormales. Les résultats de la page sont assainis dans le processus principal avant de devenir des constats. Les répétitions multi-viewport sont regroupées par route/règle/sélecteur avec la preuve la plus sévère ; un budget global et des caps par famille préservent les défauts les plus utiles. Chaque nouvelle route logique visitée est auditée automatiquement et rejoint l’historique de session ; une ancre ordinaire reste rattachée au même audit. Une réanalyse remplace seulement cette route. Les plafonds atteints sont visibles et exportés.

Le runner local complète désormais l’analyse statique avec des mesures runtime alignées et localisables. Les petites cibles sont regroupées par commande parente et ne sont signalées que si leur espacement rend l’activation ambiguë ; les carrousels, labels visuellement masqués et couleurs décoratives de marque sont exclus des faux positifs connus. Son message est à nouveau borné et assaini dans le renderer, car le JavaScript du projet reste une entrée non fiable.

La génération clair/sombre suit une politique de refus prudent : elle exige des rôles fond et texte résolvables, vérifie les contrastes de la palette et ne modifie ni images, ni filtres, ni accents de marque. Si ces garanties manquent, aucune variante n’est produite.

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
- Le Studio distant est borné à cinq `WebContentsView` simultanées. Navigation et scroll sont synchronisables ; clics, saisies et formulaires restent propres à chaque vue.
- Maquette et capture groupée sont réservées au Studio local. La capture représente uniquement la région visible de l’interface et ne parcourt pas automatiquement la hauteur complète de chaque page.
- En local, le rejeu d’interactions est volontairement incomplet : une commande sensible, destructive, liée à un formulaire ou impossible à localiser sans ambiguïté reste propre à l’écran pilote.
- L’audit distant cumule les routes visitées sur cinq largeurs, mais ne parcourt pas seul tout le site ni tous les breakpoints possibles.
- Le rendu est Chromium/Electron ; Firefox et WebKit ne sont pas automatisés.
- Une URL publique ne donne pas accès aux sources auteur et ne peut pas être corrigée sur le serveur.
- L’inspecteur d’une URL publique est informatif ; l’Atelier exige une racine locale autorisée.
- Un localhost lié permet l’édition locale ; seule la CSS est injectée directement dans la session distante. La stack Symfony/Laravel/Node/frontend est détectée depuis ses manifests, mais les templates de framework ne reçoivent pas encore de correctif automatique sans correspondance source fiable.
- L’Atelier permet un déplacement visuel libre par CSS, mais n’effectue aucun reparentage du DOM et ne garantit pas la réécriture du composant Twig/JSX/Vue/Tailwind auteur comme le ferait un éditeur de structure spécialisé.
- L’application directe est volontairement absente sur un artefact compilé ; la version corrigée peut être comparée et exportée, mais un prochain build écraserait une modification directe du build.
- Le moteur visuel applique des règles objectives mais ne remplace pas une revue UI/UX humaine.
- L’assistant dépend d’un moteur et d’un modèle locaux installés séparément ; aucun modèle n’est embarqué.
- Une sortie IA peut être incorrecte, vulnérable ou trop large malgré les filtres.
- Responsiver ne lance aucun build, backend, base, Docker Compose ou migration.
- Le compagnon Chrome ne s’installe ni ne démarre l’app automatiquement ; Windows attend encore son host natif.
- La signature et la notarisation restent hors du paquet actuel.

## Validation réalisée pour la livraison 0.8

Contrôles reproductibles exécutés sur l’état consolidé :

- `npm run typecheck` : réussi ;
- `npm test` : suite applicative complète réussie ;
- `npm run test:native-host` : 17 tests du protocole Chrome réussis ;
- `npm run test:e2e:visual` : F12 dans l’iframe, sélection réelle, application route-scopée et rendu après réanalyse réussis ;
- `npm run test:e2e:onboarding` : six chapitres, préférence locale, relance par le rail, guides contextuels Laboratoire/Matrice, focus et rendu mobile vérifiés ;
- `npm run test:e2e:studio` : cinq écrans, constats repliés par défaut, suites, Focus, isolation, ancres sans remontage, interactions sûres, maquette et bibliothèque vérifiés ;
- `npm run test:e2e:remote` : redirection, audit mobile, formulaire localhost, vues natives multiples, intentions de navigation et scroll synchronisé vérifiés ;
- `npm run test:e2e` : parcours Electron complet, catégories, inspecteur, Atelier, avant/après, application réelle, conservation de route et annulation réussis ;
- `npm run test:e2e:matrix` : en-tête compact, détails progressifs, cascade vers Monaco, matrice source/candidat, rejet d’une preuve périmée, application vérifiée et annulation réussis ;
- `npm run test:e2e:localhost-link` : association et remplacement à chaud sans écriture implicite réussis ;
- `npm run build` : réussi ;
- `npm run package:dir` : paquet macOS arm64 construit ;
- `npm audit --audit-level=moderate` : aucune vulnérabilité signalée ;
- ressources `companion/chrome` et `companion/native-host` présentes dans l’application ;
- bit exécutable du host macOS conservé.

Les tests couvrent notamment analyseur, readiness, historique, URL/SSRF, audits local et distant, inspecteurs bridge/CDP, validation CSS, portée de route, workspace, assistant local, file Chrome, serveur de preview, préparation de la version corrigée et exports. Les parcours Electron ont été rejoués sur macOS ; cette validation locale ne remplace pas la matrice de release sur chaque plateforme ni une revue humaine sur chaque framework.
