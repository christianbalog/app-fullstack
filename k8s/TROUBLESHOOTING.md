# Troubleshooting Kubernetes

## PVC Unbound - "pod has unbound immediate PersistentVolumeClaims"

### Symptômes
```
pod has unbound immediate PersistentVolumeClaims. prebound PVC not found
```

### Cause
Le `storageClassName` spécifié n'existe pas sur votre cluster ou aucune StorageClass par défaut n'est configurée.

### Diagnostic

**1. Vérifier les StorageClasses disponibles :**
```bash
kubectl get storageclass
```

Sortie typique :
```
NAME                 PROVISIONER
standard (default)   k8s.io/minikube-hostpath    # Minikube
gp2 (default)        kubernetes.io/aws-ebs       # AWS EKS
standard             kubernetes.io/gce-pd        # Google GKE
managed-premium      kubernetes.io/azure-disk    # Azure AKS
```

**2. Vérifier le PVC :**
```bash
kubectl get pvc -n auth-app
```

Statut "Pending" = problème

**3. Détails du PVC :**
```bash
kubectl describe pvc postgres-storage-postgres-0 -n auth-app
```

Regardez les "Events" pour voir l'erreur exacte.

### Solutions

#### Solution 1 : Utiliser la StorageClass par défaut

Dans `postgres-statefulset.yaml`, utilisez :
```yaml
volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      storageClassName: ""  # Vide = utilise la default
```

#### Solution 2 : Spécifier une StorageClass existante

```yaml
volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      # Remplacez par le nom exact de votre cluster
      storageClassName: standard    # Pour GKE ou Minikube
      # storageClassName: gp2       # Pour AWS EKS
      # storageClassName: managed-premium  # Pour Azure AKS
```

#### Solution 3 : Créer une StorageClass (Minikube/Kind)

Si aucune StorageClass n'existe :

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-storage
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: local-storage
  hostPath:
    path: /data/postgres
```

Puis dans le StatefulSet :
```yaml
storageClassName: local-storage
```

#### Solution 4 : Minikube - Activer l'addon storage

```bash
minikube addons enable default-storageclass
minikube addons enable storage-provisioner
```

### Après avoir corrigé

**1. Supprimer le StatefulSet (sans supprimer les PVC) :**
```bash
kubectl delete statefulset postgres -n auth-app --cascade=orphan
```

**2. Supprimer les PVC en attente :**
```bash
kubectl delete pvc postgres-storage-postgres-0 -n auth-app
```

**3. Redéployer :**
```bash
kubectl apply -f postgres-statefulset.yaml
```

**4. Vérifier :**
```bash
kubectl get pvc -n auth-app
# Statut doit être "Bound"

kubectl get pods -n auth-app
# postgres-0 doit être "Running"
```

---

## Backend/Frontend - ImagePullBackOff

### Symptômes
```
ImagePullBackOff
ErrImagePull
```

### Diagnostic
```bash
kubectl describe pod <pod-name> -n auth-app
```

### Causes et solutions

#### 1. Image n'existe pas
```
Failed to pull image "israelbalog01/auth-backend:latest": rpc error: code = NotFound
```

**Solution :** Vérifiez que l'image existe sur Docker Hub
```bash
docker pull israelbalog01/auth-backend:latest
```

Si elle n'existe pas, poussez-la :
```bash
docker push israelbalog01/auth-backend:latest
```

#### 2. Repository privé sans credentials
```
unauthorized: authentication required
```

**Solution :** Vérifiez que le secret `regcred` existe
```bash
kubectl get secret regcred -n auth-app
```

Si absent, créez-le :
```bash
kubectl create secret docker-registry regcred \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=israelbalog01 \
  --docker-password=YOUR_DOCKER_PASSWORD \
  -n auth-app
