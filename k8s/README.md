# Kubernetes Deployment Guide

## Prérequis

- Cluster Kubernetes (Minikube, GKE, EKS, AKS, etc.)
- `kubectl` installé et configuré
- Images Docker poussées sur Docker Hub (via GitHub Actions)

## Déploiement rapide

```bash
# 1. Créer le namespace
kubectl apply -f namespace.yaml

# 2. Créer les ConfigMaps
kubectl apply -f backend-configmap.yaml
kubectl apply -f frontend-configmap.yaml

# 3. Créer les secrets
kubectl apply -f postgres-secret.yaml
# Note: Les deployments utilisent imagePullSecret "regcred"
# Assurez-vous qu'il existe déjà dans le namespace auth-app

# 4. Déployer PostgreSQL (StatefulSet avec volumeClaimTemplate)
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f postgres-service.yaml

# 5. Attendre que PostgreSQL soit prêt
kubectl wait --for=condition=ready pod -l app=postgres -n auth-app --timeout=120s

# 6. Déployer le Backend
kubectl apply -f backend-deployment.yaml
kubectl apply -f backend-service.yaml

# 7. Déployer le Frontend
kubectl apply -f frontend-deployment.yaml
kubectl apply -f frontend-service.yaml

# 8. (Optionnel) Déployer l'Ingress
kubectl apply -f ingress.yaml

# 9. Vérifier le déploiement
kubectl get all -n auth-app
```

## Déploiement tout-en-un

```bash
kubectl apply -f .
```

## Accéder à l'application

### Avec LoadBalancer (Cloud)

```bash
kubectl get service frontend -n auth-app
# Utilisez l'EXTERNAL-IP affichée
```

### Avec Minikube

```bash
minikube service frontend -n auth-app
```

### Avec Port-Forward (Développement local)

```bash
kubectl port-forward -n auth-app service/frontend 8080:80
# Accédez à http://localhost:8080
```

## Configuration

### ConfigMaps vs Secrets

**ConfigMaps** (données non-sensibles):
- `backend-configmap.yaml`: PORT, DB_HOST, DB_PORT, DB_NAME
- `frontend-configmap.yaml`: VITE_API_URL

**Secrets** (données sensibles):
- `postgres-secret.yaml`: POSTGRES_PASSWORD, JWT_SECRET, DB_USER

### Modifier les ConfigMaps

**Backend:**
```bash
kubectl edit configmap backend-config -n auth-app
```

**Frontend:**
```bash
kubectl edit configmap frontend-config -n auth-app
# Modifiez VITE_API_URL selon votre domaine
```

### Modifier les secrets

Éditez `postgres-secret.yaml` pour changer:
- `POSTGRES_PASSWORD` - Mot de passe PostgreSQL
- `JWT_SECRET` - Clé secrète JWT

**Important:** En production, utilisez des secrets cryptés avec:
```bash
kubectl create secret generic postgres-secret \
  --from-literal=POSTGRES_DB=authdb \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD=YOUR_SECURE_PASSWORD \
  --from-literal=JWT_SECRET=YOUR_JWT_SECRET \
  -n auth-app
```

### Scaling

```bash
# Scaler le backend
kubectl scale deployment backend --replicas=3 -n auth-app

# Scaler le frontend
kubectl scale deployment frontend --replicas=3 -n auth-app
```

## Architecture

```
┌─────────────────────────────────────┐
│     LoadBalancer (Frontend)         │
│          (Port 80)                  │
└──────────────┬──────────────────────┘
               │
        ┌──────▼──────┐
        │  Frontend   │ (2 replicas)
        │   Service   │
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │   Backend   │ (2 replicas)
        │   Service   │
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  PostgreSQL │ (1 replica)
        │   Service   │
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │     PVC     │ (5Gi)
        └─────────────┘
```

## Monitoring

```bash
# Logs du backend
kubectl logs -f deployment/backend -n auth-app

# Logs du frontend
kubectl logs -f deployment/frontend -n auth-app

# Logs de PostgreSQL
kubectl logs -f deployment/postgres -n auth-app

# Status des pods
kubectl get pods -n auth-app -w
```

## Dépannage

### Backend ne démarre pas

```bash
kubectl describe pod -l app=backend -n auth-app
kubectl logs -l app=backend -n auth-app
```

### PostgreSQL ne démarre pas

```bash
kubectl describe pod -l app=postgres -n auth-app
kubectl logs -l app=postgres -n auth-app
```

### Vérifier la connectivité backend → PostgreSQL

```bash
kubectl exec -it deployment/backend -n auth-app -- sh
# Dans le pod:
nc -zv postgres 5432
```

## Nettoyage

```bash
# Supprimer tout
kubectl delete namespace auth-app

# Ou supprimer individuellement
kubectl delete -f .
```

## Production

Pour la production, considérez:

1. **PostgreSQL managé** (AWS RDS, Cloud SQL, etc.) au lieu de PostgreSQL dans K8s
2. **Ingress** avec TLS pour le frontend
3. **Secrets** avec un gestionnaire de secrets (Vault, AWS Secrets Manager, etc.)
4. **Monitoring** (Prometheus, Grafana)
5. **Backup** automatique de la base de données
6. **Auto-scaling** (HPA - Horizontal Pod Autoscaler)
7. **Resource limits** pour tous les pods
