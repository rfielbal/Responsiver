# Rapport produit — Responsiver 0.3

## Résultat

Responsiver est désormais un atelier desktop local réellement utilisable sur des projets statiques ou déjà compilés. La version source reste intacte ; toutes les corrections vivent dans un staging prévisualisable, traçable et exportable.

La direction UI s’appuie sur les principes observés dans [Agency Agents](https://github.com/msitarzewski/agency-agents) et son application compagnon — espace de travail opérationnel, hiérarchie nette, panneau maître/détail et traçabilité — sans copier leur code, leurs assets ou leur identité. Le résultat adopte sa propre grammaire : rail graphite, papier minéral, accent vermillon, densité d’outil professionnel, contrôles compacts et absence de gradients ou de cartes SaaS décoratives.

## Traçabilité des demandes

| Demande | Livraison | Validation |
|---|---|---|
| Déposer un fichier ou dossier | Sélecteurs séparés, chemin local et glisser-déposer | API preload typée + parcours Electron |
| Voir le vrai site | Serveur loopback interactif, scripts et assets locaux | Démo et Portfolio V.0.4 servis |
| Naviguer dans toutes les pages et démos | Routes détectées, liens, ancres, historique, popups internes | Navigation `index ↔ journal` et routes Portfolio |
| Smartphone, tablette, ordinateur | Familles séparées, modèles connus, dimensions libres, rotation | UI + test E2E |
| Comparer plusieurs tailles | Trois aperçus simultanés | Test E2E, trois iframes |
| Éviter la pollution des démos | Analyse CSS par route et filtre « Page active / Toutes les pages » | Portfolio : entrée racine prioritaire |
| Détecter les défauts responsive | Règles HTML/CSS + mesure runtime des débordements | 6 tests moteur/serveur |
| Corriger sans IA | Transformations PostCSS et overrides CSS déterministes | Patch comparé aux overlays |
| Voir la nouvelle version | Origines Source et Staging distinctes | E2E source → staging |
| Copier ou télécharger le code changé | Presse-papiers, `.patch`, fichiers modifiés, copie complète | IPC et sécurités d’export |
| Demander un ajustement par chat | Grammaire locale couleur/espacement/rayon/texte/navigation | E2E conversation sans IA |
| Générer un dark mode | Génération sémantique du thème complémentaire | Démo sombre → variante claire |
| Ne pas proposer un doublon | Détection `dark/light/dual` statique et runtime | Test dédié thème existant |
| Démo fonctionnelle | Atelier Nord multi-page, filtres et panier | Même runner, E2E packagé |
| UI/UX premium | Workbench à quatre destinations, inspecteur adaptatif | QA à 1024/1280 et Electron Retina |
| Fonctionnement local et open source | Aucune API produit, télémétrie ou IA ; licences documentées | Audit npm et notices |
| Distribution GitHub | Paquets macOS/Windows/Linux et release sur tag | Packaging macOS produit avec succès |
| Commits français | Historique découpé par capacité | Vérification Git finale |

## Choix techniques

- **Electron** : distribution desktop multi-plateforme, dialogues et isolation de contexte.
- **React + TypeScript** : interface structurée et contrats partagés renderer/main.
- **PostCSS** : lecture et modification ciblée des déclarations CSS sans génération probabiliste.
- **Serveur HTTP Node local** : comportement navigateur réaliste, navigation et assets relatifs.
- **Overlays en mémoire** : séparation stricte entre source et proposition.
- **Playwright** : validation du parcours Electron réel et du paquet construit.
- **electron-builder** : DMG/ZIP, NSIS/ZIP, AppImage/DEB et automatisation GitHub.

Les réglages de la fenêtre suivent les recommandations de sécurité d’[Electron](https://www.electronjs.org/docs/latest/tutorial/security) : isolation de contexte, sandbox, CSP, restrictions de navigation et validation IPC.

## Confidentialité, licences et coût

Le runtime ne nécessite aucun abonnement, serveur ou clé API. Google Fonts reste la seule exception réseau autorisée pour conserver le rendu d’un projet qui la référence déjà. Les workflows GitHub et le téléchargement npm interviennent uniquement pendant le développement et la construction.

Les licences MIT/Apache-2.0 imposent de conserver leurs avis ; elles ne demandent pas de paiement. GitHub et Google Fonts ont également leurs propres conditions. Le projet est donc sans coût logiciel obligatoire, mais pas « sans aucune obligation juridique ». Les fichiers `LICENSE`, `NOTICE` et `THIRD_PARTY_NOTICES.md` organisent ces obligations.

Les binaires sont non signés par défaut. C’est compatible avec une distribution gratuite depuis GitHub, mais les systèmes d’exploitation peuvent avertir l’utilisateur. Supprimer ces avertissements demanderait des certificats et, selon la plateforme, un programme développeur payant.

## Limites assumées

- Le runner cible les sites statiques ou les sorties déjà compilées ; il n’exécute pas de build arbitraire.
- Les heuristiques CSS proposent des corrections à relire, pas une preuve universelle de défaut.
- Le rendu correspond à Chromium/Electron ; un futur élargissement pourra automatiser Firefox et WebKit.
- Les dépendances distantes hors Google Fonts sont bloquées et doivent être intégrées localement après vérification de licence.
- La signature/notarisation des paquets reste volontairement hors scope tant qu’elle n’est pas décidée et financée.

## Validation réalisée

- `npm run typecheck`
- `npm test` — 6/6 tests
- `npm run test:e2e`
- `npm run test:e2e:packaged`
- `npm run build`
- `npm run package:dir`
- `npm audit` — aucune vulnérabilité connue au moment de la validation
- Portfolio V.0.4 : `/index.html` sélectionné, thème sombre détecté, ressources locales servies, Font Awesome distant signalé et démos séparées.
