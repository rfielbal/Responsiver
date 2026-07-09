# Politique de confidentialité

Responsiver est conçu pour fonctionner localement.

## Ce que l’application ne fait pas

- Elle ne transmet pas le contenu des projets importés.
- Elle ne crée pas de compte utilisateur.
- Elle n’active ni télémétrie, ni analytics, ni rapport de crash externe.
- Elle n’utilise aucune API distante dans le MVP.
- Elle ne charge ni police, ni icône, ni image depuis un CDN.

## Ce qui reste sur l’ordinateur

Les chemins de projets, fichiers analysés, résultats d’audit, aperçus et rapports d’export sont traités localement. Les rapports JSON sont enregistrés uniquement à l’emplacement choisi par la personne utilisatrice.

## Aperçu statique

Pour réduire les risques liés au code importé, l’aperçu du MVP supprime les scripts et les iframes, puis bloque les ressources réseau et les soumissions de formulaires. Il ne doit pas être confondu avec l’exécution complète d’une application dynamique.

## Mises à jour

Le MVP ne vérifie pas les mises à jour automatiquement. Si cette fonction est ajoutée, elle sera désactivable et indiquera clairement qu’une requête vers GitHub peut transmettre l’adresse IP et des métadonnées HTTP. Aucun contenu de projet ne sera inclus.
