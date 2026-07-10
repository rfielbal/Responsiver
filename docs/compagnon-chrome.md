# Compagnon Chrome : installation, données et limites

## État fonctionnel actuel

Le flux est opérationnel lorsque ses trois éléments sont en place :

1. l’extension Chrome non empaquetée ;
2. le Native Messaging Host `fr.responsiver.desktop` enregistré pour l’identifiant exact de l’extension ;
3. Responsiver ouvert, ou démarré manuellement dans les dix minutes suivant le clic.

Le connecteur ne démarre pas Responsiver. Il valide la demande et la dépose dans une file locale privée. L’application surveille cette file, ouvre l’URL dans une session isolée et place sa fenêtre au premier plan.

Un message **Demande validée localement** confirme uniquement la validation par le host et l’écriture dans cette file. La réponse porte explicitement `desktopAcknowledged: false` : elle ne confirme ni le chargement du site, ni la réussite de son audit.

## Installation depuis le dépôt

Prérequis actuels : Chrome et Node.js 22 ou supérieur.

1. Ouvrir Responsiver avec `npm run dev`.
2. Ouvrir `chrome://extensions`.
3. Activer **Mode développeur**.
4. Cliquer sur **Charger l’extension non empaquetée** et sélectionner `extensions/chrome`.
5. Relever l’identifiant Chrome de 32 caractères affiché sur la carte de l’extension.
6. Rendre `native-host/host.mjs` exécutable sur macOS ou Linux.
7. Afficher le manifeste et les instructions adaptés sans modifier le système :

```sh
node native-host/register.mjs \
  --platform macos \
  --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --host-path /chemin/absolu/vers/native-host/host.mjs
```

8. Relancer la même commande avec `--format manifest`, créer manuellement le fichier à l’emplacement indiqué et y copier ce JSON.
9. Fermer puis rouvrir Chrome.
10. Garder Responsiver ouvert, visiter une page HTTPS publique ou un localhost HTTP(S), ouvrir l’extension et cliquer sur **Ouvrir dans Responsiver**.

Le script `register.mjs` est un dry-run : il n’écrit aucun fichier, ne modifie aucun registre et n’installe rien.

## Emplacements des paquets desktop

La construction Electron embarque les fichiers afin qu’ils restent disponibles avec l’application :

| Système | Dossier de ressources |
| --- | --- |
| macOS | `Responsiver.app/Contents/Resources/companion` |
| Windows | dossier `resources\\companion` voisin de l’exécutable |
| Linux | dossier `resources/companion` du paquet décompressé |

Le sous-dossier `chrome` peut être chargé comme extension non empaquetée. Le sous-dossier `native-host` contient le protocole, le host Node et les modèles de manifeste.

Cette présence dans le paquet n’est pas une installation automatique :

- Chrome ne charge pas lui-même l’extension ;
- aucun manifeste Native Messaging n’est copié dans le profil ;
- aucun registre Windows n’est modifié ;
- l’identifiant d’une extension non empaquetée doit être reporté dans `allowed_origins` ;
- les mises à jour ou déplacements de l’application peuvent changer le chemin du host.

### macOS

Le parcours manuel peut fonctionner avec le `host.mjs` embarqué si Node.js 22 est accessible depuis le processus Chrome. Ce n’est pas garanti avec une installation Node limitée au shell. Le paquet actuel n’embarque pas de runtime Node autonome pour ce connecteur.

### Linux

Le parcours manuel peut fonctionner avec Node.js 22. Le chemin interne d’un AppImage monté n’est pas stable : copiez d’abord `companion` dans un emplacement utilisateur fixe avant d’enregistrer le host.

### Windows

Les sources sont embarquées pour audit et développement, mais Chrome attend un exécutable natif. Aucun `.exe` autonome n’est encore produit par le packaging actuel. Le compagnon ne doit donc pas être annoncé comme installable sur Windows avant l’ajout et la signature de ce binaire.

## Données et confidentialité

Après un clic explicite, l’extension transmet localement :

- l’URL HTTPS complète, ou HTTP(S) sur loopback, y compris query string et fragment ;
- le titre de l’onglet ;
- la taille signalée par Chrome ;
- la densité de pixels de la fenêtre ;
- un UUID et une date.

Elle ne lit ni DOM, ni texte de page, ni formulaire, ni cookie, ni mot de passe, ni historique. Elle ne possède aucune permission globale sur les sites et n’injecte aucun script.

Une URL peut néanmoins contenir un jeton ou une donnée personnelle dans sa query string. L’utilisateur doit vérifier l’adresse avant de cliquer. Les identifiants HTTP intégrés à l’URL sont refusés.

Le transport extension → host ne passe pas par Internet. Après réception, Responsiver charge volontairement l’URL : cette navigation contacte directement le site et ses ressources autorisées. Le site peut donc recevoir l’adresse IP et les métadonnées HTTP normales de la requête, comme lors d’une visite dans un navigateur.

La demande attend dans le dossier de données de Responsiver :

- dossier privé `0700` et fichier `0600` sur POSIX ;
- ACL héritées du profil `%APPDATA%` sur Windows ;
- nom aléatoire ne contenant aucune partie de l’URL ;
- maximum de 128 demandes ;
- expiration après dix minutes ;
- purge au prochain écrit du host, ou suppression par l’application après traitement ou rejet, sans journal d’URL.

## Modèle de menace et limites

- `activeTab` n’est accordé qu’après le clic sur l’extension.
- `allowed_origins` limite le host à l’identifiant Chrome déclaré.
- Chaque message est encadré, limité à 64 Kio et revalidé deux fois : dans le host puis dans Electron.
- HTTPS est obligatoire pour Internet ; HTTP(S) reste limité à la boucle locale et les identifiants intégrés sont refusés.
- Le host n’exécute aucun shell, ne reçoit aucune URL dans `argv` et ne contacte aucun serveur.
- Une extension installée depuis un autre chemin peut obtenir un nouvel identifiant et sera refusée jusqu’à la mise à jour manuelle du manifeste.
- Une réponse `validated + queued` signifie « validée et écrite », jamais « chargée par le desktop » ; elle peut expirer si Responsiver n’est pas ouvert dans les dix minutes.
- Le fonctionnement actuel est adapté au développement et aux utilisateurs techniques, pas encore à une distribution Chrome Web Store grand public.

## Avant une distribution publique

Il reste à :

1. figer l’identifiant Web Store de l’extension ;
2. produire un Native Messaging Host autonome pour macOS, Windows et Linux ;
3. signer ces binaires et les associer au cycle de mise à jour desktop ;
4. créer un installateur et un désinstalleur explicites pour les manifestes utilisateur ;
5. fournir les déclarations Chrome Web Store et une politique de confidentialité publiée ;
6. tester installation, mise à jour, déplacement de l’app et désinstallation sur chaque système.

Jusqu’à cette étape, aucune documentation ne doit présenter le compagnon comme auto-installé ou capable de démarrer Responsiver seul.
