# Compagnon Chrome Responsiver

Cette extension Manifest V3 envoie la page active à l’application desktop Responsiver après un clic explicite. Elle ne contient ni moteur d’audit, ni accès au projet, ni service distant.

## Permissions minimales

- `activeTab` : accès temporaire à l’URL et au titre de l’onglet après le clic sur l’extension ;
- `nativeMessaging` : communication avec le connecteur local `fr.responsiver.desktop`.

L’extension ne demande pas `tabs`, `scripting`, `<all_urls>`, les cookies, l’historique, le presse-papiers ou les téléchargements. Aucun script n’est injecté dans la page.

## Installation de développement

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer **Mode développeur**.
3. Choisir **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `extensions/chrome`.
5. Copier l’identifiant de 32 caractères affiché sous l’extension.
6. Préparer manuellement le Native Messaging Host en suivant [`native-host/README.md`](../../native-host/README.md).
7. Recharger Chrome après l’enregistrement du connecteur.
8. Ouvrir Responsiver, puis cliquer sur l’extension depuis une page HTTP ou HTTPS.

L’interface peut être testée sans connecteur. Le bouton affichera alors clairement « Application introuvable ».

Le paquet desktop embarque également ces fichiers sous `resources/companion/chrome`. Il ne les installe pas dans Chrome et n’enregistre pas le connecteur à la place de l’utilisateur. Dans le dépôt, `docs/compagnon-chrome.md` distingue les parcours source, macOS, Linux et Windows.

## Données transmises

Le message local contient uniquement :

- l’URL HTTP ou HTTPS active, y compris son chemin, sa query string et son fragment ;
- le titre de l’onglet ;
- la largeur et la hauteur disponibles signalées par Chrome ;
- la densité de pixels de la fenêtre de l’extension ;
- un identifiant aléatoire et une date d’envoi.

Une URL peut contenir un jeton ou une donnée personnelle dans sa query string. Vérifiez l’adresse avant de cliquer. Les URL comportant des identifiants HTTP (`utilisateur:mot-de-passe@hôte`) sont refusées.

Le contenu DOM, le texte de la page, les formulaires, les cookies, les mots de passe et l’historique ne sont jamais lus par l’extension. Aucune requête n’est envoyée à Responsiver, GitHub ou un service tiers sur Internet.

## États affichés

- **Page transmise** : le connecteur a validé et déposé la demande dans la file privée de Responsiver ;
- **Application introuvable** : le Native Messaging Host n’est pas installé ou n’autorise pas cette extension ;
- **Ouverture impossible** : la page n’est pas HTTP(S), le protocole est incompatible ou le connecteur a refusé la demande.

Le connecteur ne passe jamais l’URL dans une ligne de commande. Il ne lance pas l’application : Responsiver doit être ouvert manuellement. Une demande transmise alors que l’application est fermée reste en attente pendant dix minutes au maximum et sera lue au prochain démarrage dans ce délai.

## Publication

Le dossier est conçu pour une installation locale non empaquetée. Avant une publication Chrome Web Store, il faudra notamment :

- figer l’identifiant de production et l’inscrire dans `allowed_origins` du connecteur ;
- produire et signer un connecteur autonome pour chaque plateforme, sans dépendance à Node.js ;
- fournir les déclarations de confidentialité du Web Store ;
- vérifier la version du protocole avec la version desktop distribuée.

Le code est publié sous la même licence Apache-2.0 que Responsiver.
