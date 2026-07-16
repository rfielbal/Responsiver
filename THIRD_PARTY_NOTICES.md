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
| Lucide React | Icônes de l’interface | ISC |
| TypeScript | Vérification statique | Apache-2.0 |
| @vitejs/plugin-react | Compilation JSX | MIT |
| tsx | Exécution des tests TypeScript | MIT |
| Playwright | Tests navigateur et Electron | Apache-2.0 |

Les licences transitoires sont résolues par le gestionnaire de paquets et doivent être exportées dans un SBOM avant une release publique :

```bash
npm run sbom > sbom.spdx.json
```

N’ajoutez pas de dépendance, police, icône, image ou extrait de code sans licence de redistribution compatible. Les dépendances sans licence explicite sont refusées.

## Lucide React — licence ISC

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
