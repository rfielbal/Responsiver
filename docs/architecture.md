# Architecture de Responsiver 0.5

```text
Renderer React de confiance
  ├── projets / laboratoire / révision / export
  ├── appareils, dimensions, redimensionnement et plein écran
  ├── décision explicite : aperçu / accepter / écarter
  └── iframes cross-origin sandboxées
              │ messages navigation, thème, audit et ciblage
Preload contextBridge typé
              │ IPC validé depuis la frame principale uniquement
Electron main — ProjectSession
  ├── préparation : inventaire / entrée / readiness / constats
  ├── analyseur HTML/CSS route-scopé + artefact compilé éventuel
  ├── serveur source 127.0.0.1:port-aléatoire
  ├── transformeur déterministe
  │     └── Map<chemin, contenu> d’overlays
  ├── serveur de proposition éphémère 127.0.0.1:port-aléatoire
  ├── serveur de staging validé 127.0.0.1:autre-port
  ├── historique privé de chemins, sans cache de code
  └── exports explicites + contrôle des hashes
              │
        Projet source en lecture seule
```

## Session projet

Le processus principal possède l’unique `ProjectSession` active : racine réelle, snapshot d’analyse, serveur source, éventuel serveur de proposition et éventuel staging validé. Ouvrir un autre projet ferme les trois origines précédentes, lorsqu’elles existent, et libère leur état de preview éphémère.

Une sélection peut être un dossier ou un fichier `.html/.htm`. Dans le second cas, son dossier devient la racine et le fichier choisi reste l’entrée prioritaire. Sans sélection explicite, l’analyseur privilégie `/index.html` à la racine et pénalise les chemins de démo, test, documentation ou Storybook. Si cette entrée est un shell à compiler, l’analyseur cherche prudemment une sortie existante dans `dist`, `build`, `out` ou `.output/public`. Un `public/index.html` de framework n’est pas pris pour un build final. Pour un artefact imbriqué, la racine web est choisie entre le plus profond ancêtre commun des pages HTML et la base autorisée, en vérifiant `<base href>`, les références absolues et les chemins relatifs remontants. Les routes sœurs restent ainsi navigables sans exposer les dossiers voisins. Il ne lance aucune commande.

## Préparation et historique

L’ouverture est une transaction locale séquencée : validation du chemin, inventaire, qualification des routes, analyse responsive, qualification de la preview, puis démarrage du runner. Le renderer reçoit ces étapes par un événement IPC ; l’overlay n’apparaît qu’après un court délai afin de ne pas faire clignoter les projets instantanés. La redirection vers le laboratoire intervient seulement quand l’analyse et le serveur sont prêts.

Le verdict de preview est indépendant des constats CSS : `ready`, `degraded`, `blocked` ou `needs-build`. Il tient compte de la structure HTML, du contenu visible potentiel, des scripts locaux réellement exécutables, des CSS vides, des médias non référencés, de la fraîcheur de l’artefact et de l’exhaustivité de l’inventaire. Un périmètre tronqué ou une racine d’artefact incertaine dégrade explicitement le verdict au lieu de présenter l’analyse comme exhaustive. Un projet bloqué n’obtient ni runner, ni proposition, ni staging. Ses diagnostics restent consultables comme constats manuels.

Le processus main conserve un document JSON versionné sous `app.getPath('userData')`. Il contient uniquement le chemin canonique sélectionné, l’entrée et quelques compteurs. La lecture est bornée et validée ; les écritures sont atomiques, le fichier est privé en `0600` sur POSIX et les chemins absents restent visibles jusqu’à leur retrait explicite. Une réouverture repasse toujours par `realpath`, l’analyse et un nouveau runner.

## Analyse par route

Chaque document HTML conserve son titre, sa route et ses feuilles CSS réellement liées, y compris leurs `@import` locaux. Les styles d’une démo n’alimentent donc plus les constats de la page principale. L’inspecteur affiche par défaut la page active et permet de basculer vers tout le projet.

