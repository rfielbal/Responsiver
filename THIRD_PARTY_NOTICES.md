# Notices des composants tiers

Les versions exactes distribuées sont verrouillées dans `package-lock.json`. Les présentes notices concernent les dépendances directes du projet.

| Composant | Usage | Licence |
|---|---|---|
| Electron | Runtime desktop | MIT |
| React / React DOM | Interface | MIT |
| Vite | Bundler renderer | MIT |
| electron-vite | Outil de build Electron | MIT |
| electron-builder | Packaging desktop | MIT |
| PostCSS | Analyse structurelle CSS | MIT |
| Monaco Editor | Édition locale du code source | MIT |
| TypeScript | Vérification statique | Apache-2.0 |
| @vitejs/plugin-react | Compilation JSX | MIT |
| tsx | Exécution des tests TypeScript | MIT |
| Playwright | Tests navigateur et Electron | Apache-2.0 |

Les licences transitoires sont résolues par le gestionnaire de paquets et doivent être exportées dans un SBOM avant une release publique :

```bash
npm run sbom > sbom.spdx.json
```

N’ajoutez pas de dépendance, police, icône, image ou extrait de code sans licence de redistribution compatible. Les dépendances sans licence explicite sont refusées.
