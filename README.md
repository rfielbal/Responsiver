# Responsiver

Responsiver est un laboratoire desktop open source pour inspecter la responsivité d’un projet local, d’un localhost ou d’un site public, puis préparer et valider des corrections sans service cloud imposé.

La version 0.6 ajoute quatre capacités majeures : audit d’URL dans une session Chromium isolée, analyse visuelle multi-viewport, espace code Monaco avec prévisualisation en mémoire et assistant IA local facultatif via Ollama ou llama.cpp. Un compagnon Chrome permet également de transmettre l’onglet actif à l’application.

## Trois sources, trois niveaux d’accès

| Source | Navigation | Audit visuel | Modification |
| --- | --- | --- | --- |
| Projet local statique ou compilé | Oui | Analyse locale et runtime | Oui, avec overlays puis confirmation explicite |
| URL publique HTTPS | Oui | Oui, sur la route courante | Lecture seule |
| Localhost | Oui | Oui, sur la route courante | Lecture seule, ou édition si un dossier source local est associé |

Responsiver ne prétend pas retrouver le code auteur d’un site public à partir de ses bundles. Une URL publique reste donc inspectable mais non modifiable. Pour Symfony, Laravel, Django, Rails, WordPress, Node ou un projet Docker, lancez d’abord l’application avec son environnement habituel puis ouvrez son localhost. Responsiver ne démarre ni conteneur, ni base de données, ni migration.

## Fonctionnalités

### Projets locaux

- Ouverture par dossier, fichier HTML, chemin local ou glisser-déposer.
- Analyse dès l’import : inventaire, routes, CSS, readiness et démarrage du runner avant l’arrivée au laboratoire.
- Priorité à la véritable entrée du site ; les dossiers `demo`, `examples`, documentation et Storybook sont pénalisés.
- Détection d’une sortie existante dans `dist`, `build`, `out` ou `.output/public`, y compris imbriquée, sans exécuter de commande du projet.
- Diagnostic explicite des projets incomplets, des builds absents et des rendus vides au lieu d’une preview blanche.
- Historique local d’anciens projets fondé sur leurs chemins, sans copie du code et avec réanalyse à la réouverture.
- Navigation multi-page, ancres, historique et interactions locales via un runner lié à `127.0.0.1`.

### Appareils et validation

- Familles smartphone, tablette et ordinateur séparées des dimensions personnalisées.
- Modèles connus, rotation, saisie précise et redimensionnement direct par les bords ou les angles.
- Plein écran sans perdre la route, la taille, le focus ou la version observée.
- Comparaison de plusieurs appareils distincte de la comparaison Source / Proposition.
- Ouverture d’un constat sur sa route et son sélecteur lorsque celui-ci est disponible.
- Avant / Après contextualisé avant validation d’un correctif.
- Thème clair ou sombre prévisualisé immédiatement ; une variante existante est activée sans générer de doublon, une variante absente reste à valider séparément.

### URL publique et localhost

- URL publique limitée à HTTPS et aux adresses réellement publiques.
- Localhost limité à la boucle locale ; un dossier source peut être associé explicitement.
- Navigation arrière, avant, rechargement et saisie d’adresse dans une session éphémère.
- Émulation Chromium des dimensions, du DPR, du tactile et du mode mobile.
- Audit automatique de cinq largeurs : 360, 390, 768, 1024 et 1440 CSS px.
- Détection objective des débordements, contenus masqués, textes tronqués, petites cibles tactiles, éléments fixes obstructifs, images absentes ou déformées, contrastes faibles et erreurs JavaScript.
- Clic sur un constat distant pour centrer et mettre en évidence l’élément correspondant.

L’audit distant porte sur la route actuellement ouverte. Il ne parcourt pas automatiquement tout le site et ne remplace pas une revue humaine de la qualité esthétique.

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
- Réponse structurée et propositions de fichiers complets filtrées par chemin et taille.
- Une proposition IA rejoint d’abord l’overlay de l’espace code ; elle n’est écrite qu’après validation humaine.
- Aucun terminal, shell ou accès direct au disque accordé au modèle.

Responsiver n’embarque ni moteur ni modèle. L’utilisateur installe et choisit son modèle local, sous sa propre licence. Le résultat dépend du modèle et doit être relu comme du code non fiable.

### Compagnon Chrome

- Extension Manifest V3 avec seulement `activeTab` et `nativeMessaging`.
- Transmission locale de l’URL, du titre, du viewport et du DPR après un clic explicite.
- Aucun accès permanent aux sites, cookies, mots de passe, historique ou DOM.
- Native Messaging Host à schéma strict, messages limités et file privée expirant après dix minutes.

L’installation est encore manuelle. Le connecteur ne démarre pas Responsiver : ouvrez l’application avant le clic, ou dans les dix minutes suivantes. macOS et Linux nécessitent actuellement Node.js 22 accessible depuis Chrome ; le paquet Windows ne produit pas encore le host autonome `.exe`. Consultez [le guide du compagnon Chrome](docs/compagnon-chrome.md).

## Corrections et écritures

Deux workflows coexistent :

1. les corrections déterministes et thèmes passent par Source → Proposition → décisions explicites → Staging → export ;
2. l’espace Monaco et les propositions de l’assistant passent par Source → Overlay mémoire → Diff → **Appliquer au fichier**.

Le premier workflow ne modifie jamais l’original et exporte un patch, les fichiers changés ou une copie corrigée. Le second peut modifier le fichier source, mais seulement après le clic explicite et après vérification qu’il n’a pas changé sur le disque.

## Données et réseau

Responsiver ne crée aucun compte et n’active ni télémétrie, analytics, rapport de crash distant, API produit cloud ou mise à jour automatique.

- Projet local : code et overlays restent sur la machine ; seule l’exception Google Fonts déjà présente dans le projet peut joindre `fonts.googleapis.com` et `fonts.gstatic.com`.
- URL publique : Responsiver contacte nécessairement le site et ses ressources publiques autorisées. Le site reçoit l’adresse IP et les métadonnées HTTP normales.
- IA locale : Responsiver communique uniquement avec l’adresse loopback choisie. Aucun fallback cloud n’existe, mais le moteur local reste un logiciel séparé dont la configuration et les journaux doivent être contrôlés par l’utilisateur.
- Chrome : le transport extension → host reste local ; l’ouverture ultérieure de l’URL produit ensuite la connexion réseau normale au site.

Consultez [PRIVACY.md](PRIVACY.md) et [SECURITY.md](SECURITY.md) pour le détail.

## Compatibilité des projets

Le runner local ouvre les sites statiques et les sorties déjà compilées : HTML, CSS, JavaScript, médias, WebAssembly et routes SPA avec fallback local.

Responsiver n’exécute jamais automatiquement `npm install`, un build, PHP, Symfony, un serveur backend, Docker Compose, MySQL, une migration ou une commande du projet. Un projet dynamique fonctionne dans le mode localhost lorsque son environnement est déjà lancé. Associer son dossier source active alors Monaco et les overlays sans donner à Responsiver l’accès à sa base de données.

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
npm run test:e2e:remote
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

`electron-builder` produit les formats de la plateforme de build. Les paquets embarquent les avis de licence, la démo et les sources du compagnon Chrome sous `resources/companion`. Le hook de packaging refuse un paquet incomplet.

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
