# Architecture de Responsiver 0.3

```text
Renderer React de confiance
  ├── projets / laboratoire / révision / export
  ├── choix appareils et routes
  └── iframe cross-origin sandboxée
              │ messages navigation, thème et audit
Preload contextBridge typé
              │ IPC validé depuis la frame principale uniquement
Electron main — ProjectSession
  ├── analyseur HTML/CSS route-scopé
  ├── serveur source 127.0.0.1:port-aléatoire
  ├── transformeur déterministe
  │     └── Map<chemin, contenu> d’overlays
  ├── serveur staging 127.0.0.1:autre-port
  └── exports explicites + contrôle des hashes
              │
        Projet source en lecture seule
```

## Session projet

Le processus principal possède l’unique `ProjectSession` active : racine réelle, snapshot d’analyse, serveur source, staging et serveur corrigé. Ouvrir un autre projet ferme les deux serveurs précédents et efface leur stockage Chromium.

Une sélection peut être un dossier ou un fichier `.html/.htm`. Dans le second cas, son dossier devient la racine et le fichier choisi reste l’entrée prioritaire. Sans sélection explicite, l’analyseur privilégie `/index.html` à la racine et pénalise les chemins de démo, test, documentation ou Storybook.

## Analyse par route

Chaque document HTML conserve son titre, sa route et ses feuilles CSS réellement liées, y compris leurs `@import` locaux. Les styles d’une démo n’alimentent donc plus les constats de la page principale. L’inspecteur affiche par défaut la page active et permet de basculer vers tout le projet.

Les IDs des constats sont des empreintes stables de la règle, de la route et de la source. Les règles automatiques actuelles couvrent :

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
- mesure du `scrollWidth` et des éléments qui sortent du viewport.

Le renderer ne peut lire le DOM de l’iframe, car l’origine loopback est distincte. Le projet ne peut pas accéder au preload ou à IPC.

## Staging non destructif

Le transformeur reçoit les IDs retenus, le thème cible et les instructions locales reconnues. Il produit :

- des fichiers modifiés en mémoire ;
- une feuille `.responsiver/responsiver.generated.css` si nécessaire ;
- un patch unifié ;
- la liste des changements et leur confiance ;
- les empreintes SHA-256 des sources concernées.

Le serveur staging lit d’abord les overlays, puis retombe sur le dossier source pour les autres assets. Source et staging ont des ports distincts et peuvent être comparés simultanément. Le thème et les instructions sont reliés par des chemins relatifs pour rester valides après export ; les pages principales reçoivent la variante, les démos indépendantes restent isolées.

Avant tout export, les hashes sont recalculés. Un changement concurrent du projet invalide le staging. Les fichiers peuvent être livrés seuls, dans une copie complète, ou sous forme de patch ; l’original n’est jamais modifié.

## Thèmes et conversation locale

Le profil de thème combine `color-scheme`, media queries, sélecteurs de thème, surfaces et variables CSS. La variante proposée est toujours complémentaire. Les variables sont classées par rôle — fond, surface, texte, contenu atténué, bordure, accent — puis une palette déterministe vérifie les contrastes connus. Il n’existe aucune inversion globale des couleurs.

La conversation n’est pas un modèle de langage. Un parseur local reconnaît uniquement des intentions explicites : thème clair/sombre, couleur d’accent, densité, arrondis, taille typographique et retour à la ligne de navigation. Une demande inconnue est conservée et refusée honnêtement au lieu de générer du code arbitraire.

## Frontières de sécurité

- `nodeIntegration: false`, `contextIsolation: true`, sandbox Chromium active.
- IPC disponible uniquement depuis la frame principale du renderer.
- permissions navigateur refusées et nouvelles fenêtres interdites.
- CSP distinctes pour l’application et la preview.
- sorties réseau de preview limitées à sa propre origine et à Google Fonts HTTPS.
- stockage preview supprimé à la fermeture du serveur.
- exports protégés contre traversée, symlink et destination interne au projet source.

Le JavaScript local du projet s’exécute pour préserver les interactions. Responsiver réduit ses capacités réseau et système, mais ne remplace pas une machine virtuelle pour analyser un projet réellement malveillant.

## Projets nécessitant un build

La version 0.3 ne lance aucune commande provenant du projet. Cette décision évite l’exécution silencieuse de scripts arbitraires. Les frameworks compilés doivent fournir leur sortie statique (`dist`, `out`, `build`) ou un fichier HTML généré. Un futur runner de build devra être opt-in, afficher la commande exacte, limiter ses droits et obtenir un consentement explicite.
