# Sécurité

## Principes techniques

- `nodeIntegration` est désactivé dans la fenêtre de rendu.
- L’isolation de contexte et le sandbox Chromium sont activés.
- Le bridge preload n’expose que des méthodes IPC précises.
- Les nouvelles fenêtres, navigations externes et permissions navigateur sont refusées.
- Le dossier original n’est jamais écrit automatiquement.

## Signaler une vulnérabilité

Ne publiez pas une vulnérabilité exploitable dans une issue publique. Ouvrez plutôt une discussion privée avec le mainteneur du dépôt et fournissez : version concernée, reproduction minimale, impact estimé et correctif éventuel.

Une version de correction et une note de sécurité seront publiées dès que possible.

