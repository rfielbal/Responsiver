# Architecture de Responsiver 0.6

```text
Renderer React de confiance
  ├── projets / URL / laboratoire / révision / export
  ├── preview locale en iframe cross-origin
  ├── emplacement visuel du WebContentsView distant
  ├── éditeur Monaco + diff + décision d’application
  └── assistant local facultatif
                │
Preload contextBridge typé
                │ IPC borné, frame principale uniquement
Electron main — ActiveProjectSession
  ├── LocalProjectSession
  │     ├── analyse HTML/CSS route-scopée
  │     ├── runners source / proposition / staging / workspace
│     ├── politique de constats visuel / code
│     └── transformeur déterministe + application/undo atomiques
  ├── RemoteBrowserSession
  │     ├── WebContentsView sandboxé et partition éphémère
  │     ├── politique URL + DNS anti-SSRF
  │     └── audit visuel multi-viewport
  ├── WorkspaceEditor
  │     └── fichiers sûrs + overlays + diff + application atomique
  ├── Local AI adapter
  │     └── Ollama ou llama.cpp sur HTTP loopback uniquement
  ├── Extension inbox
  │     └── demandes Chrome privées, bornées et expirables
  └── exports explicites + contrôle des hashes
```

## Sources et session active

Le processus principal possède une seule `ActiveProjectSession`. Son contrat distingue trois sources :

- `local-project` : dossier ou fichier local, analysé et servi par Responsiver ;
- `remote-url` : URL publique HTTPS ou localhost sans sources, toujours en lecture seule ;
- `linked-localhost` : localhost associé explicitement à un dossier local éditable.

Changer de source ferme les serveurs de preview, le `WebContentsView`, l’espace de changements et le staging de la session précédente. Les buffers Monaco, captures et messages de l’assistant ne sont pas persistés.

Un verrou Electron d’instance unique évite deux consommateurs concurrents pour le compagnon Chrome. La seconde instance réactive la fenêtre existante et déclenche une nouvelle lecture de la file.

## Pipeline des projets locaux

Une sélection peut être un dossier ou un fichier `.html/.htm`. L’ouverture suit une transaction locale : validation canonique, inventaire, routes, analyse responsive, readiness, puis démarrage du runner.

L’analyseur privilégie l’entrée racine et sort les fragments, démos, tests, exemples et Storybook des routes principales. Une page auxiliaire reste ouvrable si l’utilisateur la choisit explicitement. Si l’entrée est un shell de framework, il recherche prudemment une sortie existante dans `dist`, `build`, `out` ou `.output/public`. Un simple `public/index.html` de framework n’est pas considéré comme un build final.

Le verdict `ready`, `degraded`, `blocked` ou `needs-build` combine structure HTML, contenu visible potentiel, scripts réellement exécutables, CSS vide, médias orphelins, fraîcheur de l’artefact et exhaustivité de l’inventaire. Un projet bloqué n’obtient ni runner, ni proposition, ni staging.

L’analyse statique conserve les routes et feuilles CSS effectivement liées. Les règles déterministes couvrent notamment viewport absent, `min-width` rigide, largeurs fixes importantes, `white-space: nowrap` réellement risqué et ressources externes incompatibles avec la politique locale. Les mêmes déclarations partagées par plusieurs routes sont regroupées. Une couche de politique classe ensuite chaque signal en **Rendu & responsive** ou **Code & structure**, distingue preuve statique/runtime/corrélée et impose diff, avant/après ou intervention manuelle. Une heuristique CSS et sa preuve runtime de même route/sélecteur deviennent un seul constat canonique. Aucun signal n’est sélectionnable si aucun transformateur réel ne sait produire sa proposition. La restitution est priorisée et bornée à 18 constats par route et 60 au total ; l’analyse signale honnêtement une troncature. PostCSS structure les déclarations ; Sass, Less et CSS non reliés sont signalés mais pas réécrits aveuglément.

## Runner et preview locale

Le serveur Node écoute uniquement `127.0.0.1` sur un port aléatoire. Il accepte `GET` et `HEAD`, contrôle `Host`, chemins réels, liens symboliques, fichiers cachés, types MIME et requêtes `Range`.

Après une application explicite, le runner autorise uniquement le chemin physique `.responsiver/responsiver.generated.css` afin que la source réanalysée rende réellement la feuille gérée. Le reste du dossier caché demeure invisible ; la résolution canonique continue de refuser toute sortie par symlink.

Le HTML reçoit en mémoire un bridge sans accès Node pour :

