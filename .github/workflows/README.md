# GitHub Actions Workflows

## Docker Build and Push Pipeline

### Configuration requise

Ajoutez ces secrets dans votre repository GitHub (Settings → Secrets and variables → Actions):

1. **DOCKER_USERNAME**: Votre nom d'utilisateur Docker Hub
2. **DOCKER_PASSWORD**: Votre token d'accès Docker Hub (ou mot de passe)

### Comment créer un token Docker Hub

1. Allez sur https://hub.docker.com/settings/security
2. Cliquez sur "New Access Token"
3. Donnez-lui un nom (ex: "github-actions")
4. Copiez le token généré
5. Ajoutez-le comme secret `DOCKER_PASSWORD` dans GitHub

### Ce que fait la pipeline

1. **Triggers**: Se déclenche sur:
   - Push sur la branche `main`
   - Pull requests vers `main`
   - Manuellement via "workflow_dispatch"

2. **Build**: Construit les images Docker pour:
   - Backend (Node.js + Express + SQLite)
   - Frontend (React + Nginx)

3. **Tags**: Crée plusieurs tags pour chaque image:
   - `latest` (seulement sur main)
   - `main-<sha>` (SHA du commit)
   - `<branch>` (nom de la branche)

4. **Push**: Pousse les images sur Docker Hub:
   - `<username>/auth-backend`
   - `<username>/auth-frontend`

5. **Cache**: Utilise le cache de registry pour accélérer les builds

### Utilisation des images

Une fois poussées, vous pouvez utiliser les images:

```bash
# Télécharger les images
docker pull <username>/auth-backend:latest
docker pull <username>/auth-frontend:latest

# Ou modifier docker-compose.yml pour utiliser les images publiées
```

### Statut du build

Le badge de status apparaîtra dans votre README après le premier build.
