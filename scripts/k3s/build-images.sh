#!/usr/bin/env bash
# Run this on YOUR computer (one with Docker and internet access), not on the
# server. It builds the app's two images and saves them into one file to carry
# to the k3s server, where scripts/k3s/deploy.sh imports and runs them.
#
#   scripts/k3s/build-images.sh
#
# Settings — change them here, or pass them in front of the command, e.g.
#   API_URL=https://prs.example.org/api scripts/k3s/build-images.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

# CHANGE_ME if your hostname isn't prs.app: the address the browser uses for the
# API — https://<your hostname>/api, as in deploy/k8s/ingress.yaml. It's built
# into the web pages here, so changing it later means building again.
API_URL="${API_URL:-https://prs.app/api}"

# The major version of your Postgres server (SELECT version();). The backup
# tools in the image must be at least that version.
PG_CLIENT_MAJOR="${PG_CLIENT_MAJOR:-15}"

# The server's processor type: linux/amd64 for almost every server, linux/arm64
# for an ARM one. Matters when your computer is different (e.g. an Apple Silicon Mac).
PLATFORM="${PLATFORM:-linux/amd64}"

# true: also put the postgres image in the file, for deploy/k8s/optional/postgres.yaml
# (only once Postgres moves into k3s). Keep the version your data is from.
INCLUDE_POSTGRES="${INCLUDE_POSTGRES:-false}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:15}"

# The tag: the commit it's built from, so the app (Admin, Help) and k3s both
# say which build runs. Local edits to the app mark it "-changes" (your
# settings in deploy/k8s and docker-compose.yml don't count).
tag="$(git rev-parse --short HEAD 2>/dev/null || echo build-$(date -u +%Y%m%d%H%M))"
if [ -n "$(git status --porcelain --untracked-files=no -- . ':!deploy/k8s' ':!docker-compose.yml' 2>/dev/null)" ]; then tag="$tag-changes"; fi
printf '{"commit": "%s", "built_at": "%s"}\n' "$tag" "$(date -u +%Y-%m-%dT%H:%MZ)" > backend/app/build_info.json

echo "== Building $tag for $PLATFORM (API at $API_URL, Postgres tools $PG_CLIENT_MAJOR)"
docker build --platform "$PLATFORM" --build-arg PG_CLIENT_MAJOR="$PG_CLIENT_MAJOR" \
  -t "rf-emitter-backend:$tag" backend
docker build --platform "$PLATFORM" --build-arg VITE_API_BASE_URL="$API_URL" \
  -t "rf-emitter-frontend:$tag" frontend

images=("rf-emitter-backend:$tag" "rf-emitter-frontend:$tag")
if [ "$INCLUDE_POSTGRES" = true ]; then
  echo "== Adding $POSTGRES_IMAGE"
  docker pull --platform "$PLATFORM" "$POSTGRES_IMAGE"
  images+=("$POSTGRES_IMAGE")
fi

out="rf-emitter-images-$tag.tar"
docker save "${images[@]}" -o "$out"

echo
echo "Wrote $out ($(du -h "$out" | cut -f1)) — build $tag."
echo "Copy it and this repo (for deploy/k8s and the scripts) to the server, then there:"
echo "  scripts/k3s/deploy.sh $out"