- navigation interne, historique et rechargement ;
- redirection des fenêtres internes dans l’iframe ;
- thème et mutations DOM ;
- audit runtime borné des défauts visuels et regroupement des répétitions par conteneur ;
- smoke-test du contenu réellement peint, y compris pseudo-éléments et Shadow DOM ouverts ;
- centrage et mise en évidence d’un sélecteur ;
- inspecteur DOM borné avec contours séparés pour le survol et la sélection ;
- feuille CSS visuelle éphémère, limitée et retirée à la demande.

L’iframe possède une origine loopback différente du renderer. Elle ne peut pas atteindre le preload ou IPC. Les sorties réseau sont bloquées à l’exception des Google Fonts déjà référencées.

Les dimensions restent exprimées en CSS px même si l’atelier applique une échelle visuelle. Les poignées de redimensionnement produisent un viewport personnalisé ; le plein écran conserve l’origine, la route et la version de preview.

## URL publique et localhost

Une URL n’est pas placée dans une iframe. Le processus principal crée un `WebContentsView` avec :

- `nodeIntegration: false`, `contextIsolation: true`, sandbox et `webSecurity` ;
- partition aléatoire sans préfixe `persist:` ;
- permissions sensibles, téléchargements et nouvelles fenêtres refusés ;
- stockage nettoyé à la fermeture ;
- navigation principale contrôlée par le processus main.

Le mode public exige HTTPS. Avant le chargement, tous les résultats DNS sont contrôlés et doivent être publics. Les plages privées, loopback, link-local, documentation, multicast et réservées sont refusées, y compris les IPv4 mappées en IPv6. Chaque redirection est normalisée et revalidée pour réduire les risques de SSRF et de DNS rebinding.

Le mode localhost accepte uniquement `localhost`, ses sous-domaines et les adresses de boucle locale. Il n’autorise pas le LAN. Associer un dossier n’accorde aucun accès réseau supplémentaire : cela active seulement le `WorkspaceEditor` sur cette racine. Les manifests `package.json` et `composer.json` sont lus sans exécution afin d’identifier la stack affichée ; cette détection ne transforme pas automatiquement les templates de framework.

L’inspection distante réutilise le Chrome DevTools Protocol déjà attaché à la session. `Overlay.setInspectMode` dessine la cible dans le vrai `WebContentsView`, puis le processus principal résout une photographie bornée de l’élément. Aucune fenêtre DevTools n’est ouverte. Le mode public ne permet aucune mutation ; seul un localhost associé accepte une feuille CSS temporaire limitée à 64 Kio.

Les liens quittant le périmètre de navigation approuvé sont bloqués. Les sous-ressources HTTP(S) sont elles aussi limitées à la portée réseau du mode choisi. Le site reste du JavaScript non fiable exécuté par Chromium ; la session n’est pas une machine virtuelle anti-malware.

## Audit visuel multi-viewport

Le renderer demande actuellement cinq viewports : 360 × 800, 390 × 844, 768 × 1024, 1024 × 768 et 1440 × 900. Le moteur accepte au maximum huit viewports par appel.

Pour chaque taille, la session applique les métriques Chromium et le tactile, attend la stabilisation puis exécute un collecteur borné dans la page. La route doit rester identique pendant le balayage. Le résultat provenant de la page est traité comme une entrée non fiable puis assaini par le processus principal.

Les règles implémentées sont :

- débordement horizontal du viewport ou d’un conteneur ;
- contenu coupé par `overflow` ;
- texte probablement tronqué ;
- navigation qui se chevauche, devient illisible ou se répartit en rangées déséquilibrées ;
- collisions entre contenus frères, densité de commandes et contenu majoritairement hors zone utile ;
- échelle typographique disproportionnée, notamment quand les métriques d’une police gonflent le titre ;
- groupe de cibles tactiles réellement ambigu (les petits liens isolés et suffisamment espacés ne sont pas signalés) ;
- élément fixe occupant une part obstructive du viewport ;
- image non chargée ou déformée ;
- contraste textuel calculable sous le seuil ;
- erreur JavaScript capturée pendant la session.

Chaque constat contient règle, route complète, viewport, sélecteur, rectangle, styles bornés, mesures et confiance. Un même couple route/règle/sélecteur observé sur plusieurs tailles ne produit qu’un constat : il conserve la preuve la plus sévère et la liste des viewports touchés. La restitution distante est plafonnée à 20 constats par route, avec un cap par famille pour empêcher une avalanche de contrastes ou de débordements d’évincer une collision ou une navigation défaillante. La troncature, le nombre de nœuds inspectés et les plafonds réels sont propagés au renderer. Un clic restaure d’abord la route, puis demande au `WebContentsView` de chercher le sélecteur, centrer l’élément et poser un contour temporaire ; l’interface indique honnêtement si le DOM a changé.

