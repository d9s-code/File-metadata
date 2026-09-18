#!/usr/bin/env bash
# Run this on a machine WITH internet access, not on the offline server.
#
# Builds the backend/frontend images and pulls postgres:16, then saves all
# three into a single tar for transfer to the air-gapped server. Requires
# .env at the repo root (cp .env.example .env) with VITE_API_BASE_URL and
# CORS_ORIGINS already set to the offline server's real address — Vite
# bakes VITE_API_BASE_URL into the frontend build, so getting it wrong here
# means rebuilding, not just editing .env later.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "error: .env not found at repo root. Run: cp .env.example .env, then edit it." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

docker compose build backend frontend
docker pull postgres:16

out="rf-emitter-images.tar"
docker save rf-emitter-backend:latest rf-emitter-frontend:latest postgres:16 -o "$out"

echo
echo "Wrote $out ($(du -h "$out" | cut -f1))."
echo "Copy this file, plus the rest of this repo (for docker-compose.yml,"
echo "the alembic migrations baked into the image aside, and .env), to the"
echo "offline server, then run scripts/offline/load-images.sh there."
