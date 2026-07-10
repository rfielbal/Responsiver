# Sécurité

## Frontières techniques

- `nodeIntegration` est désactivé, l’isolation de contexte et le sandbox Chromium sont activés.
- Le preload n’expose qu’un bridge IPC minimal à la fenêtre principale ; les appels IPC sont refusés depuis une sous-frame.
- La preview est une iframe à origine loopback distincte, sans accès Node.js ni accès au bridge IPC.
- Les nouvelles fenêtres sont refusées. Les liens et `window.open()` internes sont ramenés dans la preview ; les sorties externes sont bloquées.
- Le serveur de preview est lié à `127.0.0.1`, contrôle les chemins réels pour éviter les sorties par lien symbolique et refuse les fichiers cachés et types de ressources non web.
- Le serveur vérifie l’en-tête `Host`, n’accepte que `GET` et `HEAD`, prend en charge les plages d’octets et utilise `no-store`.
- Une sortie compilée détectée est montée depuis une liste de bases autorisées ; les chemins absolus du site restent dans ce mount et les répertoires serveur voisins demeurent inaccessibles.
- Une CSP de réponse limite les scripts, connexions, formulaires, workers et frames à la même origine. L’exception est limitée à Google Fonts HTTPS pour styles et polices.
- Les permissions Chromium sont systématiquement refusées : caméra, micro, géolocalisation, notifications, périphériques, etc.
- Le dossier original n’est jamais écrit automatiquement.
- L’historique ne stocke que des chemins et compteurs dans un JSON privé, borné, validé et écrit atomiquement ; il ne met jamais le code ou les corrections en cache.
- Un projet qualifié `blocked` ou `needs-build` ne peut démarrer ni proposition ni staging, y compris par appel IPC direct.
- Les exports vérifient les hashes SHA-256 des sources, refusent les liens symboliques sur les chemins corrigés et imposent une destination hors du projet pour les copies. Chaque dossier d’export est réservé atomiquement, privé en `0700` sur POSIX et revalidé pendant sa matérialisation.
- Les avis `LICENSE`, `NOTICE` et `THIRD_PARTY_NOTICES.md` sont obligatoirement inclus dans les ressources de chaque paquet ; la construction échoue s’ils sont absents.
- Les releases GitHub incluent un SBOM SPDX et un manifeste `SHA256SUMS` vérifié couvrant le SBOM et chaque paquet ; un tag dont la version diverge de `package.json` bloque la publication.
- Le paquet macOS supprime les descriptions de permissions caméra, micro, audio et Bluetooth inutilisées ; ATS refuse les chargements arbitraires tout en autorisant localhost.

## Limites assumées

Le JavaScript importé s’exécute pour rendre correctement les projets interactifs. Il est cadré par Chromium, l’iframe, la CSP et la politique réseau, mais Responsiver n’est pas un bac à sable anti-malware complet : du code non fiable peut consommer CPU, mémoire ou stockage navigateur. N’ouvrez que des projets dont vous pouvez raisonnablement faire confiance au contenu.

La politique réseau réduit fortement l’exfiltration, sans remplacer l’analyse de code ou une machine isolée pour du contenu suspect. Google Fonts reste une exception explicitement documentée dans [PRIVACY.md](PRIVACY.md).

La CSP de compatibilité des projets autorise les scripts inline et certaines évaluations à l’intérieur de l’origine de preview. Cette liberté est nécessaire pour rendre des sites existants, mais reste confinée par l’iframe cross-origin, le sandbox Chromium et le blocage réseau. N’ouvrez pas un projet malveillant en supposant que Responsiver est une machine virtuelle.

## Distribution non signée

Les paquets de développement et GitHub sont non signés par défaut. Vérifiez leur hash et leur provenance avant exécution. La signature et la notarisation nécessitent des certificats distincts et devront être activées explicitement avant une diffusion à grande échelle.

## Signaler une vulnérabilité

Ne publiez pas une vulnérabilité exploitable dans une issue publique. Ouvrez plutôt une discussion privée avec le mainteneur du dépôt et fournissez : version concernée, reproduction minimale, impact estimé et correctif éventuel.

Une version de correction et une note de sécurité seront publiées dès que possible.
