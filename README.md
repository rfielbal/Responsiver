# Responsiver

Responsiver est un laboratoire desktop open source pour inspecter la responsivité d’un projet local, d’un localhost ou d’un site public, puis préparer et valider des corrections sans service cloud imposé.

La version 0.6 ajoute l’audit d’URL dans une session Chromium isolée, l’analyse visuelle multi-viewport, un inspecteur intégré, un Atelier visuel, un espace code Monaco, un assistant IA local facultatif via Ollama ou llama.cpp et un compagnon Chrome. Le laboratoire sépare les défauts de rendu des diagnostics de code et propose des parcours courts, réversibles, pour corriger une responsivité sans traverser inutilement tout le workflow d’export.

## Trois sources, trois niveaux d’accès

| Source | Navigation | Audit visuel | Modification |
| --- | --- | --- | --- |
| Projet local statique ou compilé | Oui | Analyse statique + huit familles de mesures runtime | Oui, avec overlays puis confirmation explicite |
| URL publique HTTPS | Oui | Oui, cumulée sur les routes visitées | Lecture seule |
| Localhost | Oui | Oui, cumulée sur les routes visitées | Lecture seule, ou édition si un dossier source local est associé |

Responsiver ne prétend pas retrouver le code auteur d’un site public à partir de ses bundles. Une URL publique reste donc inspectable mais non modifiable. Pour Symfony, Laravel, Django, Rails, WordPress, Node ou un projet Docker, lancez d’abord l’application avec son environnement habituel puis ouvrez son localhost. Responsiver ne démarre ni conteneur, ni base de données, ni migration.

## Fonctionnalités

### Prise en main guidée

- Visite en six pages au premier lancement : source, Laboratoire, constats, Atelier/Code, révision et application.
- Illustrations intégrées, progression cliquable, navigation Précédent/Continuer et commandes clavier gauche/droite.
- Option **Ne plus afficher au démarrage** persistée uniquement dans le stockage local de l’application.
- Relance permanente depuis le bouton `?` du menu, y compris lorsque l’affichage automatique a été désactivé.
- Dialogue accessible : arrière-plan neutralisé, focus contenu dans la visite, fermeture par `Échap` et restitution du focus au raccourci d’aide.

### Projets locaux

- Ouverture par dossier, fichier HTML, chemin local ou glisser-déposer.
- Analyse dès l’import : inventaire, routes, CSS, readiness et démarrage du runner avant l’arrivée au laboratoire.
- Priorité à la véritable entrée du site ; les dossiers `demo`, `examples`, documentation et Storybook sont pénalisés.
- Détection d’une sortie existante dans `dist`, `build`, `out` ou `.output/public`, y compris imbriquée, sans exécuter de commande du projet.
- Diagnostic explicite des projets incomplets, des builds absents et des rendus vides au lieu d’une preview blanche.
- Historique local d’anciens projets fondé sur leurs chemins, sans copie du code et avec réanalyse à la réouverture.
- Navigation multi-page, ancres, historique et interactions locales via un runner lié à `127.0.0.1`.
- Audit runtime de la page active sur quatre profils canoniques (smartphone, tablette portrait, tablette paysage et ordinateur) : overflow réel, clipping, texte tronqué, navigation déséquilibrée, collisions, densité, typographie disproportionnée, groupes tactiles ambigus, éléments fixes, images et contraste simple. Les carrousels, liens correctement espacés et répétitions multi-viewport sont filtrés ou regroupés.

### Appareils et validation

- Familles smartphone, tablette et ordinateur séparées des dimensions personnalisées.
- Modèles connus, rotation, saisie précise et redimensionnement direct par les bords ou les angles.
- Zoom de travail de 10 à 200 % par commandes, `Ctrl` + molette ou pincement, sans changer le viewport CSS ni les media queries testées.
- Plein écran sans perdre la route, la taille, le focus ou la version observée.
- Comparaison de plusieurs appareils distincte de la comparaison Source / Proposition.
- Ouverture d’un constat sur sa route et son sélecteur lorsque celui-ci est disponible.
- Deux catégories explicites : **Rendu & responsive** pour les défauts mesurés, **Code & structure** pour les diagnostics statiques, de build ou de réseau.
- Cinq priorités visuelles affichées d’abord ; les autres restent accessibles sans saturer l’espace de travail.
- Fusion d’une preuve runtime et de sa cause CSS exacte lorsqu’elles partagent route et sélecteur, notamment pour éviter les doublons de viewport ou de navigation.
- Sélection multiple indépendante de l’ouverture du détail ; un constat sans transformation fiable reste consultatif et n’entre pas dans une fausse file d’application.
- Avant / Après contextualisé avant validation d’un correctif.
- Thème clair ou sombre prévisualisé immédiatement ; une variante existante est activée sans doublon. Une variante absente n’est générée que si les rôles fond/texte et leurs contrastes sont fiables ; images, filtres et accents de marque restent intacts, sinon le moteur refuse prudemment.

