#!/usr/bin/env bash
# Run this on the offline (air-gapped) server, after transferring the repo
# and rf-emitter-images.tar (produced by scripts/offline/build-images.sh)
# onto it.
#
# Loads the pre-built images into the local Docker so `docker compose up`
# never needs to build or pull anything.
set -euo pipefail
cd "$(dirname "$0")/../.."

tar_file="rf-emitter-images.tar"
if [ ! -f "$tar_file" ]; then
  echo "error: $tar_file not found next to this script's repo checkout." >&2
  echo "Copy it here from the machine that ran build-images.sh first." >&2
  exit 1
fi

docker load -i "$tar_file"

echo
echo "Images loaded. Next, if not already done:"
echo "  - Make sure the 'web' Docker network Traefik uses already exists"
echo "    here (it's external, so compose won't create it for you)."
echo "  - Make sure docker-compose.yml's DATABASE_URL points at a"
echo "    role/database that actually exists on your Postgres 18 instance,"
echo "    and that the backend joins whatever network it's reachable on."
echo "  - docker compose up -d   # do NOT pass --build: the images are"
echo "                           # already loaded locally, and building"
echo "                           # here would try to reach the internet."
