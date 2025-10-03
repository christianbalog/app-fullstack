# PostgreSQL StatefulSet - Guide technique

## Pourquoi StatefulSet au lieu de Deployment ?

### Deployment (❌ Pour les bases de données)
- Pods interchangeables sans identité stable
- Nom de pod aléatoire (postgres-xxx-yyy)
- Volume partagé ou réaffecté aléatoirement
- Risque de corruption de données lors des redémarrages
- Pas adapté pour les applications stateful

### StatefulSet (✅ Pour les bases de données)
- ✅ Identité stable et prévisible : `postgres-0`, `postgres-1`, etc.
- ✅ Volume PersistentVolume dédié par pod
- ✅ Ordre de démarrage/arrêt garanti
- ✅ DNS stable : `postgres-0.postgres.auth-app.svc.cluster.local`
- ✅ Conçu pour les applications avec état (databases, queues, etc.)

## Caractéristiques de notre StatefulSet PostgreSQL

### 1. Identité stable
```yaml
spec:
  serviceName: postgres  # Service headless associé
  replicas: 1            # Un seul pod pour éviter les conflits
```

Le pod sera nommé : **`postgres-0`**

### 2. Volume persistant automatique
```yaml
volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      accessModes: [ReadWriteOnce]
      storageClassName: standard
      resources:
        requests:
          storage: 5Gi
```

Crée automatiquement un PVC nommé : **`postgres-storage-postgres-0`**

**Avantages :**
- Pas besoin de créer manuellement le PVC
- Volume toujours attaché au même pod
- Données persistantes même si le pod est supprimé

### 3. PGDATA correctement configuré
```yaml
env:
- name: PGDATA
  value: /var/lib/postgresql/data/pgdata
```

**Pourquoi ?** PostgreSQL ne peut pas utiliser directement `/var/lib/postgresql/data` car c'est le point de montage du volume. On crée un sous-répertoire `pgdata`.

### 4. Headless Service
```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None  # Headless
```

**Pourquoi ?** Permet d'accéder directement aux pods par leur nom DNS :
- `postgres-0.postgres.auth-app.svc.cluster.local`
- Nécessaire pour les StatefulSets avec réplication

### 5. Resource Limits
```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

**Bonnes pratiques :**
- Requests : Minimum garanti
- Limits : Maximum autorisé
- Évite que PostgreSQL consomme toutes les ressources du nœud

## DNS dans Kubernetes

### Avec notre StatefulSet

**Pod individuel :**
```
postgres-0.postgres.auth-app.svc.cluster.local
```

**Service (équilibrage de charge) :**
```
postgres.auth-app.svc.cluster.local
```

**Version courte (même namespace) :**
```
postgres-0.postgres
postgres
```

### Connexion depuis le backend

```yaml
env:
- name: DB_HOST
  value: postgres.auth-app  # OU postgres-0.postgres.auth-app
```

Les deux fonctionnent car nous avons 1 seul replica.

## Scaling (Réplication PostgreSQL)

### Configuration actuelle : 1 replica (Master seul)
```yaml
spec:
  replicas: 1
```

### Pour ajouter des replicas (Master + Replicas)

**⚠️ Nécessite une configuration avancée :**

```yaml
spec:
  replicas: 3  # 1 Master + 2 Replicas
```

**Mais il faut configurer :**
1. **Streaming replication** PostgreSQL
2. **Init containers** pour cloner les données
3. **ConfigMap** avec `postgresql.conf` et `pg_hba.conf`
4. **Scripts** pour promouvoir un replica en master
5. **Readiness/Liveness probes** adaptées

**Alternatives recommandées :**
- **CloudNativePG** (Operator Kubernetes)
- **Zalando Postgres Operator**
- **Crunchy Postgres Operator**
- **Services managés** (AWS RDS, Cloud SQL, Azure Database)

## Lifecycle du StatefulSet

### Création
```bash
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f postgres-service.yaml
```

**Ordre de création :**
1. PVC `postgres-storage-postgres-0` créé
2. Volume provisionné par le StorageClass
3. Pod `postgres-0` créé et attaché au volume
4. PostgreSQL démarre et initialise la DB

### Scaling Up (exemple : 1 → 3 replicas)
```bash
kubectl scale statefulset postgres --replicas=3 -n auth-app
```

**Ordre :**
1. `postgres-0` (déjà existant)
2. `postgres-1` créé (attend que postgres-0 soit Ready)
3. `postgres-2` créé (attend que postgres-1 soit Ready)

### Scaling Down (exemple : 3 → 1 replicas)
```bash
kubectl scale statefulset postgres --replicas=1 -n auth-app
```

**Ordre inverse :**
1. `postgres-2` supprimé (mais PVC conservé)
2. `postgres-1` supprimé (mais PVC conservé)
3. `postgres-0` reste

**⚠️ Les PVC ne sont PAS supprimés automatiquement !**

### Suppression
```bash
kubectl delete statefulset postgres -n auth-app
```

- Les pods sont supprimés
- **Les PVC restent** (protection des données)

Pour supprimer aussi les données :
```bash
kubectl delete pvc postgres-storage-postgres-0 -n auth-app
```

### Mise à jour (Rolling Update)
```bash
# Modifier l'image PostgreSQL
kubectl set image statefulset/postgres postgres=postgres:17-alpine -n auth-app