Une route nouvellement visitée déclenche automatiquement son propre balayage. Le processus principal remplace un ancien résultat de cette route, conserve les autres et construit ainsi un historique de session exportable. Il ne suit cependant aucun lien de lui-même : la couverture correspond aux routes effectivement visitées.

Le moteur mesure des défauts objectifs. Il ne compare pas la page à une maquette, ne note pas son esthétique et ne lance ni Lighthouse ni axe-core. Une capture bornée de la dernière route auditée peut être fournie à l’assistant local.

Le runner local utilise un collecteur distinct mais aligné : `TreeWalker` borné, déduplication par règle/sélecteur ou cluster parent, preuves géométriques et seuils explicites. Quatre sondes isolées mesurent la route active à 393 × 852, 768 × 1024, 1024 × 768 et 1440 × 900 CSS px ; leurs répétitions deviennent un seul constat avec la liste des formats touchés. Les carrousels, labels réservés aux lecteurs d’écran, contenus de marque décoratifs et liens tactiles correctement espacés sont exclus des faux positifs connus. Le renderer traite même ce message comme non fiable, remplace ses dimensions par le viewport choisi et rejette règles, routes ou volumes hors contrat avant de les afficher.

## Inspecteur intégré et Atelier visuel

L’inspecteur est un outil de sélection, pas un accès aux DevTools natifs. Il existe dans le Laboratoire et Code. Le bridge local ou CDP renvoie uniquement : route, sélecteur, nombre d’occurrences, balise, classes, rectangle, rôle, libellé, texte tronqué, box model et liste fermée de styles calculés. Les messages sont assainis à chaque frontière. Formulaires, HTML, cookies et stockages ne sont jamais lus.

L’Atelier stocke des `VisualEditOperation` structurées :

- cible et métadonnées de stabilité ;
- propriété CSS prise dans une allowlist ;
- valeur avant/après sans règle, commentaire, ressource distante ou `!important` fourni ;
- portée `all`, `mobile`, `tablet` ou plage personnalisée ;
- portée de route `current` ou `all`.

Le mode **Composer** ajoute un protocole privé au-dessus de ce même modèle. `PreviewFrame` crée un `MessageChannel` neuf à chaque chargement et transfère un seul port au bridge injecté avant les scripts du projet. Session, document et révision sont vérifiés sur chaque message ; le bridge conserve en outre les primitives natives du port avant l’exécution du site. Un `postMessage` fabriqué ou un prototype remplacé par le projet ne peut donc pas devenir un changement. Les intentions de geste ne transportent ni CSS libre, ni HTML, ni valeur de formulaire, ni texte, URL complète, query, fragment ou stockage : seulement une cible unique expurgée, le chemin interne courant, des rectangles bornés et une liste fermée de mutations.

La couche de composition vit dans un Shadow DOM du runner local. Elle intercepte les interactions, met en pause animations et transitions, conserve le scroll et dessine sélection, fantôme, guides et huit poignées sans modifier les styles inline du projet pendant le geste. Le renderer traduit ensuite :

- un déplacement dans le flux en `translate` responsive borné au conteneur ;
- un dépôt entre frères Flex/Grid en lot atomique de `order`, avec avertissement sur l’ordre de lecture ;
- un redimensionnement en `width` fluide, `height` contrôlée et `box-sizing` si nécessaire.

La portée écran/page vient toujours de React et jamais du document chargé. Un geste complet remplace les opérations de mêmes clés puis rejoint l’historique en une transaction. **Tester** ferme la couche sans retirer la CSS temporaire ; **Avant/Après**, staging et application réutilisent ensuite le pipeline existant.

La compilation produit une feuille déterministe avec media queries. Une même cible/propriété/portée ne peut recevoir deux valeurs concurrentes ; les doublons exacts sont regroupés. Un sélecteur touchant plusieurs éléments exige une confirmation, tandis que Shadow DOM, frame tierce ou sélecteur instable restent en inspection seule.

La preview locale injecte la feuille dans un `<style data-responsiver-visual-preview>` sans écrire le disque. Undo/redo ne manipule que l’historique renderer. En mode Avant/Après, deux runners affichent source et feuille temporaire ; en mode localhost lié, une seule session réelle reçoit la CSS et la comparaison côte à côte est donc désactivée.

