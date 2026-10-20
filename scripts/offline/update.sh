#!/usr/bin/env bash
# Run this on the offline server to move to a new build, after copying the
# repo and rf-emitter-images.tar (from scripts/offline/build-images.sh) onto
# it. It needs no change to docker-compose.yml. In order:
#
#   1. loads the new images (if the tar is here);
#   2. stops the web app, so nothing writes while the database is upgraded;
#   3. takes a backup of the database as it is, with the new image's tools;
#   4. upgrades the database on its own, so a problem shows here, plainly,
#      with nothing changed (the upgrade is all or nothing) — rather than as
#      a backend that keeps restarting;
#   5. starts everything, and says which build is running.
#
# Usage: scripts/offline/update.sh [--skip-backup]
set -euo pipefail
cd "$(dirname "$0")/../.."

skip_backup=false
[ "${1:-}" = "--skip-backup" ] && skip_backup=true

tar_file="rf-emitter-images.tar"
if [ -f "$tar_file" ]; then
  echo "== Loading the images from $tar_file"
  docker load -i "$tar_file"
else
  echo "== No $tar_file here — using the images already loaded"
fi

echo "== Stopping the web app"
docker compose stop backend frontend || true

if [ "$skip_backup" = false ]; then
  echo "== Backing up the database first"
  # --no-deps: the backup service waits for a healthy backend otherwise.
  docker compose run --rm --no-deps backup python scripts/backup_db.py --no-prune
fi

echo "== Upgrading the database"
if ! docker compose run --rm --no-deps backend alembic upgrade head; then
  echo
  echo "The upgrade failed and changed nothing (see above). The web app is left stopped."
  echo "Start the previous build again with: docker compose up -d"
  exit 1
fi

echo "== Starting everything"
docker compose up -d

echo "== Running build"
docker compose run --rm --no-deps backend python -c \
  "from app.build_info import build_info; b = build_info(); print(b['commit'] or 'development build', b['built_at'] or '')"
