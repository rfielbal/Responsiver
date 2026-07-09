# Responsiver

Responsiver est une application desktop open source pour vérifier localement la responsivité d’un projet web, parcourir ses pages et démos à différentes tailles, puis préparer des décisions de correction explicables.

## Principes

- Aucun compte, API produit, télémétrie ou envoi volontaire de projet.
- Les dossiers importés sont lus et servis uniquement depuis la machine.
- Un serveur HTTP temporaire, limité à `127.0.0.1` et à un port aléatoire, permet aux liens, assets et scripts **locaux** de fonctionner.
- Les routes HTML détectées sont accessibles depuis le sélecteur de pages ; les popups internes sont réorientés dans la preview.
- Le projet source n’est jamais modifié automatiquement.
- Les constats distinguent `standard`, `heuristique` et `manuel`.

La seule sortie réseau autorisée par défaut depuis une preview est le chargement HTTPS de Google Fonts (`fonts.googleapis.com` pour les feuilles de style et `fonts.gstatic.com` pour les polices). Consultez [PRIVACY.md](PRIVACY.md) pour ses conséquences. Les autres destinations, permissions navigateur et ouvertures externes sont refusées.

## Périmètre actuel

Responsiver 0.2 prend en charge les projets HTML, CSS et JavaScript déjà prêts à servir : site statique, assets locaux, pages secondaires et démos navigateur. Il ne lance ni `npm install`, ni commande de build/dev, ni backend, SSR ou service distant.

Le staging conserve aujourd’hui des propositions textuelles vérifiables ; il ne génère pas encore un patch AST appliquable. La vue Thèmes détecte l’état de la page active et recommande seulement le thème complémentaire : la génération sémantique de thème reste à construire.

## Lancer l’application

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Vérifications :

```bash
npm run typecheck
npm run build
npm audit
npm run sbom > sbom.spdx.json
```

## Parcours produit

1. **Projets** — choisir un dossier, ou coller son chemin local ; une démo intégrée reste disponible.
2. **Tester** — choisir une famille d’appareil, un format, des dimensions exactes et l’orientation ; naviguer entre les pages détectées.
3. **Constats** — lire la règle, le viewport et le fichier concernés.
4. **Modifications** — décider quelles propositions entrent dans le staging, sans faux aperçu avant/après.
5. **Thèmes** — partir du thème réellement rendu sur la page active et éviter les doublons clair/sombre.
6. **Exporter** — copier les propositions retenues ou enregistrer un rapport JSON local.

## Sécurité et confidentialité

La politique détaillée est disponible dans [PRIVACY.md](PRIVACY.md), les limites de sécurité et le signalement de vulnérabilités dans [SECURITY.md](SECURITY.md), et l’architecture dans [docs/architecture.md](docs/architecture.md).

Les dépendances, notices et licences tierces sont recensées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Le dépôt est sous licence Apache-2.0.

## Contribuer

Les commits suivent des messages français, impératifs et explicites, par exemple :

```text
feat: rendre les projets locaux navigables
fix: bloquer les sorties réseau de la prévisualisation
docs: préciser les limites du runner local
```
