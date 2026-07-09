# Architecture du MVP

```text
React renderer (contenu de confiance)
        │ bridge IPC minimal et typé
Electron main
  ├── sélecteur de dossier local
  ├── analyse HTML/CSS avec PostCSS
  ├── création d’un aperçu statique assaini
  └── export local de rapports JSON
```

## Frontières de sécurité

Le code importé est considéré non fiable. L’aperçu s’exécute dans une iframe sans permission, avec un CSP qui bloque les connexions externes. Le renderer Electron ne reçoit jamais les privilèges Node.js.

## Évolutions prévues

1. Runner de build opt-in, isolé dans un environnement dédié.
2. Captures Playwright sur matrice de viewports et navigateurs.
3. Patches AST réels dans une copie de travail, puis export Git/ZIP.
4. Analyse de variables CSS pour le dark mode.

