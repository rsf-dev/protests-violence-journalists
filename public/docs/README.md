# News City — POC sans carte mondiale

Cette version autonome conserve les six slides, les textes FR/EN, les animations,
les fonds colorés, les légendes et le highlight des catégories.

« Voir les données mondiales » ouvre directement le panneau de comparaison à droite :
totaux, légende des auteurs, graphiques des 19 pays et tri par nombre de cas ou par nom.
Le dernier parcours reste figé en arrière-plan. « Fermer » et Échap ramènent à la dernière slide.

Cliquer sur un pays ouvre son parcours et son panneau détaillé. « Revenir aux pays »
rouvre directement le panneau de comparaison. Les boutons précédent/suivant du navigateur,
le rechargement et les liens pays restent utilisables.

## Lancer

Double-cliquer sur `lanceurs/Lancer-POC.cmd`, puis ouvrir `http://127.0.0.1:4177/`.
Node.js suffit, sans installation de paquet npm. Il est également possible de servir
directement ce dossier avec un serveur HTTP, ou d’ouvrir `/POC/` depuis le serveur des sources du projet principal.

- Français : `./`
- Anglais : `./?lang=en`
- Pays : `./?country=fr`, ou `./?lang=en&country=fr`

La comparaison n’ajoute aucun paramètre à l’adresse ; son ouverture est mémorisée dans
l’historique de l’onglet. Aucun bouton de langue ni aucune fiche individuelle n’est ajouté.

## Fichiers

`index.html`, `manifestations.json` et `package.json` sont à la racine. Code dans `JS/`,
styles dans `css/`, plans, logo et police dans `assets/`, outils dans `scripts/`.
`manifestations.json` est une copie des données du site principal : 234 cas, 19 pays.

MapLibre, son worker, TopoJSON, l’atlas mondial, les styles de fond, les tuiles,
le burger et les commandes cartographiques ne sont pas inclus. La CSP autorise
uniquement les ressources locales. Le POC fonctionne sans service distant.

Après une modification, lancer `node scripts/prepare-site.mjs` depuis ce dossier
pour recalculer la version JS/CSS, l’import map et les SRI. `--check` vérifie leur fraîcheur.
Pour actualiser les données, refaire l’import dans le projet principal, copier son
`manifestations.json` ici puis préparer ce POC.

Le site principal et son dossier `export/` restent indépendants de cet essai.