Les IDs des constats sont des empreintes stables de la règle, de la route et de la source. Un constat peut aussi porter le sélecteur CSS de l’élément concerné. Lorsqu’il est ouvert dans le laboratoire, Responsiver active d’abord sa route, puis demande au bridge de chercher ce sélecteur, de centrer l’élément et de le mettre temporairement en évidence. Les pseudo-éléments et pseudo-classes dynamiques sont retirés pour obtenir un sélecteur interrogeable ; si aucun élément ne correspond, la route reste ouverte sans prétendre avoir trouvé la cible.

Les règles automatiques actuelles couvrent :

- absence de balise viewport ;
- `min-width` rigide sur petit écran ;
- largeur fixe supérieure à 640 px ;
- `white-space: nowrap`, hors contenus masqués pour lecteurs d’écran et pistes animées ;
- ressources externes bloquées par la politique locale.

PostCSS fournit une représentation structurée des déclarations. Sass, Less et les CSS non reliés sont signalés mais jamais réécrits aveuglément.

## Preview locale

Le serveur Node HTTP écoute uniquement `127.0.0.1` et un port aléatoire. Il accepte `GET` et `HEAD`, contrôle l’en-tête `Host`, les chemins réels, les liens symboliques, les fichiers cachés et une liste de types MIME Web. Les requêtes `Range` permettent de lire correctement les vidéos et fichiers audio.

Le HTML est transformé uniquement en mémoire pour injecter, avant les scripts du projet, un bridge sans accès Node :

- navigation interne, historique et rechargement ;
- redirection des `window.open()` internes dans l’iframe ;
- observation du thème après mutations du DOM ;
- mesure du `scrollWidth` et des éléments qui sortent du viewport ;
- smoke-test du rendu à 600 puis 1 800 ms, puis requalification sur mutation ou erreur tardive, avec exploration bornée des Shadow DOM ouverts et pseudo-éléments peints ;
- ciblage route + sélecteur et suppression de la mise en évidence précédente.

Le renderer ne peut lire le DOM de l’iframe, car l’origine loopback est distincte. Le projet ne peut pas accéder au preload ou à IPC.

Les dimensions de viewport restent des dimensions CSS réelles, même lorsque l’interface réduit visuellement l’iframe pour la faire tenir dans l’atelier. Les modèles d’appareils et les champs numériques peuvent être complétés par une manipulation directe des bords ou des angles ; le renderer convertit ce geste en largeur et hauteur personnalisées. Le plein écran agrandit la scène de travail sans ouvrir une origine différente et sans changer la route, le thème candidat ou la version observée.

## Proposition éphémère, décision et staging

Le cycle sépare volontairement quatre actions :

1. **Analyser** produit des constats sans modifier le projet.
2. **Prévisualiser** construit des overlays temporaires et démarre une origine de proposition. La source et la proposition sont alors affichables côte à côte sur la même route, la même taille et, si possible, le même sélecteur.
3. **Accepter ou écarter** met à jour la sélection de décisions du renderer. Une simple consultation, un changement de thème dans le sélecteur ou l’ouverture d’un constat ne vaut jamais acceptation.
4. **Construire le staging** matérialise uniquement les constats acceptés, le thème validé et les instructions locales retenues. Ce staging devient la seule base de révision et d’export.

Une proposition éphémère remplace la proposition précédente et son serveur est fermé lorsqu’elle est effacée, remplacée, transformée en staging ou lorsque la session projet se termine. Elle n’est pas enregistrée dans le projet et ne peut pas être exportée directement.

Pour une proposition comme pour le staging, le transformeur reçoit les IDs concernés, le thème cible et les instructions locales reconnues. Il produit :

- des fichiers modifiés en mémoire ;
- une feuille `.responsiver/responsiver.generated.css` si nécessaire ;
- un patch unifié ;
- la liste des changements et leur confiance ;
- les empreintes SHA-256 des sources concernées.

