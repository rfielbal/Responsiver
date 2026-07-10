# Responsiver

Responsiver est un laboratoire desktop open source pour auditer, corriger et valider la responsivité d’un projet web sans envoyer son code vers un service distant.

La version 0.4 ouvre un dossier ou un fichier HTML, sert le site sur des origines locales isolées, permet de naviguer réellement entre ses pages et mesure les débordements. Chaque correction peut être examinée dans une proposition éphémère, comparée à la source à l’endroit précis du constat, puis acceptée ou écartée. Seules les décisions validées alimentent le staging exportable ; le dossier source n’est jamais réécrit.

## Fonctionnalités

- Ouverture par dossier, fichier HTML, chemin local ou glisser-déposer.
- Détection prioritaire de la vraie entrée du site ; les dossiers `demo`, `examples` et assimilés ne prennent pas sa place.
- Navigation fonctionnelle entre les pages, ancres et fenêtres internes du projet.
- Aperçu smartphone, tablette et ordinateur avec modèles connus, dimensions libres, rotation et redimensionnement direct par les bords ou les angles.
- Plein écran pour inspecter le site sans perdre la route, la taille ou la version affichée.
- Mode **Comparer** sur trois familles d’appareils, distinct de la comparaison **Avant / Après** d’un correctif.
- Analyse HTML/CSS par route : viewport, largeurs fixes, `min-width`, `nowrap`, ressources distantes et vérification visuelle.
- Audit runtime des éléments qui débordent réellement du viewport.
- Ouverture d’un constat sur sa route et, lorsqu’il existe, sur son sélecteur DOM mis en évidence dans la preview.
- Comparaison contextualisée **Avant / Après** sur deux origines locales avant toute acceptation du correctif.
- Proposition éphémère non exportable, sélection explicitement acceptée, puis staging final non destructif avec patch unifié lisible.
- Prévisualisation immédiate d’un thème clair ou sombre : une variante absente devient une proposition à valider ou écarter, tandis qu’une variante native existante est activée sans générer de doublon.
- Ajustements locaux sans IA pour la couleur, les espacements, les arrondis, l’échelle du texte et la navigation.
- Export du patch, des seuls fichiers modifiés, d’une copie complète corrigée ou d’un rapport JSON portable.
- Démo multi-page et interactive utilisant exactement le même runner que les projets importés.

## Données et réseau

Responsiver n’intègre ni compte, télémétrie, analytics, API produit distante, moteur d’IA ou mise à jour automatique.

Le code importé reste sur la machine. Les aperçus peuvent charger uniquement leurs ressources locales et, si le projet en contient déjà, les feuilles et fichiers de police Google Fonts en HTTPS. Les autres CDN, `fetch`, WebSockets, formulaires externes, nouvelles fenêtres et permissions navigateur sont bloqués. Une ressource externe interdite est signalée dans les constats afin de pouvoir la vendoriser localement après vérification de sa licence.

Consultez [PRIVACY.md](PRIVACY.md) et [SECURITY.md](SECURITY.md) pour le détail.

## Projets pris en charge

Le runner ouvre les sites statiques et les sorties déjà compilées : HTML, CSS, JavaScript, médias, WebAssembly et routes SPA avec fallback local.

Responsiver n’exécute jamais automatiquement `npm install`, un script de build, un serveur backend, du SSR ou une commande provenant du projet. Pour Vite, Next, Nuxt, Astro et les autres chaînes nécessitant une compilation, ouvrez le fichier HTML ou le dossier produit dans `dist`, `out`, `build` ou équivalent. L’interface affiche cette limite lorsqu’une chaîne de build est détectée.

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
npm run test:e2e
npm run build
npm audit
```

Le test E2E lance Electron et couvre la démo, la navigation, la proposition avant validation, le ciblage d’un constat, le thème complémentaire, le redimensionnement, le plein écran, le staging final, la comparaison et l’export. `npm run test:e2e:packaged` exécute le même parcours sur l’application macOS déjà empaquetée.

Un projet réel peut être vérifié sans coder un scénario dédié :

```bash
npm run test:project -- /chemin/du/projet
```

## Produire les applications desktop

```bash
npm run package
```

`electron-builder` produit les formats macOS, Windows ou Linux correspondant à la machine de build. Le workflow [paquets.yml](.github/workflows/paquets.yml) construit les trois systèmes et attache les fichiers à une GitHub Release lorsqu’un tag `v*` est poussé.

Les paquets publics sont volontairement **non signés** tant qu’aucun certificat n’est configuré. Cela évite tout coût ou contrat de signature, mais macOS Gatekeeper et Windows SmartScreen peuvent afficher un avertissement. Une diffusion sans avertissement nécessite ultérieurement des certificats de signature propres à chaque plateforme ; elle devra être décidée séparément.

## Principes de correction

Chaque proposition indique sa règle, sa route, son fichier, sa ligne et son niveau de confiance. Cliquer sur un constat ouvre sa route, cible son sélecteur lorsque celui-ci est disponible et construit une comparaison Source / Proposition limitée aux choix en cours. Cette proposition est temporaire : la consulter ne la retient pas, et la refuser ne produit aucun changement persistant.

Les transformations acceptées et le thème explicitement validé sont ensuite appliqués dans une carte d’overlays en mémoire pour construire le staging final. Les fichiers sources sont re-hachés avant export : si l’un d’eux a changé entre-temps, Responsiver refuse l’export et demande de reconstruire le staging.

Les corrections heuristiques restent à relire. Responsiver ne prétend pas qu’une largeur fixe ou un `nowrap` est toujours une erreur ; l’avant/après contextualisé, la validation explicite, l’aperçu source/staging et le patch existent précisément pour garder la décision humaine.

## Open source et obligations

Le dépôt est sous licence Apache-2.0. Les dépendances directes utilisent des licences MIT ou Apache-2.0 et sont recensées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Les versions exactes sont verrouillées dans `package-lock.json` et un SBOM peut être généré avec :

```bash
npm run sbom > sbom.spdx.json
```

Open source ne signifie pas « aucune règle » : les avis de licence doivent rester distribués, GitHub reste soumis à ses conditions d’utilisation, et Google Fonts à sa politique propre lorsqu’un projet le charge. Responsiver organise ces obligations sans ajouter de service payant.

## Documentation

- [Rapport produit et traçabilité](docs/rapport-produit.md)
- [Architecture technique](docs/architecture.md)
- [Confidentialité](PRIVACY.md)
- [Sécurité](SECURITY.md)
- [Notices tierces](THIRD_PARTY_NOTICES.md)

Les commits du projet sont rédigés en français, avec des messages explicites comme `feat: créer le moteur de corrections déterministes`.
