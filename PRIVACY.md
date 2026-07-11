# Politique de confidentialité

Responsiver est conçu comme une application locale-first. Il ne crée aucun compte et n’active ni télémétrie, analytics, rapport de crash distant, synchronisation, API produit cloud ou mise à jour automatique.

Cette politique distingue les traitements purement locaux des connexions déclenchées volontairement par l’utilisateur : audit d’une URL, Google Fonts et moteur IA local.

## Projets locaux et historique

Les fichiers analysés, aperçus, constats, décisions, overlays, captures et patchs restent sur l’ordinateur.

La section **Anciens projets** conserve un JSON versionné dans le dossier de données de l’application. Il contient seulement chemin canonique sélectionné, racine, entrée, nom, compteurs et dates d’analyse. Il ne contient ni code source, HTML servi, capture, thème, constat détaillé ou correctif. Chaque projet est réanalysé lors de sa réouverture.

Sur POSIX, le dossier et les fichiers sensibles créés par Responsiver utilisent des permissions privées lorsque le système le permet. Les écritures de l’historique sont atomiques et sa lecture refuse liens symboliques, fichiers surdimensionnés, corrompus ou de version inconnue.

## Previews et corrections

Les corrections déterministes et thèmes sont d’abord conservés dans des overlays en mémoire. Un export n’est écrit qu’à l’emplacement choisi explicitement et les copies complètes doivent rester hors du projet source. Sur un projet local compatible, **Valider et appliquer** constitue une autorisation explicite d’écrire uniquement la proposition comparée dans les sources. La sauvegarde permettant d’annuler cette dernière application reste en mémoire et disparaît avec la session.

L’espace Monaco utilise également des overlays en mémoire. La frappe, le diff et la prévisualisation ne modifient pas le disque. Le bouton **Appliquer au fichier** constitue en revanche une autorisation explicite d’écrire dans le fichier source après vérification de son hash et de sa version.

Les conversations avec l’assistant, captures et buffers Monaco ne sont pas persistés par Responsiver après la session.

L’inspecteur et l’Atelier conservent également leurs sélections et opérations uniquement en mémoire. Une sélection est limitée au sélecteur, à la route, à la géométrie, au rôle/libellé, à un court extrait textuel et à quelques styles calculés. Responsiver ne collecte ni HTML complet, valeurs de formulaire, cookies, stockage local, IndexedDB ou historique de navigation pour cette fonction. Une écriture ou un export n’a lieu qu’après le bouton explicite correspondant.

## Aperçu local interactif

Un projet qualifié comme exploitable est servi temporairement sur `127.0.0.1`. Le serveur est fermé au changement de projet et à la fermeture de l’application. Le stockage navigateur de la preview — cookies, stockage local, IndexedDB, service workers et cache — est alors effacé.

Les sorties externes du runner local sont bloquées, à l’exception de Google Fonts lorsqu’un projet les référence déjà :

- feuilles de style HTTPS de `fonts.googleapis.com` ;
- polices HTTPS de `fonts.gstatic.com`.

Google reçoit alors l’adresse IP et les métadonnées HTTP normales. Les autres CDN, `fetch`, WebSockets, formulaires externes, nouvelles fenêtres et permissions sensibles sont refusés dans la preview locale.

## Audit d’une URL publique ou d’un localhost

Ouvrir une URL demande à Responsiver de s’y connecter comme un navigateur. Le site et ses hôtes de ressources autorisés reçoivent donc l’adresse IP et les métadonnées HTTP normales. Le contenu de la page peut également déclencher ses propres requêtes autorisées par la politique de la session.

Le mode public exige HTTPS et une destination réseau publique. Le mode localhost accepte seulement la boucle locale. Dans les deux cas, la session Chromium possède un stockage isolé et non persistant ; permissions sensibles et téléchargements sont refusés, puis le stockage est nettoyé à la fermeture.

L’audit analyse localement le DOM, les styles, la géométrie, les erreurs runtime et une capture bornée. Responsiver n’envoie pas ces données à un service d’analyse distant. L’inspecteur intégré peut lire la sélection minimale décrite plus haut, toujours localement. Une URL publique reste en lecture seule et ne reçoit aucune feuille de correction. Associer un dossier à un localhost active l’éditeur local et la prévisualisation CSS temporaire, mais ne donne aucun accès à sa base de données.

## Assistant IA local

L’assistant est facultatif et désactivé tant qu’aucun moteur n’a été vérifié. Responsiver accepte uniquement une adresse HTTP loopback pour :

- Ollama ;
- un serveur llama.cpp compatible.

Aucun compte, clé API ou fournisseur cloud n’est intégré. Il n’existe aucun fallback distant et Responsiver ne déclenche aucun téléchargement de modèle.

Lors d’un envoi, Responsiver peut transmettre au processus local choisi :

- le prompt ;
- le nom et le type de source ;
- la route et le viewport ;
- une sélection bornée de constats ;
- une sélection bornée de fichiers texte pertinents, hors secrets et données ;
- la capture de la route lorsqu’elle est disponible.

Ces données circulent uniquement vers l’adresse loopback configurée par l’utilisateur. Elles ne sont pas persistées par Responsiver. Le moteur local reste néanmoins un logiciel distinct : il peut avoir ses propres journaux, réglages réseau ou conditions. Utilisez seulement une instance que vous contrôlez et vérifiez sa configuration.

Responsiver ne distribue pas les modèles. Leur téléchargement, stockage, licence et éventuelle télémétrie relèvent du moteur et du modèle choisis.

## Compagnon Chrome

L’extension facultative ne s’active qu’après un clic. Elle transmet localement au Native Messaging Host :

- l’URL HTTPS complète, ou HTTP(S) si elle reste sur la boucle locale, y compris query string et fragment ;
- le titre de l’onglet ;
- les dimensions signalées par Chrome et le DPR ;
- un identifiant aléatoire et une date.

Elle ne lit pas le DOM, le texte, les formulaires, cookies, mots de passe ou l’historique et ne possède aucune permission permanente sur les sites.

Une URL peut contenir un jeton ou une donnée personnelle dans sa query string. Vérifiez-la avant de cliquer. Les identifiants HTTP intégrés sont refusés.

Le host dépose la demande dans une file locale privée dont les noms ne contiennent aucune partie de l’URL. La file est bornée ; les demandes expirent après dix minutes et sont purgées avant chaque nouvel écrit, ou supprimées par l’application après traitement ou rejet, sans journal d’URL.

Le connecteur ne lance pas Responsiver. Si l’application est fermée, ouvrez-la manuellement dans les dix minutes. Le transport Chrome → host reste local, mais l’ouverture de la demande par Responsiver contacte ensuite normalement le site demandé.

## Rapports, exports et presse-papiers

Un rapport JSON ou un export est créé uniquement après choix explicite d’une destination. Le rapport omet le chemin absolu du projet et les origines temporaires de preview. Copier du code ou un patch utilise le presse-papiers système à la demande de l’utilisateur.

Responsiver ne téléverse aucun export. Le contenu reste sous la responsabilité de l’utilisateur après sa copie ou son enregistrement.

## Mises à jour et outils de développement

L’application ne vérifie pas les mises à jour automatiquement. Une future fonction devra indiquer qu’une requête vers GitHub transmet l’adresse IP et des métadonnées HTTP normales.

GitHub Actions, npm, le téléchargement d’Electron et les commandes de packaging documentées concernent le développement et la construction. Ils ne sont pas lancés par l’application installée.
