# Guide de déploiement sans Ingress

## Architecture

```
┌─────────────────────────────────────┐
│   Navigateur Client (Internet)     │
└──────────┬──────────────┬───────────┘
           │              │
           │              │
    ┌──────▼──────┐  ┌───▼────────┐
    │  Frontend   │  │  Backend   │
    │ LoadBalancer│  │LoadBalancer│
    │  (Port 80)  │  │ (Port 5000)│
    └──────┬──────┘  └───┬────────┘
           │             │
    ┌──────▼──────┐ ┌───▼────────┐
    │  Frontend   │ │  Backend   │
    │   Pods (2)  │ │  Pods (2)  │
    └─────────────┘ └───┬────────┘
                        │
                   ┌────▼─────┐
                   │PostgreSQL│
                   │  Pod (1) │
                   └──────────┘
```

## Étape 1: Déployer l'application

```bash
cd k8s

# 1. Créer le namespace
kubectl apply -f namespace.yaml

# 2. Créer les ConfigMaps
kubectl apply -f backend-configmap.yaml
kubectl apply -f frontend-configmap.yaml

# 3. Créer les secrets
kubectl apply -f postgres-secret.yaml

# 4. Créer le PVC pour PostgreSQL
kubectl apply -f postgres-pvc.yaml

# 5. Déployer PostgreSQL
kubectl apply -f postgres-deployment.yaml
kubectl apply -f postgres-service.yaml

# 6. Attendre que PostgreSQL soit prêt
kubectl wait --for=condition=ready pod -l app=postgres -n auth-app --timeout=120s

# 7. Déployer le Backend
kubectl apply -f backend-deployment.yaml
kubectl apply -f backend-service.yaml

# 8. Déployer le Frontend
kubectl apply -f frontend-deployment.yaml
kubectl apply -f frontend-service.yaml
```

## Étape 2: Obtenir les IPs externes

```bash
# Attendre que les LoadBalancers obtiennent une IP externe
kubectl get services -n auth-app -w

# Vous devriez voir:
# NAME       TYPE           EXTERNAL-IP       PORT(S)
# backend    LoadBalancer   34.123.45.67      5000:xxxxx/TCP
# frontend   LoadBalancer   34.123.45.68      80:xxxxx/TCP
# postgres   ClusterIP      10.96.x.x         5432/TCP
```

## Étape 3: Mettre à jour la ConfigMap Frontend

**Important:** Une fois que le backend a son IP externe, vous devez mettre à jour la ConfigMap du frontend.

```bash
# Récupérer l'IP externe du backend
BACKEND_IP=$(kubectl get service backend -n auth-app -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo "Backend IP: $BACKEND_IP"

# Mettre à jour la ConfigMap
kubectl patch configmap frontend-config -n auth-app --type merge -p "{\"data\":{\"VITE_API_URL\":\"http://$BACKEND_IP:5000\"}}"

# OU manuellement:
kubectl edit configmap frontend-config -n auth-app
# Changez VITE_API_URL: http://localhost:5000
# En:      VITE_API_URL: http://34.123.45.67:5000
```

## Étape 4: Rebuild le Frontend avec la bonne URL

⚠️ **PROBLÈME:** Vite intègre `VITE_API_URL` dans le bundle au moment du build.

**Solution 1: Rebuild l'image (Recommandé)**

Dans votre pipeline GitHub Actions ou localement:

```bash
# Modifier .env ou buildArgs
docker build \
  --build-arg VITE_API_URL=http://$BACKEND_IP:5000 \
  -t israelbalog01/auth-frontend:latest \
  ./frontend

docker push israelbalog01/auth-frontend:latest

# Redéployer le frontend
kubectl rollout restart deployment frontend -n auth-app
```

**Solution 2: Modifier le code frontend**

Dans `frontend/src/App.jsx`, remplacez:
```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
```

Par:
```javascript
// Utiliser l'IP du LoadBalancer backend directement
const API_URL = 'http://34.123.45.67:5000';  // Remplacez par votre IP
```

## Étape 5: Accéder à l'application

```bash
# Obtenir l'IP du frontend
FRONTEND_IP=$(kubectl get service frontend -n auth-app -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo "Frontend accessible sur: http://$FRONTEND_IP"
```

Ouvrez `http://$FRONTEND_IP` dans votre navigateur.

## Pour Minikube (développement local)

Minikube ne supporte pas les LoadBalancers nativement.

```bash
# Terminal 1: Exposer le backend
kubectl port-forward -n auth-app service/backend 5000:5000

# Terminal 2: Exposer le frontend
kubectl port-forward -n auth-app service/frontend 8080:80

# OU utiliser minikube service
minikube service frontend -n auth-app
minikube service backend -n auth-app
```

Configurez le frontend avec:
```yaml
VITE_API_URL: http://localhost:5000
```

## Vérification

```bash
# Vérifier tous les services
kubectl get all -n auth-app

# Logs du backend
kubectl logs -f deployment/backend -n auth-app

# Logs du frontend
kubectl logs -f deployment/frontend -n auth-app

# Tester le backend directement
curl http://$BACKEND_IP:5000/health
# Devrait retourner: {"status":"OK"}

# Tester la connexion à PostgreSQL depuis le backend
kubectl exec -it deployment/backend -n auth-app -- sh
# Dans le pod:
nc -zv postgres.auth-app 5432
```

## Problèmes courants

### Backend non accessible depuis le navigateur

**Cause:** Firewall ou Security Groups bloquent le port 5000

**Solution:**
```bash
# GKE
gcloud compute firewall-rules create allow-backend \
  --allow tcp:5000 \
  --source-ranges 0.0.0.0/0

# AWS EKS - Modifier le Security Group
# Azure AKS - Modifier le Network Security Group
```

### CORS Errors

**Cause:** Le backend et frontend sont sur des domaines différents

**Solution:** Activer CORS dans le backend (déjà fait dans server.js)

### L'IP externe reste en "Pending"

**Cause:** Votre cluster n'a pas de LoadBalancer provisioner

**Solutions:**
- **Minikube:** Utilisez `minikube tunnel`
- **Cloud:** Vérifiez votre quota de LoadBalancers
- **On-premise:** Installez MetalLB

## Migration vers Ingress (Recommandé pour production)

Une fois que tout fonctionne, migrez vers Ingress pour:
- ✅ Un seul point d'entrée
- ✅ Certificat SSL/TLS
- ✅ Pas de problèmes CORS
- ✅ Économie (1 LoadBalancer au lieu de 2)

Voir `ingress.yaml` pour la configuration.