Le zoom de travail transforme uniquement la représentation native ou le conteneur de l’iframe entre 10 et 200 %. La largeur CSS émulée reste celle de l’appareil sélectionné : zoomer ne déclenche donc jamais artificiellement un autre breakpoint. Les previews distantes utilisent une `View` de découpe autour de la `WebContentsView`, et toutes les restaurations CSS/inspecteur sont sérialisées afin qu’une navigation ou une saisie rapide ne laisse aucune feuille temporaire orpheline.

Au staging, les opérations sont revalidées dans le processus principal. Un projet local durable reçoit `.responsiver/responsiver.generated.css` et un lien dans les pages concernées. Chaque règle visuelle possède des marqueurs gérés stables : un nouveau geste sur la même cible/propriété/portée remplace le bloc précédent au lieu d’accumuler des déclarations concurrentes. Pour « page actuelle », le transformeur ajoute un attribut `data-responsiver-route` déterministe sur le document et préfixe la règle ; si plusieurs routes dynamiques partagent le même HTML, il refuse cette portée. Un artefact compilé ou localhost lié produit uniquement un export à intégrer aux sources auteur. Une URL publique n’accède jamais à l’Atelier.

## Proposition déterministe et staging

Le workflow avancé conserve quatre étapes :

1. **Analyser** produit des constats sans modification.
2. **Prévisualiser** construit une proposition éphémère en mémoire.
3. **Accepter ou écarter** enregistre la décision humaine.
4. **Construire le staging** reconstruit uniquement les constats et thèmes acceptés.

Source, proposition et staging utilisent des origines distinctes. Le transformeur génère overlays, CSS complémentaire si nécessaire, opérations visuelles validées, patch unifié, résultats par proposition et empreintes SHA-256. L’identité d’une opération CSS inclut fichier, ligne, sélecteur, propriété et breakpoint ; deux valeurs incompatibles sur une même cible, deux thèmes opposés, deux instructions contradictoires ou deux opérations visuelles concurrentes produisent un conflit bloquant. La feuille Responsiver déjà gérée est enrichie au lieu de créer un nouveau lien à chaque application.

Une variante de thème n’est générée que si un couple de rôles fond/texte fiable est résolu et si les contrastes texte/fond, texte/surface et texte atténué/fond passent les seuils. Les accents de marque, images et filtres ne sont jamais recolorés automatiquement ; à faible confiance, le moteur refuse la variante au lieu de produire un rendu destructeur.

Pour un projet HTML/CSS local durable, la proposition isolée peut aussi suivre le parcours court **Valider et appliquer**. L’API ne reprend que cette proposition, refait le staging, refuse tout conflit, prévérifie l’ensemble des hashes, prépare les temporaires puis remplace les fichiers. Une sauvegarde d’annulation reste en mémoire ; elle n’est utilisable que si tous les fichiers appliqués ont encore leur hash attendu. L’undo restaure contenus, modes, fichiers absents et dossiers nouvellement créés, puis le projet est réanalysé sur la route courante. Les artefacts compilés, URLs et localhost ne disposent pas de ce raccourci.

Avant tout export, les sources sont re-hachées. Un changement concurrent invalide le staging. Les exports de fichiers, copie ou patch restent hors de la racine source et sont protégés contre traversées et substitutions par lien symbolique.

## Espace code Monaco

Le `WorkspaceEditor` existe uniquement lorsqu’une racine locale a été autorisée : projet local ou localhost lié. Il liste les sources texte pertinentes et exclut notamment :

- fichiers cachés, `.git`, dépendances, vendors et sorties compilées ;
- `.env`, identifiants, clés, certificats, dumps SQL et bases locales ;
- binaires, textes non UTF-8, fichiers trop volumineux et liens symboliques.

Les chemins sont relatifs, canoniques et confinés à la racine. Chaque document chargé conserve contenu source, hash, overlay, version et diff.

La saisie Monaco met à jour l’overlay après un court délai. Pour un projet local, un runner `workspace` sert toutes les substitutions en mémoire. Pour un localhost lié, seuls les overlays CSS sont injectés dans la page distante ; les autres changements nécessitent que le serveur de développement les recharge après application.

**Écarter** restaure la copie mémoire. **Appliquer au fichier** est la seule opération de cet espace qui écrit la source. Elle vérifie version et hash, crée un fichier temporaire dans le même dossier, synchronise son contenu puis effectue un renommage atomique. Si le fichier a changé extérieurement, l’écriture est refusée.