### Atelier visuel et inspecteur intégré

- Inspecteur accessible depuis le Laboratoire et Code, ainsi que par `F12`, `⌘⌥I` ou `⌘⇧C` sur macOS.
- Survol et sélection dans le vrai rendu avec contour, sélecteur, route, rectangle, box model, rôle, libellé et styles calculés bornés.
- Passage direct de la cible inspectée vers l’**Atelier visuel**, sans perdre la page ni le format observé.
- Quatre modes séparés : **Composer** fige la page et active les gestes directs, **Propriétés** ouvre les réglages précis, **Tester** rend toutes les interactions au site et **Avant / après** synchronise la source et la proposition.
- Composition directe à la souris : déplacement borné dans le conteneur, guides d’alignement, huit poignées de redimensionnement et réorganisation des frères Flex/Grid. Un geste entier reste une seule étape d’annulation.
- Réglages sémantiques de mise en page, dimensions, espacements, typographie et apparence. L’Atelier produit des contraintes CSS ; il ne convertit pas les éléments en coordonnées absolues fragiles.
- Portées indépendantes : toutes tailles, mobile, tablette ou plage personnalisée, puis page actuelle ou toutes les pages.
- Sélection multiple explicitement confirmée lorsqu’un sélecteur touche plusieurs éléments ; Shadow DOM et frames tierces restent inspectables mais non persistables.
- Prévisualisation CSS éphémère, undo/redo, avant/après, préparation du code, application atomique sur un projet HTML/CSS durable ou export sur un artefact/localhost lié.
- Espaces Code et Atelier volontairement compacts : le projet actif reste visible, les grands titres sont remplacés par un guide `?` contextuel et la surface est réservée au rendu, au code et aux propriétés.

Une URL publique peut être inspectée dans le Laboratoire, mais l’Atelier reste désactivé sans sources. Sur un localhost lié, les réglages CSS sont visibles immédiatement puis préparés comme feuille à intégrer au framework ; le mode Composer direct reste désactivé tant que la `WebContentsView` distante ne dispose pas du même pont privé que le runner local. Responsiver ne prétend pas retrouver automatiquement le composant Twig, JSX, Vue ou Tailwind auteur.

### URL publique et localhost

- URL publique limitée à HTTPS et aux adresses réellement publiques.
- Localhost limité à la boucle locale ; un dossier source peut être associé explicitement.
- Navigation arrière, avant, rechargement et saisie d’adresse dans une session éphémère.
- Émulation Chromium des dimensions, du DPR, du tactile et du mode mobile.
- Audit automatique de cinq largeurs : 360, 390, 768, 1024 et 1440 CSS px.
- Chaque nouvelle route réellement visitée est auditée après son chargement ; les constats restent cumulés route par route sans exploration autonome des liens.
- Détection objective des débordements, contenus masqués, textes tronqués, navigations illisibles ou mal réparties, chevauchements, densité incohérente, typographie disproportionnée, groupes tactiles ambigus, éléments fixes obstructifs, images absentes ou déformées, contrastes faibles et erreurs JavaScript.
- Un même défaut DOM mesuré à plusieurs tailles est regroupé avec ses viewports et sa preuve la plus sévère ; les familles bruyantes sont plafonnées.
- Clic sur un constat distant pour restaurer sa route exacte, son viewport et mettre en évidence l’élément s’il existe encore.
- Limites de scan signalées dans l’interface, synthèse copiable et rapport JSON exportable avec solutions proposées.

Responsiver n’ouvre pas seul tous les liens d’un site : il audite automatiquement les routes que vous visitez. Cette couverture mesurée ne remplace pas une revue humaine de la qualité esthétique.

### Espace code Monaco