Les serveurs de proposition et de staging lisent d’abord leurs overlays, puis retombent sur le dossier source pour les autres assets. Quand un artefact est monté, les routes et assets absolus sont résolus dans sa base canonique sans exposer les dossiers voisins, notamment `.output/server`. La feuille générée est placée dans le `.responsiver` de ce mount afin qu’un export de l’artefact reste autonome. Source, proposition et staging ont des ports distincts et peuvent être comparés sans ambiguïté.

Avant tout export, les hashes sont recalculés. Un changement concurrent du projet invalide le staging. Chaque export de dossier réserve atomiquement une destination privée, vérifie sa racine réelle et refuse qu’un lien symbolique la remplace. Les fichiers peuvent être livrés seuls, dans une copie complète, ou sous forme de patch ; l’original n’est jamais modifié. Si les fichiers ciblés appartiennent à une sortie compilée, le laboratoire, la révision et l’export rappellent que le correctif doit être reporté dans les sources avant le prochain build.

## Thèmes et conversation locale

Le profil de thème combine `color-scheme`, media queries, sélecteurs de thème, surfaces et variables CSS. Une variante déjà présente n’est pas proposée comme une correction identique : un site sombre reçoit une candidate claire, un site clair une candidate sombre, et un site réellement double ne reçoit pas de doublon. Les variables sont classées par rôle — fond, surface, texte, contenu atténué, bordure, accent — puis une palette déterministe vérifie les contrastes connus. Il n’existe aucune inversion globale des couleurs.

Choisir **Clair** ou **Sombre** dans le laboratoire met immédiatement la preview à jour. Si la variante manque, Responsiver reconstruit une proposition non validée ; l’utilisateur doit ensuite la valider ou l’écarter. Si elle existe déjà, le bridge active ses conventions natives courantes — attributs de thème, classes et règles `prefers-color-scheme` locales — uniquement pour l’aperçu, sans créer de changement artificiel à valider. Le thème généré et validé est séparé du thème actuellement observé et lui seul rejoint le staging final.

Chaque transition Source → Proposition → Staging recrée l’iframe lorsque son origine change. Electron n’autorise son chargement initial que si la destination loopback appartient à la liste éphémère des serveurs de preview connus ; une fois le projet chargé, toute navigation initiée depuis `127.0.0.1` reste cantonnée à sa propre origine. Cette règle continue de protéger un document pendant les quelques millisecondes où son ancien serveur est déjà fermé. Le nettoyage d’une proposition transporte en outre son origine attendue, afin qu’une requête tardive ne puisse jamais fermer le serveur qui l’a remplacée.

La conversation n’est pas un modèle de langage. Un parseur local reconnaît uniquement des intentions explicites : thème clair/sombre, couleur d’accent, densité, arrondis, taille typographique et retour à la ligne de navigation. Une demande inconnue est conservée et refusée honnêtement au lieu de générer du code arbitraire.

## Frontières de sécurité

- `nodeIntegration: false`, `contextIsolation: true`, sandbox Chromium active.
- IPC disponible uniquement depuis la frame principale du renderer.
- permissions navigateur refusées et nouvelles fenêtres interdites.
- CSP distinctes pour l’application et la preview.
- sorties réseau de chaque preview limitées à sa propre origine et à Google Fonts HTTPS.
- stockage preview supprimé à la fermeture du serveur.
- historique limité à des métadonnées locales, schéma strict, écriture atomique et permissions privées.
- exports protégés contre traversée, symlink et destination interne au projet source.

Le JavaScript local du projet s’exécute pour préserver les interactions. Responsiver réduit ses capacités réseau et système, mais ne remplace pas une machine virtuelle pour analyser un projet réellement malveillant.

## Projets nécessitant un build

La version 0.5 détecte et monte automatiquement une sortie statique déjà présente, mais ne lance aucune commande provenant du projet. Cette décision évite l’exécution silencieuse de scripts arbitraires. En l’absence d’artefact, le projet est marqué `needs-build` et reste hors du runner. Un futur runner de build devra être opt-in, afficher la commande exacte, limiter ses droits et obtenir un consentement explicite.