Ce workflow est distinct du staging avancé et de son application rapide : Monaco travaille fichier par fichier, tandis qu’une proposition déterministe peut appliquer un lot prévalidé de plusieurs fichiers après consentement explicite.

## Assistant IA local

Responsiver ne contient pas de modèle. L’adaptateur se connecte à un service déjà lancé :

- Ollama via `/api/tags` et `/api/chat` ;
- llama.cpp via `/health`, éventuellement `/v1/models`, puis `/v1/chat/completions`.

L’adresse doit être HTTP et loopback. `localhost` est transformé en `127.0.0.1`, les identifiants, query strings, fragments et redirections sont refusés. Il n’existe aucun fournisseur cloud ou fallback.

Le contexte est construit par Responsiver : nom, type de source, route, viewport, constats après validation, sélection bornée de fichiers non secrets et capture PNG/JPEG éventuelle. Avant l’envoi, le renderer montre les chemins exacts et permet de désactiver les fichiers et la capture séparément. Les prompts, réponses et tailles sont plafonnés.

Le modèle reçoit une instruction lui rappelant que le contenu du projet est non fiable. La réponse attendue est un JSON avec explication et propositions de fichiers complets. Les chemins, extensions, tailles et contenus sont revalidés. Le modèle n’obtient jamais de terminal, outil système ou accès direct au disque.

Cliquer sur une proposition IA la charge dans l’overlay Monaco. L’utilisateur doit encore examiner le diff et cliquer sur **Appliquer au fichier**. Cette barrière réduit le risque mais ne prouve pas que le code généré est correct ou sûr.

Le moteur local est un processus séparé. Responsiver ne déclenche aucun téléchargement de modèle et ne peut pas garantir la politique de logs ou de réseau d’un service local tiers mal configuré.

## Compagnon Chrome

L’extension Manifest V3 demande seulement `activeTab` et `nativeMessaging`. Après un clic, le service worker accepte une URL HTTPS publique ou HTTP(S) loopback, puis construit une demande `open-url` contenant URL, titre, viewport, DPR, UUID et date. Le host applique une seconde fois la même politique.

Le Native Messaging Host :

- lit le framing JSON length-prefixed sur stdin ;
- limite chaque message à 64 Kio ;
- applique un schéma fermé ;
- écrit atomiquement dans `extension-inbox`, privé en `0700/0600` sur POSIX ;
- borne la file à 128 éléments, purge les entrées âgées de plus de dix minutes avant chaque nouvel écrit et ne met jamais l’URL dans le nom du fichier.

Le consommateur Electron réclame chaque fichier par renommage, le relit sans suivre de symlink, revalide le contrat et refuse les demandes âgées de plus de dix minutes. Une demande acceptée ouvre une session distante et focalise la fenêtre.

Le host répond `validated: true`, `delivery: queued`, `desktopAcknowledged: false` : seule sa validation locale est acquittée. Il ne lance pas l’application. Le parcours actuel exige une installation manuelle et un moteur Node accessible sur macOS/Linux. Aucun exécutable autonome Windows n’est encore produit. Le détail se trouve dans [compagnon-chrome.md](compagnon-chrome.md).

## Persistance, confidentialité et fermeture

L’historique JSON stocke seulement chemins, entrée, compteurs et dates. Les sources, overlays Monaco, conversations, captures et constats distants ne sont pas persistés par Responsiver.

Fermer une session locale arrête ses serveurs et nettoie son stockage navigateur. Fermer une session distante détache le debugger, retire le CSS injecté, efface son stockage et ferme le `WebContentsView`.

Les rapports et exports ne sont créés qu’après choix explicite d’une destination. Pour une URL, le rapport agrège les routes visitées, leurs constats et le mode réseau réel ; il ne prétend pas être « hors ligne ». Une source ne peut être modifiée que par **Appliquer au fichier** dans Code, **Valider et appliquer** après une proposition locale comparée ou **Appliquer au projet** après des opérations explicites dans l’Atelier. Ces trois chemins contrôlent version, hashes et confinement avant écriture.

## Projets backend, bases et Docker

Responsiver ne lance aucune commande issue d’un projet. Il ne démarre pas PHP, Symfony, MySQL, Docker Compose, un build frontend ou des migrations.

Un projet dynamique fonctionne lorsque l’utilisateur démarre lui-même son environnement puis ouvre le localhost. Responsiver agit alors comme un navigateur d’audit. L’association facultative du dossier source active l’éditeur, sans donner accès à la base. L’orchestration Docker automatique reste hors du périmètre de la version 0.6.
