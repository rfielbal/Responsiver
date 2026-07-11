# Sécurité

## Renderer et IPC

- `nodeIntegration` est désactivé, l’isolation de contexte et le sandbox Chromium sont actifs.
- Le preload expose un bridge IPC typé et minimal à la frame principale uniquement.
- Les paramètres IPC sont bornés et revalidés dans le processus principal.
- Les nouvelles fenêtres du renderer sont refusées et sa CSP limite les sources chargées.

## Projet local et runner

- La preview locale utilise une iframe d’origine loopback différente, sans Node ni accès au preload.
- Le serveur écoute uniquement `127.0.0.1`, contrôle `Host`, méthode, MIME, chemins réels, fichiers cachés et liens symboliques.
- Les sorties compilées sont montées depuis une base canonique sans exposer les dossiers serveur voisins.
- La CSP de preview limite scripts, connexions, formulaires, workers et frames à l’origine locale, avec la seule exception Google Fonts HTTPS.
- Caméra, micro, géolocalisation, notifications et autres permissions Chromium sont refusés.
- Les nouvelles fenêtres internes sont ramenées dans la preview ; les destinations externes sont bloquées.
- Le stockage de l’origine est effacé lors de la fermeture du serveur.

Le JavaScript du projet s’exécute pour préserver les interactions. La CSP de compatibilité autorise certains scripts inline et évaluations dans cette origine confinée. Responsiver n’est pas une machine virtuelle : n’ouvrez pas un projet malveillant en supposant qu’il est inoffensif.

## URL publique et localhost

- Une URL distante est rendue dans un `WebContentsView` sandboxé, sans Node, preload ou API fichier.
- Chaque session utilise une partition Chromium aléatoire non persistante.
- Permissions, téléchargements et popups sont refusés.
- Le mode public exige HTTPS ; toutes les adresses DNS doivent être publiques.
- Le mode localhost accepte uniquement la boucle locale, jamais le LAN.
- Redirections et sous-ressources sont revalidées afin de réduire SSRF et DNS rebinding.
- La navigation principale reste dans le périmètre d’hôtes approuvé.
- Le stockage est effacé et le debugger détaché à la fermeture.

Le site distant exécute son JavaScript dans Chromium et peut consommer CPU, mémoire ou réseau autorisé. Le sandbox réduit son accès au système, sans garantir qu’un site hostile est sans danger.

## Audit visuel

- Le script de collecte limite nœuds, constats, textes, sélecteurs, styles et durée d’exécution.
- Le résultat JavaScript est considéré comme non fiable et assaini dans le processus principal.
- Route, URL et viewport du résultat sont remplacés par le contexte déjà approuvé.
- Les captures sont bornées en dimensions et en taille.
- Un sélecteur utilisé pour cibler un constat est limité puis évalué dans la page sans exposition d’IPC.

## Espace code et écritures

- Seuls les chemins relatifs à une racine locale autorisée sont acceptés.
- Les fichiers cachés, dépendances, vendors, builds, binaires, liens symboliques, secrets, clés, certificats, bases et dumps sont exclus.
- Les fichiers et budgets mémoire sont plafonnés ; seuls les textes UTF-8 sont éditables.
- Chaque overlay possède une version et des hashes source/courant.
- La preview lit des copies mémoire et ne vaut jamais confirmation d’écriture.
- **Appliquer au fichier** vérifie que la source n’a pas changé, écrit un fichier temporaire dans le même dossier puis effectue un renommage atomique.
- **Valider et appliquer** est limité à une proposition isolée sur un projet local durable. Tous les chemins, liens symboliques et hashes du lot sont contrôlés avant la première substitution ; une erreur déclenche un rollback des fichiers déjà remplacés.
- L’annulation n’est autorisée que si chaque fichier appliqué possède encore son hash attendu. Elle restaure aussi les fichiers et dossiers créés par l’application.

Une application explicite peut introduire une régression ou une vulnérabilité. Relisez le diff et utilisez Git ou une sauvegarde ; la protection technique empêche les écritures implicites et conflits connus, pas les mauvaises décisions humaines.

## Assistant IA local

- Seules les adresses HTTP `127.0.0.1`, `localhost` et `::1` sont acceptées ; `localhost` est normalisé vers `127.0.0.1`.
- Identifiants, paramètres, fragments et redirections sont refusés.
- Prompts, contextes, captures et réponses sont plafonnés.
- Les fichiers sensibles sont exclus et les chemins de sortie sont revalidés.
- Le modèle ne dispose d’aucun terminal, shell, outil système ou accès direct au disque.
- La consigne système traite le contenu de la page et du projet comme non fiable.
- Une proposition IA rejoint uniquement l’overlay jusqu’à une application explicite.
- Aucun fallback cloud n’existe.

Un autre processus local peut tenter d’occuper le port configuré ou un modèle peut produire du code dangereux. Vérifiez l’identité du moteur, protégez votre session utilisateur et considérez chaque sortie comme non fiable. Responsiver ne peut pas garantir la sécurité, la licence ou la politique de logs d’un moteur ou modèle tiers.

## Compagnon Chrome

- L’extension demande uniquement `activeTab` et `nativeMessaging`, sans `<all_urls>`, cookies, historique ou injection de script.
- Le host limite l’appelant à l’identifiant présent dans `allowed_origins`.
- Le protocole Native Messaging utilise un framing borné à 64 Kio et un schéma fermé.
- HTTPS est obligatoire pour Internet ; HTTP(S) est limité à la boucle locale et les identifiants intégrés sont refusés.
- La file est privée sur POSIX, bornée à 128 demandes, purgée avant chaque nouvel écrit et ses noms ne contiennent pas l’URL.
- Electron réclame atomiquement les fichiers, refuse symlinks, tailles ou schémas inconnus et supprime les demandes expirées.
- Le host ne lance aucun shell et ne place jamais l’URL dans `argv`.

Le host ne démarre pas l’application. L’installation manuelle et la dépendance actuelle à Node sur macOS/Linux sont des limites de distribution, détaillées dans [docs/compagnon-chrome.md](docs/compagnon-chrome.md). Aucun host Windows autonome n’est livré à ce stade.

## Historique, staging et exports

- L’historique contient uniquement chemins et compteurs dans un JSON privé, borné, validé et atomique.
- Un projet `blocked` ou `needs-build` ne peut créer proposition ou staging.
- Les stagings re-hachent les sources et refusent les changements concurrents ou propositions incompatibles.
- Les exports contrôlent traversées, liens symboliques et destinations internes au projet.
- Les dossiers d’export sont réservés atomiquement avec des permissions privées sur POSIX.
- Les rapports omettent chemins absolus et origines temporaires.

## Packaging et chaîne de livraison

- `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `PRIVACY.md`, `SECURITY.md` et les ressources du compagnon sont vérifiés après packaging.
- Les releases incluent un SBOM SPDX et `SHA256SUMS` couvrant les paquets.
- La publication refuse une version de tag différente de `package.json`.
- Le paquet macOS retire les descriptions de permissions inutilisées ; ATS refuse les chargements arbitraires tout en autorisant localhost.

Les paquets restent non signés. Vérifiez provenance et hashes. Une diffusion grand public nécessite signature, notarisation et un Native Messaging Host autonome par plateforme.

## Signaler une vulnérabilité

Ne publiez pas une vulnérabilité exploitable dans une issue publique. Contactez le mainteneur par un canal privé avec version, reproduction minimale, impact et correctif éventuel.
