#!/usr/bin/env bash
# Run this on a machine WITH internet access, not on the offline server.
#
# Builds the app's image (the frontend and the backend, in one) and saves it to a tar for
# transfer to the air-gapped server. Postgres isn't included — this app
# connects to an existing Postgres 15 instance already running on that
# server, so there's no database image to ship.
#
# Before running this: edit docker-compose.yml's DATABASE_URL, JWT_SECRET,
# ADMIN_PASSWORD, and the Traefik Host() rule if `prs.app` isn't your
# actual hostname (both can also be edited on the server — nothing about the
# hostname is baked into the image).
set -euo pipefail
cd "$(dirname "$0")/../.."

docker compose build app

out="rf-emitter-images.tar"
docker save rf-emitter:latest -o "$out"

echo
echo "Wrote $out ($(du -h "$out" | cut -f1))."
echo "Copy this file, plus the rest of this repo (for docker-compose.yml and"
echo "the alembic migrations baked into the image), to the offline server,"
echo "then run scripts/offline/load-images.sh there."