# OU éditer directement
kubectl edit statefulset postgres -n auth-app
```

**Ordre :**
1. `postgres-0` supprimé
2. Nouveau `postgres-0` créé avec nouvelle image
3. Attend que nouveau `postgres-0` soit Ready
4. Continue avec `postgres-1`, `postgres-2`, etc.

## Backup et Restore

### Backup manuel
```bash
# Se connecter au pod
kubectl exec -it postgres-0 -n auth-app -- bash

# Dump de la base
pg_dump -U postgres authdb > /tmp/backup.sql

# Copier hors du pod
kubectl cp auth-app/postgres-0:/tmp/backup.sql ./backup.sql
```

### Restore
```bash
# Copier le backup dans le pod
kubectl cp ./backup.sql auth-app/postgres-0:/tmp/backup.sql

# Restore
kubectl exec -it postgres-0 -n auth-app -- bash
psql -U postgres authdb < /tmp/backup.sql
```

### Backup automatique (recommandé)

Utilisez un CronJob Kubernetes :
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
spec:
  schedule: "0 2 * * *"  # 2h du matin chaque jour
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:16-alpine
            command:
            - /bin/sh
            - -c
            - pg_dump -h postgres.auth-app -U postgres authdb > /backup/$(date +%Y%m%d).sql
```

## Monitoring

### Vérifier l'état
```bash
# Statut du StatefulSet
kubectl get statefulset postgres -n auth-app

# Pods
kubectl get pods -l app=postgres -n auth-app

# PVC
kubectl get pvc -n auth-app

# Volumes
kubectl get pv
```

### Logs
```bash
# Logs en temps réel
kubectl logs -f postgres-0 -n auth-app

# Logs précédents (si pod redémarré)
kubectl logs postgres-0 -n auth-app --previous
```

### Se connecter à PostgreSQL
```bash
# Shell dans le pod
kubectl exec -it postgres-0 -n auth-app -- bash

# Directement dans psql
kubectl exec -it postgres-0 -n auth-app -- psql -U postgres -d authdb

# Depuis votre machine (port-forward)
kubectl port-forward postgres-0 5432:5432 -n auth-app
psql -h localhost -U postgres -d authdb
```

## Différences avec le fichier précédent

### Avant (Deployment + PVC manuel)
```yaml
kind: Deployment
volumes:
  - name: postgres-storage
    persistentVolumeClaim:
      claimName: postgres-pvc  # PVC créé séparément
```

### Après (StatefulSet + volumeClaimTemplates)
```yaml
kind: StatefulSet
volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      # PVC créé automatiquement
```

**Avantages :**
- ✅ Plus besoin de `postgres-pvc.yaml`
- ✅ PVC créé et nommé automatiquement
- ✅ Un PVC par pod (si plusieurs replicas)
- ✅ Volume toujours attaché au même pod

## Production Best Practices

1. **Utilisez un StorageClass avec backup automatique**
   ```yaml
   storageClassName: ssd-backup  # Au lieu de standard
   ```

2. **Configurez les resource limits appropriés**
   ```yaml
   resources:
     requests:
       memory: "1Gi"
       cpu: "500m"
     limits:
       memory: "2Gi"
       cpu: "1000m"
   ```

3. **Activez les backups automatiques** (CronJob ou service cloud)

4. **Utilisez des Secrets externes** (Vault, AWS Secrets Manager)

5. **Monitoring** (Prometheus + Grafana)

6. **Alerting** sur :
   - Disk usage > 80%
   - Connection count élevé
   - Slow queries

7. **Considérez un Operator PostgreSQL** pour gérer :
   - Réplication automatique
   - Failover
   - Backup/Restore
   - Monitoring

8. **Ou utilisez un service managé** :
   - AWS RDS
   - Google Cloud SQL
   - Azure Database for PostgreSQL