```

#### 3. Rate limit Docker Hub
```
You have reached your pull rate limit
```

**Solution :** Utilisez `regcred` avec un compte authentifié (déjà configuré dans les deployments)

---

## Backend - CrashLoopBackOff

### Symptômes
Pod redémarre en boucle

### Diagnostic
```bash
kubectl logs backend-xxx-yyy -n auth-app
kubectl logs backend-xxx-yyy -n auth-app --previous
```

### Causes fréquentes

#### 1. PostgreSQL non accessible
```
Error: connect ECONNREFUSED postgres.auth-app:5432
```

**Solution :** Vérifiez que PostgreSQL est en cours d'exécution
```bash
kubectl get pods -l app=postgres -n auth-app
kubectl logs postgres-0 -n auth-app
```

#### 2. Variables d'environnement manquantes
```
Error: DB_PASSWORD is not defined
```

**Solution :** Vérifiez les ConfigMaps et Secrets
```bash
kubectl get configmap backend-config -n auth-app -o yaml
kubectl get secret postgres-secret -n auth-app -o yaml
```

#### 3. Port déjà utilisé
```
Error: listen EADDRINUSE: address already in use :::5000
```

**Solution :** Vérifiez qu'un seul conteneur écoute sur le port 5000

---

## PostgreSQL - Pod en Pending

### Diagnostic
```bash
kubectl describe pod postgres-0 -n auth-app
```

### Causes

#### 1. Pas de nœud avec espace disque suffisant
```
0/3 nodes are available: 3 Insufficient memory, 3 Insufficient cpu
```

**Solution :** Réduisez les resource requests
```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
```

#### 2. PVC en attente (voir section PVC ci-dessus)

---

## Services - EXTERNAL-IP en <pending>

### Symptômes
```bash
kubectl get svc -n auth-app
NAME       TYPE           EXTERNAL-IP   PORT(S)
backend    LoadBalancer   <pending>     5000:xxxxx/TCP
```

### Causes et solutions

#### 1. Minikube
Minikube ne supporte pas LoadBalancer nativement.

**Solution :** Utilisez `minikube tunnel`
```bash
# Terminal 1
minikube tunnel

# Terminal 2
kubectl get svc -n auth-app
# L'EXTERNAL-IP devrait apparaître
```

**Ou utilisez NodePort :**
```yaml
type: NodePort
```

Puis accédez avec :
```bash
minikube service backend -n auth-app
```

#### 2. Cluster on-premise
Pas de LoadBalancer provisioner.

**Solution :** Installez MetalLB
```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.13.12/config/manifests/metallb-native.yaml
```

**Ou utilisez NodePort / Ingress**

#### 3. Cloud - Quota dépassé
Vérifiez votre quota de LoadBalancers sur votre provider cloud.

---

## Secrets - Permission denied

### Symptômes
```
Error from server (Forbidden): secrets "postgres-secret" is forbidden
```

### Solution
Vérifiez les permissions RBAC :
```bash
kubectl auth can-i get secrets -n auth-app
```

---

## DNS ne fonctionne pas

### Test
```bash
kubectl run -it --rm debug --image=busybox --restart=Never -n auth-app -- sh
# Dans le pod :
nslookup postgres.auth-app
nslookup backend.auth-app
```

### Solution
Vérifiez que CoreDNS fonctionne :
```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

---

## Commandes utiles de debug

```bash
# Tous les pods dans le namespace
kubectl get all -n auth-app

# Logs en temps réel
kubectl logs -f <pod-name> -n auth-app

# Shell dans un pod
kubectl exec -it <pod-name> -n auth-app -- sh

# Décrire une ressource (voir les events)
kubectl describe pod <pod-name> -n auth-app
kubectl describe pvc <pvc-name> -n auth-app
kubectl describe service <service-name> -n auth-app

# Forcer la suppression d'un pod bloqué
kubectl delete pod <pod-name> -n auth-app --force --grace-period=0

# Vérifier les events du namespace
kubectl get events -n auth-app --sort-by='.lastTimestamp'

# Redémarrer un deployment
kubectl rollout restart deployment <deployment-name> -n auth-app

# Vérifier l'état d'un rollout
kubectl rollout status deployment <deployment-name> -n auth-app
```
