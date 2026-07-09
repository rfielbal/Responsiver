# Politique de confidentialité

Responsiver est conçu pour fonctionner localement.

## Ce que l’application ne fait pas

- Elle ne téléverse pas volontairement le contenu des projets importés.
- Elle ne crée pas de compte utilisateur.
- Elle n’active ni télémétrie, ni analytics, ni rapport de crash externe.
- Elle n’appelle aucune API produit distante.
- Elle ne lance pas de gestionnaire de paquets, de build ou de serveur de développement pour le projet importé.

## Ce qui reste sur l’ordinateur

Les chemins choisis, fichiers analysés, aperçus, décisions de staging et rapports sont traités localement. Un rapport JSON n’est écrit qu’à l’emplacement explicitement sélectionné. Le dossier source n’est jamais écrit automatiquement par Responsiver.

## Aperçu local interactif

Un dossier importé est servi temporairement sur `127.0.0.1` afin que ses pages, scripts, formulaires et assets **locaux** restent utilisables. Le serveur est fermé au changement de projet et à la fermeture de l’application. Il ne rend accessible que des types de ressources web autorisés à l’intérieur du dossier choisi.

Les destinations externes initiées par la preview sont bloquées. Les permissions Chromium, notamment caméra, micro, géolocalisation et notifications, sont refusées. Les formulaires et navigations de même origine loopback peuvent fonctionner ; ils ne constituent pas une transmission vers Internet.

## Exception Google Fonts

Lorsque le projet importé référence Google Fonts, Responsiver autorise uniquement :

- les feuilles de style HTTPS de `fonts.googleapis.com` ;
- les fichiers de police HTTPS de `fonts.gstatic.com`.

Google reçoit alors l’adresse IP de la machine et les métadonnées HTTP normales de ces requêtes, notamment l’URL de police demandée. Cette exception est présente pour préserver le rendu de projets existants ; elle ne constitue ni une API de Responsiver ni un téléversement intentionnel du dossier. Les autres CDN, appels `fetch`, WebSockets et liens externes sont bloqués.

## Mises à jour

Le MVP ne vérifie pas les mises à jour automatiquement. Si cette fonction est ajoutée, elle sera désactivable et indiquera clairement qu’une requête vers GitHub peut transmettre l’adresse IP et des métadonnées HTTP. Aucun contenu de projet ne sera inclus.
