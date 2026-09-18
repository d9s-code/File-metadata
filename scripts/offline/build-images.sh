#!/usr/bin/env bash
# Run this on a machine WITH internet access, not on the offline server.
#
# Builds the backend/frontend images and saves them into a single tar for
# transfer to the air-gapped server. Postgres isn't included — this app
# connects to an existing Postgres 18 instance already running on that
# server, so there's no database image to ship.
#
# Before running this: edit docker-compose.yml's DATABASE_URL, JWT_SECRET,
# ADMIN_PASSWORD, and the Traefik Host() rules if `prs.app` isn't your
# actual hostname. VITE_API_BASE_URL in particular is baked into the
# frontend's built JS right here — fixing it later means rebuilding, not
# just editing config on the server.
set -euo pipefail
cd "$(dirname "$0")/../.."

docker compose build backend frontend

out="rf-emitter-images.tar"
docker save rf-emitter-backend:latest rf-emitter-frontend:latest -o "$out"

echo
echo "Wrote $out ($(du -h "$out" | cut -f1))."
echo "Copy this file, plus the rest of this repo (for docker-compose.yml and"
echo "the alembic migrations baked into the image), to the offline server,"
echo "then run scripts/offline/load-images.sh there."
