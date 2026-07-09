# Responsiver

Responsiver est une application desktop open source pour analyser localement la responsivité d’un projet web, visualiser son HTML/CSS à plusieurs dimensions, puis préparer des corrections explicables.

## Principes du MVP

- Aucun compte, API distante, analytics ou envoi de projet.
- Les dossiers importés sont uniquement lus sur la machine.
- L’aperçu statique retire les scripts et les iframes, puis bloque le réseau et les soumissions de formulaires.
- Les constats sont classés comme `standard`, `heuristique` ou `manuel`.
- Les propositions vont dans un staging ; le projet original n’est jamais modifié automatiquement.

Le MVP prend en charge l’analyse de HTML et CSS locaux. Les projets dynamiques, SSR et les commandes de build nécessiteront un runner isolé dans une étape ultérieure.

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

1. **Projets** — ouvrir un dossier local ou une démo locale.
2. **Tester** — choisir un viewport, une orientation et le thème clair/sombre.
3. **Constats** — comprendre la règle, le viewport et le fichier concernés.
4. **Modifications** — accepter ou retirer des propositions dans le staging.
5. **Thèmes** — vérifier les éléments à traiter pour un dark mode sémantique.
6. **Exporter** — copier un patch de travail ou enregistrer un rapport JSON local.

## Sécurité et confidentialité

La politique détaillée est disponible dans [PRIVACY.md](PRIVACY.md) et le signalement de vulnérabilités dans [SECURITY.md](SECURITY.md).

Les dépendances, notices et licences tierces sont recensées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Le dépôt est sous licence Apache-2.0.

## Contribuer

Les commits suivent des messages français, impératifs et explicites, par exemple :

```text
feat: ajouter le laboratoire de prévisualisation
fix: empêcher la navigation externe de la fenêtre principale
docs: préciser les limites du mode statique sécurisé
```
