# Guide des ConfigMaps

## Pourquoi séparer ConfigMaps et Secrets ?

### ConfigMaps (données publiques)
✅ Peuvent être versionnées dans Git
✅ Faciles à modifier sans redéploiement
✅ Visibles dans les logs et la configuration

**Exemples :**
- Ports de service
- Noms d'hôtes
- URLs publiques
- Configuration d'application

### Secrets (données sensibles)
🔒 Ne doivent JAMAIS être dans Git
🔒 Encodés en base64
🔒 Gérés séparément (Vault, AWS Secrets Manager, etc.)

**Exemples :**
- Mots de passe de base de données
- Clés API
- Tokens JWT
- Certificats

## Structure de notre application

```
┌─────────────────────────────────────┐
│      backend-configmap.yaml         │
│  - PORT: 5000                       │
│  - DB_HOST: postgres                │
│  - DB_PORT: 5432                    │
│  - DB_NAME: authdb                  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│      frontend-configmap.yaml        │
│  - VITE_API_URL: http://...         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│      postgres-secret.yaml           │
│  - POSTGRES_PASSWORD: ****          │
│  - JWT_SECRET: ****                 │
│  - POSTGRES_USER: ****              │
│  - POSTGRES_DB: ****                │
└─────────────────────────────────────┘
```

## Modifier une ConfigMap en production

### Option 1 : Via kubectl edit
```bash
kubectl edit configmap backend-config -n auth-app
# Modifiez les valeurs, sauvegardez
# Redémarrez les pods pour appliquer
kubectl rollout restart deployment backend -n auth-app
```

### Option 2 : Via fichier YAML
```bash
# Modifiez backend-configmap.yaml localement
kubectl apply -f backend-configmap.yaml
kubectl rollout restart deployment backend -n auth-app
```

### Option 3 : Via ligne de commande
```bash
kubectl create configmap backend-config \
  --from-literal=PORT=5000 \
  --from-literal=DB_HOST=postgres \
  --from-literal=DB_PORT=5432 \
  --from-literal=DB_NAME=authdb \
  --dry-run=client -o yaml | kubectl apply -f -
```

## URL du Backend pour le Frontend

### Problème
Le frontend React est compilé avec Vite, qui intègre `VITE_API_URL` dans le bundle JavaScript au moment du build. On ne peut pas le changer à l'exécution.

### Solutions

#### 1. Utiliser un Ingress (Recommandé)
```yaml
# Frontend et backend sur le même domaine
https://monapp.com/        → Frontend
https://monapp.com/api     → Backend
```

Le frontend utilise simplement `/api` comme URL relative :
```javascript
const API_URL = '/api';  // Pas besoin de VITE_API_URL
```

#### 2. Rebuild l'image avec la bonne URL
```bash
# Modifier frontend-configmap.yaml avec l'URL de production
# Rebuild l'image frontend avec cette URL
docker build --build-arg VITE_API_URL=https://api.monapp.com ./frontend
```

#### 3. Injection dynamique via Nginx
Créer un script qui remplace l'URL au démarrage du conteneur :
```bash
# Dans le Dockerfile du frontend
CMD ["/bin/sh", "-c", "envsubst < /config.template.js > /usr/share/nginx/html/config.js && nginx"]
```

## Ingress pour un seul point d'entrée

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: auth-app
spec:
  rules:
  - host: monapp.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: backend
            port: 5000
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port: 80
```

Avec cette configuration :
- Frontend accessible sur `https://monapp.com`
- Backend accessible sur `https://monapp.com/api`
- Pas besoin de CORS
- Même domaine, même certificat SSL

## Vérifier les ConfigMaps actives

```bash
# Lister toutes les ConfigMaps
kubectl get configmap -n auth-app

# Voir le contenu d'une ConfigMap
kubectl describe configmap backend-config -n auth-app
kubectl get configmap backend-config -n auth-app -o yaml

# Voir les variables d'environnement d'un pod
kubectl exec -it deployment/backend -n auth-app -- env | grep DB_
```

## Bonnes pratiques

1. **Nommage clair**: `<service>-config` pour les ConfigMaps
2. **Un ConfigMap par service**: Facilite la gestion
3. **Documentation**: Commentez les valeurs dans les YAML
4. **Versioning**: Gardez l'historique des changements
5. **Restart après modification**: Les pods ne reloadent pas automatiquement les ConfigMaps
