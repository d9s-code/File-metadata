# Running the app on k3s (offline server)

The same app as `docker-compose.yml` runs, as Kubernetes objects for k3s. The
images are built on a computer with internet access and carried to the server
as one file; the server needs no internet.

| Compose | Here |
|---|---|
| `backend` service | `backend.yaml`: one pod; it upgrades the database before it starts |
| `backup` service | `backup.yaml`: one pod, which waits for the backend first |
| `frontend` service | `frontend.yaml` |
| `x-backend-env` | `config.yaml` (settings) and `secret.yaml` (passwords, keys) |
| Traefik labels | `ingress.yaml` and `traefik-middlewares.yaml`, for the Traefik that comes with k3s |
| `backup_data` volume | `backups-pvc.yaml` |
| Postgres in Docker | `postgres-on-docker.yaml`: names it `postgres` inside k3s |

## What to fill in

Every value to fill in is marked `CHANGE_ME` in its file:

| File | What |
|---|---|
| `secret.yaml` (copy of `secret.example.yaml`) | Database user, password and name; `JWT_SECRET` (`openssl rand -hex 32`); the first admin's password; optional AI keys |
| `postgres-on-docker.yaml` | This server's IP address (`hostname -I`, the first one), and the port Docker publishes Postgres on if it isn't 5432 |
| `config.yaml` | Your hostname in `CORS_ORIGINS`; backup schedule; optional AI settings |
| `ingress.yaml` | Your hostname (four places), if it isn't `prs.app` |
| `scripts/k3s/build-images.sh` | `API_URL` (`https://<your hostname>/api`); `PG_CLIENT_MAJOR` if Postgres isn't 15 |
| On the server, once | The TLS secret for your certificate (step 4 below) |

`backups-pvc.yaml` asks for 20 GB for backups. Change that if yours need more.

## Can k3s reach the Postgres that runs in Docker?

Yes, through the port Docker publishes on the server, not by container name.
They're on different networks. `postgres-on-docker.yaml` turns the server's
address and that port into the name `postgres`, so `DATABASE_URL` uses host
`postgres` now and keeps it when Postgres later moves into k3s.

The Postgres container must publish its port (`docker ps` shows
`0.0.0.0:5432->5432/tcp`). Postgres and any firewall must also accept
connections from k3s's pod network, `10.42.0.0/16`. The file's comments say how.

## First install

**On your computer** (Docker and internet access):

1. Set `API_URL` in `scripts/k3s/build-images.sh` (or pass it in), then run:
   ```
   scripts/k3s/build-images.sh
   ```
   It writes `rf-emitter-images-<build>.tar`.
2. Copy that file and this repo to the server: USB stick, `scp`, or whatever works.

**On the server**, in the repo:

3. Fill in the files above. Start with:
   `cp deploy/k8s/secret.example.yaml deploy/k8s/secret.yaml`.
4. Make the TLS secret from your certificate. This is the same certificate
   Traefik uses today; IT will know where its files are:
   ```
   sudo k3s kubectl apply -f deploy/k8s/namespace.yaml
   sudo k3s kubectl -n prs create secret tls prs-tls --cert=prs.crt --key=prs.key
   ```
5. **Moving from Docker:** stop the app's own containers, so two copies never
   write to the database at once. Leave Postgres running:
   ```
   docker compose stop backend backup frontend
   ```
   Then copy the backups out of the Docker volume (`docker volume ls | grep backup_data`
   shows its name):
   ```
   mkdir -p old-backups
   docker run --rm --user 0 -v <volume name>:/from -v "$PWD/old-backups:/to" \
     --entrypoint cp rf-emitter-backend:latest -a /from/. /to/
   ```
6. Deploy:
   ```
   scripts/k3s/deploy.sh rf-emitter-images-<build>.tar
   ```
   It checks the files, imports the images, applies everything and waits
   until the app runs.
7. **Moving from Docker:** put the old backups in the new volume:
   ```
   pod=$(sudo k3s kubectl -n prs get pod -l app=backup -o name | cut -d/ -f2)
   sudo k3s kubectl -n prs cp old-backups/. "$pod":/backups/
   ```
   They then show on Admin → Backups.
8. **Traefik:** k3s's own Traefik needs ports 80 and 443. If a Traefik in
   Docker holds them today, it has to stop, or move off those ports, before
   `https://<your hostname>` reaches k3s. Agree with IT on when; other Docker
   apps behind that Traefik need moving too. Until then the app runs in k3s,
   but can't be reached from outside.

Once it works, `docker compose rm backend backup frontend` removes the old
containers. The Docker Postgres stays until it moves (see below).

## A new build

Run `scripts/k3s/build-images.sh` on your computer, copy the tar over, then on
the server:
```
scripts/k3s/deploy.sh rf-emitter-images-<build>.tar
```
It takes a backup first, then starts the new build. The backend upgrades the
database before it starts. That upgrade is all or nothing: if it fails, the
database is unchanged, and the script shows why and how to go back.

After changing only `config.yaml` or `secret.yaml`:
`scripts/k3s/deploy.sh --config-only`.

## Everyday commands

```
sudo k3s kubectl -n prs get pods                    # is everything running?
sudo k3s kubectl -n prs logs deploy/backend         # the app's log
sudo k3s kubectl -n prs logs deploy/backup          # the backup scheduler's log
sudo k3s kubectl -n prs rollout restart deploy/backend
sudo k3s kubectl -n prs exec deploy/backup -- python scripts/backup_db.py --no-prune   # a backup now
```

## Restore a backup

This overwrites the database. Stop the app first, then restore. It asks you to
type the database's name to confirm.
```
sudo k3s kubectl -n prs scale deploy/backend --replicas=0
sudo k3s kubectl -n prs exec deploy/backup -- ls /backups
sudo k3s kubectl -n prs exec -it deploy/backup -- python scripts/restore_db.py /backups/<file>.dump
sudo k3s kubectl -n prs scale deploy/backend --replicas=1
```

## Moving Postgres into k3s later

Follow the steps at the top of `optional/postgres.yaml`:
1. Ship the postgres image.
2. Fill in its user, password and database name in `secret.yaml`.
3. Swap `postgres-on-docker.yaml` for it in `kustomization.yaml`.
4. Deploy.
5. Restore your latest backup into it (above).

`DATABASE_URL` keeps host `postgres`.

## If your k3s's Traefik is older

If `traefik-middlewares.yaml` fails with `no matches for kind "Middleware" in
version "traefik.io/v1alpha1"`, change its two `apiVersion` lines to
`traefik.containo.us/v1alpha1`.
