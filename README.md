# RSF Data — Template

Template GitHub pour publier un jeu de données statique sur **GitHub Pages**,
avec un sous-domaine automatique au format :

```
<nom-du-repo>.data.rsf.org
```

Par exemple, un repo nommé `presse-2024` est servi sur
`https://presse-2024.data.rsf.org`.

Aucun secret ni token API à configurer. Le déploiement est déclenché
automatiquement à chaque push sur `main`.

---

## Guide d'utilisation complet

### 1. Créer le dépôt depuis le template

Depuis [github.com/rsf-dev/rsf-data-template](https://github.com/rsf-dev/rsf-data-template) :

1. Cliquez sur **« Use this template »** → **« Create a new repository »**
2. **Owner** : `rsf-dev`
3. **Repository name** : choisissez un nom court, sans accent, en minuscules
   (le sous-domaine en découle automatiquement : `<nom>.data.rsf.org`)
4. **Visibility** : `Public` (GitHub Pages impose public pour les sites
   d'organisation)

✅ Le dépôt est créé et hérite du workflow de déploiement.

### 2. Le CNAME DNS

Chaque dataviz a besoin de **son propre enregistrement DNS**, à demander pour
chaque nouveau dépôt :

```
<nom>.data.rsf.org.  CNAME  rsf-dev.github.io.
```

Il n'y a **pas de wildcard** `*.data.rsf.org` : il permettait à n'importe quel
compte GitHub de publier sous un sous-domaine RSF (subdomain takeover). Ne
jamais en recréer un.

Quand une dataviz est supprimée (dépôt supprimé ou Pages désactivé),
**supprimez aussi son enregistrement DNS** : un CNAME qui pointe vers un Pages
non revendiqué est réutilisable par un tiers.

### 3. Remplacer le contenu

Gardez dans votre page le script `@iframe-resizer/child` présent dans
`public/index.html` : sans lui, l'iframe intégrée sur rsf.org (paragraphe
« Dataviz ») ne s'ajuste pas à la hauteur du contenu.

Supprimez le contenu exemple et placez votre site statique (HTML, CSV,
images, etc.) dans le dossier **`public/`** :

```shell
# Exemple : remplacer par votre jeu de données
# (puis recopier la balise <script> iframe-resizer dans votre index.html)
rm public/index.html public/styles.css
cp -r ~/mes-donnees/* public/
```

### 4. Pusher sur `main`

```shell
git add -A
git commit -m "feat: ajout du jeu de données"
git push origin main
```

Le workflow se lance automatiquement. Il active GitHub Pages, attache le
domaine personnalisé et déploie le site. Suivez son avancement dans
**Actions** → **Deploy to GitHub Pages**.

🟢 Une fois terminé, votre site est en ligne sur
`https://<nom-du-repo>.data.rsf.org`.

> Le certificat TLS est émis automatiquement par Let's Encrypt. Le
> premier déploiement peut prendre 1 à 5 minutes supplémentaires le
> temps que GitHub provisionne le certificat.

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `404` sur le domaine | Enregistrement DNS absent ou pas encore propagé | `dig CNAME <nom>.data.rsf.org`. Si absent, demandez sa création (étape 2). |
| L'iframe sur rsf.org a une hauteur fixe / une barre de défilement | Script `@iframe-resizer/child` absent de la page | Recopiez la balise `<script>` de `public/index.html` (étape 3). |
| Certificat pas prêt | GitHub n'a pas validé le CNAME | Attendez quelques minutes, puis **Settings → Pages → Domains → Check again**. |
| Workflow échoue | GitHub Pages pas activé sur le dépôt | **Settings → Pages → Source = GitHub Actions**. |
| `403 Forbidden` sur GitHub Pages | Dépôt en privé | Passez le dépôt en public. |

---

## Comment ça marche

Le workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
s'exécute à chaque push sur `main` :

| Étape | Action |
|---|---|
| **Compute names** | Déduit le sous-domaine et le FQDN complet (`<repo>.data.rsf.org`). |
| **Generate CNAME** | Écrit le FQDN dans `public/CNAME`. |
| **Set custom domain** | Attache automatiquement le domaine au Pages via l'API GitHub. |
| **Upload artifact** | Prépare `public/` comme artefact de déploiement. |
| **Deploy** | Publie sur GitHub Pages avec le domaine personnalisé. |

## Personnalisation

- **Dossier servi** : par défaut `public/`. Pour servir depuis la racine,
  modifiez le `path:` dans l'étape *Upload artifact*.
- **Branche de production** : `main`. À modifier dans le déclencheur du
  workflow et dans le paramètre *Build and deployment* de GitHub Pages.
- **Sous-domaine** : le pattern `<nom>.data.rsf.org` est dérivé du nom du
  repo. Modifiez l'étape *Compute names* dans le workflow pour un format
  différent.