- Explorateur des fichiers texte pertinents et éditeur Monaco intégré.
- Copie de travail en mémoire, diff par fichier et preview mise à jour après édition.
- Pour un projet local, les overlays HTML, CSS et JavaScript sont servis par une origine de preview distincte.
- Pour un localhost lié, les changements CSS sont injectés temporairement dans la page ; les autres fichiers restent visibles dans le diff mais dépendent du serveur de développement pour leur rendu.
- Boutons distincts **Écarter** et **Appliquer au fichier**.
- Vérification de version et de hash avant écriture, puis remplacement atomique du fichier.
- Exclusion des secrets, bases de données, dumps, binaires, dépendances, sorties compilées, fichiers cachés et liens symboliques.

Une frappe dans Monaco ne modifie jamais immédiatement le disque. En revanche, **Appliquer au fichier** est une autorisation explicite d’écrire dans le projet source.

### Assistant IA local facultatif

- Connexion à un moteur Ollama ou llama.cpp déjà lancé sur une adresse HTTP loopback.
- Aucun compte, aucune clé API, aucun fournisseur cloud et aucun fallback distant.
- Contexte borné : route, viewport, constats, capture disponible et sélection limitée de fichiers locaux non sensibles.
- Panneau préalable montrant les chemins exacts et permettant d’exclure séparément les fichiers ou la capture.
- Réponse structurée et propositions de fichiers complets filtrées par chemin et taille.
- Une proposition IA rejoint d’abord l’overlay de l’espace code ; elle n’est écrite qu’après validation humaine.
- Aucun terminal, shell ou accès direct au disque accordé au modèle.

Responsiver n’embarque ni moteur ni modèle. L’utilisateur installe et choisit son modèle local, sous sa propre licence. Responsiver borne la connexion à l’adresse loopback affichée, mais le moteur séparé peut journaliser ou relayer selon sa propre configuration. Le résultat dépend du modèle et doit être relu comme du code non fiable.

### Compagnon Chrome

- Extension Manifest V3 avec seulement `activeTab` et `nativeMessaging`.
- Transmission locale d’une URL HTTPS publique ou HTTP(S) loopback, du titre, du viewport et du DPR après un clic explicite.
- Aucun accès permanent aux sites, cookies, mots de passe, historique ou DOM.
- Native Messaging Host à schéma strict, messages limités et file privée expirant après dix minutes.

L’installation est encore manuelle. Le connecteur ne démarre pas Responsiver : ouvrez l’application avant le clic, ou dans les dix minutes suivantes. macOS et Linux nécessitent actuellement Node.js 22 accessible depuis Chrome ; le paquet Windows ne produit pas encore le host autonome `.exe`. Consultez [le guide du compagnon Chrome](docs/compagnon-chrome.md).

## Corrections et écritures

Quatre niveaux coexistent afin qu’une correction simple reste rapide sans supprimer les garde-fous :

1. **Parcours court** : constat visuel → Avant/Après → **Valider et appliquer**. Seule la proposition actuellement comparée est écrite, jamais le reste du plan ; la route et le viewport sont conservés après réanalyse.
2. **Workflow avancé** : Source → Proposition → **Ajouter au plan** → Staging combiné → Révision → export. Il sert aux lots, thèmes et instructions.
3. **Atelier visuel** : composer directement ou régler les propriétés → **Tester** le vrai site → Avant/Après → **Appliquer au projet** ou préparer l’export.
4. **Code et assistant** : Source → Overlay Monaco → Preview + Diff → **Appliquer au fichier**.

L’application directe est réservée aux sources HTML/CSS locales durables, pas aux URLs, localhost ou artefacts compilés. Tous les chemins et hashes sont validés avant la première substitution ; les fichiers sont remplacés atomiquement, les conflits bloquent le lot entier et la dernière application reste annulable tant que personne n’a remodifié les fichiers. L’annulation restaure aussi les nouveaux fichiers et dossiers créés. La feuille gérée `.responsiver/responsiver.generated.css` est réutilisée au lieu d’accumuler des variantes numérotées, et un nouveau geste sur la même cible remplace son ancien bloc géré.

Les changements de code à relire montrent leur mini-diff avant validation. Les transformations incompatibles sur la même déclaration, deux palettes ou deux instructions CSS sont refusées au lieu de laisser silencieusement gagner la dernière. Le staging avancé reste non destructif et exporte un patch, les fichiers changés ou une copie corrigée.

## Données et réseau

