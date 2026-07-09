# Architecture du MVP

```text
React renderer (contenu de confiance)
        │ bridge IPC minimal et typé
Electron main
  ├── sélecteur / validation de dossier local
  ├── analyse HTML/CSS avec PostCSS
  ├── serveur HTTP éphémère sur 127.0.0.1
  │     ├── sélection prioritaire de /index.html
  │     ├── routes HTML détectées
  │     ├── assets locaux et bridge de navigation injecté en mémoire
  │     └── CSP, contrôle de chemin réel et no-store
  └── export local de rapports JSON
        │ iframe cross-origin sandboxée
Projet importé (code non fiable)
```

## Prévisualisation

L’analyseur priorise l’entrée `/index.html` à la racine du dossier, puis recense les autres documents HTML, y compris les démos. Lorsqu’une page existe, le processus principal lance un serveur HTTP à port aléatoire, accessible exclusivement depuis `127.0.0.1`.

Le serveur résout chaque chemin réel et le compare à la racine réelle du projet afin de ne pas servir un fichier extérieur via traversée de chemin ou lien symbolique. Il refuse les fichiers cachés et les types non nécessaires au Web. Les documents HTML reçoivent un bridge de navigation en mémoire : l’historique, les liens de même origine et les `window.open()` internes restent dans l’iframe de preview.

Le renderer conserve une origine distincte de la preview. L’iframe peut exécuter les scripts locaux nécessaires au rendu, mais n’obtient ni Node.js ni l’API IPC de Responsiver. Elle est sandboxée et la fenêtre Electron interdit toute nouvelle fenêtre.

## Politique réseau

Le processus Electron applique une seconde ligne de défense à la CSP : une requête initiée par une origine de preview ne peut atteindre que cette même origine loopback, ou les ressources Google Fonts HTTPS strictement nécessaires (`stylesheet` pour `fonts.googleapis.com`, `font` pour `fonts.gstatic.com`). Les autres requêtes HTTP(S), WebSockets, navigations de sous-frame et permissions sont refusés.

Cette politique concerne le code client déjà présent dans le dossier. Responsiver ne lance pas de commandes de projet, n’installe pas de dépendance et ne fournit pas de backend.

## Évolutions prévues

1. Captures Playwright sur matrice de viewports et navigateurs.
2. Patches AST réels dans une copie de travail, puis export Git/ZIP.
3. Analyse de variables CSS et génération de thème sémantique vérifiable.
4. Runner opt-in pour projets nécessitant une commande de build, avec consentement explicite.
