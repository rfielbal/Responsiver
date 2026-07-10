# Native Messaging Host Responsiver

Ce dossier contient un pont Node.js minimal entre le compagnon Chrome et Responsiver. Il utilise uniquement les modules standards de Node.js et le protocole Native Messaging de Chrome : messages JSON encadrés par une longueur little-endian de 32 bits sur `stdin` et `stdout`.

## Garanties du pont

- schéma `open-url` fermé : les propriétés inconnues sont refusées ;
- messages entrants et sortants limités à 64 Kio ;
- URL limitées à HTTP(S), sans identifiants intégrés ;
- dimensions, DPR, titre, date et UUID bornés et validés ;
- aucune commande shell ;
- aucune URL placée dans `argv`, un protocole personnalisé ou une variable d’environnement ;
- aucun réseau ;
- écriture atomique d’un fichier privé `0600` dans un dossier `0700` sur POSIX ;
- file plafonnée à 128 demandes afin d’éviter une croissance illimitée ;
- seul l’identifiant Chrome déclaré dans `allowed_origins` peut appeler le host.

Sur Windows, les modes POSIX n’existent pas : le dossier est créé sous `%APPDATA%` et hérite des ACL du profil utilisateur. Le paquet desktop devra vérifier ou renforcer ces ACL lors de son installation.

## Emplacement de la file

| Plateforme | Emplacement par défaut |
| --- | --- |
| macOS | `~/Library/Application Support/Responsiver/extension-inbox` |
| Windows | `%APPDATA%\\Responsiver\\extension-inbox` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Responsiver/extension-inbox` |

`RESPONSIVER_EXTENSION_INBOX` ne sert qu’aux tests et doit contenir un chemin absolu. Le desktop et le host doivent impérativement partager la même fonction de résolution en production.

## Exécuter les tests

Node.js 22 ou supérieur :

```sh
node --test native-host/tests/*.test.mjs
```

Les tests couvrent le framing fragmenté, la limite de taille, le schéma strict, les URL interdites, l’écriture atomique et un échange complet avec le processus host. Ils n’installent rien dans Chrome.

## Préparer le manifeste sans modifier le système

Après avoir chargé `extensions/chrome`, relever son identifiant puis lancer :

```sh
node native-host/register.mjs \
  --platform macos \
  --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --host-path /chemin/absolu/vers/native-host/host.mjs
```

Le programme valide les valeurs et **affiche seulement** :

- le manifeste final ;
- son emplacement utilisateur ;
- les étapes manuelles à effectuer.

Il ne crée aucun dossier, ne copie aucun fichier et ne modifie pas le registre. Les modèles bruts sont dans `native-host/manifests`.

Pour afficher uniquement le JSON que Chrome attend, sans l’écrire :

```sh
node native-host/register.mjs \
  --platform macos \
  --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --host-path /chemin/absolu/vers/native-host/host.mjs \
  --format manifest
```

Sur macOS et Linux, `host.mjs` doit être exécutable et Node doit être disponible via `/usr/bin/env node`. Pour une distribution desktop, le host devra être empaqueté avec l’application afin de ne pas dépendre d’une installation Node utilisateur.

Sur Windows, le manifeste de production doit pointer vers un exécutable natif empaqueté, par exemple un exécutable autonome Node SEA. Il ne doit pas utiliser un fichier `.cmd`, PowerShell ou une commande contenant l’URL.

### Enregistrement utilisateur

- macOS : `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/fr.responsiver.desktop.json`
- Linux Chrome : `~/.config/google-chrome/NativeMessagingHosts/fr.responsiver.desktop.json`
- Windows : manifeste dans un emplacement privé, puis valeur par défaut de `HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\fr.responsiver.desktop`

L’entrée Windows doit contenir le chemin absolu du manifeste JSON. Une installation machine n’est pas nécessaire.

## Comportement avec l’application desktop

Responsiver consomme la file lorsqu’il est ouvert. Le consommateur desktop :

1. utilise le verrou d’instance unique de l’application ;
2. surveille `extension-inbox` sans suivre les liens symboliques ;
3. refuse les fichiers non réguliers, surdimensionnés, expirés ou de schéma inconnu ;
4. réclame atomiquement chaque demande avant de la relire ;
5. revalide l’URL et toutes les bornes dans le processus principal ;
6. ouvre une session URL isolée, puis place la fenêtre au premier plan ;
7. supprime la demande après son traitement, sans journaliser son URL.

Le host répond `delivery: "queued"` dès que l’écriture locale est terminée. Cette réponse ne signifie pas encore que la page a été chargée. Le connecteur ne lance pas l’application et ne passe jamais l’URL en argument : ouvrez Responsiver manuellement. Une demande expire après dix minutes ; si l’application est démarrée dans ce délai, elle la consomme automatiquement.

Les sources du connecteur sont incluses dans les paquets sous `resources/companion/native-host`, mais elles ne constituent pas encore un exécutable autonome destiné au grand public. macOS et Linux exigent actuellement Node.js 22 accessible par le processus Chrome. Windows exige un binaire natif qui n’est pas encore produit. Le guide du dépôt `docs/compagnon-chrome.md` détaille ces limites.

## Contrat déposé

Chaque fichier contient :

```json
{
  "schemaVersion": 1,
  "spoolId": "uuid-v4",
  "receivedAt": "date ISO-8601",
  "request": {
    "version": 1,
    "type": "open-url",
    "requestId": "uuid-v4",
    "sentAt": "date ISO-8601",
    "source": "chrome-extension",
    "payload": {
      "url": "https://example.com/route",
      "title": "Titre",
      "viewport": { "width": 1440, "height": 900 },
      "devicePixelRatio": 2
    }
  }
}
```

Le nom du fichier est généré aléatoirement et ne contient aucune partie de l’URL.