Responsiver ne crée aucun compte et n’active ni télémétrie, analytics, rapport de crash distant, API produit cloud ou mise à jour automatique.

- Projet local : code et overlays restent sur la machine ; seule l’exception Google Fonts déjà présente dans le projet peut joindre `fonts.googleapis.com` et `fonts.gstatic.com`.
- URL publique : Responsiver contacte nécessairement le site et ses ressources publiques autorisées. Le site reçoit l’adresse IP et les métadonnées HTTP normales.
- IA locale : Responsiver communique uniquement avec l’adresse loopback choisie. Aucun fallback cloud n’existe, mais le moteur local reste un logiciel séparé dont la configuration et les journaux doivent être contrôlés par l’utilisateur.
- Chrome : le transport extension → host reste local ; l’ouverture ultérieure de l’URL produit ensuite la connexion réseau normale au site.
- Guide : seule la préférence versionnée d’affichage au démarrage est conservée dans `localStorage` ; aucune étape, donnée de projet ou mesure d’usage n’est envoyée.

Consultez [PRIVACY.md](PRIVACY.md) et [SECURITY.md](SECURITY.md) pour le détail.

## Compatibilité des projets

Le runner local ouvre les sites statiques et les sorties déjà compilées : HTML, CSS, JavaScript, médias, WebAssembly et routes SPA avec fallback local.

Responsiver n’exécute jamais automatiquement `npm install`, un build, PHP, Symfony, un serveur backend, Docker Compose, MySQL, une migration ou une commande du projet. Un projet dynamique fonctionne dans le mode localhost lorsque son environnement est déjà lancé. Associer son dossier source active alors Monaco et les overlays sans donner à Responsiver l’accès à sa base de données. Les manifests associés permettent d’annoncer notamment Symfony, Laravel, Next.js, React, Vue, Svelte, Vite, Express et Tailwind sans exécuter leur chaîne de build.

Cette détection n’est pas un adaptateur de réécriture de framework. Sur un localhost Symfony/Next/Docker, l’audit utilise le rendu réel et le studio Code peut modifier les sources autorisées ; les correctifs automatiques restent désactivés tant qu’un nœud rendu ne peut pas être relié sans ambiguïté à son template auteur.

Les modifications d’un artefact compilé peuvent être prévisualisées et exportées, mais un prochain build peut les écraser. Elles doivent être reportées dans les sources auteur.

## Lancer le projet

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Vérifications :

```bash
npm run typecheck
npm test
npm run test:native-host
npm run test:e2e
npm run test:e2e:onboarding
npm run test:e2e:visual
npm run test:e2e:remote
npm run test:e2e:localhost-link
npm run build
npm audit
```

Un projet réel peut être vérifié séparément :

```bash
npm run test:project -- /chemin/du/projet
```

## Produire les applications desktop

```bash
npm run package
```

`electron-builder` produit les formats de la plateforme de build. Les paquets embarquent les avis de licence, `PRIVACY.md`, `SECURITY.md`, la démo et les sources du compagnon Chrome sous `resources/companion`. Le hook de packaging refuse un paquet incomplet.

Le workflow de release construit les trois systèmes, génère un SBOM SPDX et un manifeste `SHA256SUMS`. Les paquets publics restent non signés tant qu’aucun certificat n’est configuré ; macOS Gatekeeper et Windows SmartScreen peuvent donc afficher un avertissement.

## Open source et obligations

Le dépôt est sous licence Apache-2.0. Les dépendances directes sont recensées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) et verrouillées dans `package-lock.json`.

```bash
npm run sbom > sbom.spdx.json
```

Open source ne signifie pas « sans règle ». Les avis doivent rester distribués ; Chrome, GitHub, Google Fonts, Ollama, llama.cpp et chaque modèle local possèdent leurs propres conditions ou licences. Aucun abonnement logiciel n’est exigé par Responsiver lui-même.

## Documentation

- [Rapport produit et traçabilité](docs/rapport-produit.md)
- [Architecture technique](docs/architecture.md)
- [Guide du compagnon Chrome](docs/compagnon-chrome.md)
- [Confidentialité](PRIVACY.md)
- [Sécurité](SECURITY.md)
- [Notices tierces](THIRD_PARTY_NOTICES.md)

Les commits du projet sont rédigés en français, avec des messages explicites comme `feat: ajouter l’audit visuel des URL`.
