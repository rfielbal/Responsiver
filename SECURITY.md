# Sécurité

## Frontières techniques

- `nodeIntegration` est désactivé, l’isolation de contexte et le sandbox Chromium sont activés.
- Le preload n’expose qu’un bridge IPC minimal à la fenêtre principale ; les appels IPC sont refusés depuis une sous-frame.
- La preview est une iframe à origine loopback distincte, sans accès Node.js ni accès au bridge IPC.
- Les nouvelles fenêtres sont refusées. Les liens et `window.open()` internes sont ramenés dans la preview ; les sorties externes sont bloquées.
- Le serveur de preview est lié à `127.0.0.1`, contrôle les chemins réels pour éviter les sorties par lien symbolique et refuse les fichiers cachés et types de ressources non web.
- Une CSP de réponse limite les scripts, connexions, formulaires, workers et frames à la même origine. L’exception est limitée à Google Fonts HTTPS pour styles et polices.
- Les permissions Chromium sont systématiquement refusées : caméra, micro, géolocalisation, notifications, périphériques, etc.
- Le dossier original n’est jamais écrit automatiquement.

## Limites assumées

Le JavaScript importé s’exécute pour rendre correctement les projets interactifs. Il est cadré par Chromium, l’iframe, la CSP et la politique réseau, mais Responsiver n’est pas un bac à sable anti-malware complet : du code non fiable peut consommer CPU, mémoire ou stockage navigateur. N’ouvrez que des projets dont vous pouvez raisonnablement faire confiance au contenu.

La politique réseau réduit fortement l’exfiltration, sans remplacer l’analyse de code ou une machine isolée pour du contenu suspect. Google Fonts reste une exception explicitement documentée dans [PRIVACY.md](PRIVACY.md).

## Signaler une vulnérabilité

Ne publiez pas une vulnérabilité exploitable dans une issue publique. Ouvrez plutôt une discussion privée avec le mainteneur du dépôt et fournissez : version concernée, reproduction minimale, impact estimé et correctif éventuel.

Une version de correction et une note de sécurité seront publiées dès que possible.
