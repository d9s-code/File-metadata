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
echo "Images loaded. Next:"
echo "  cp .env.example .env   # if not already done; fill in the secrets"
echo "  docker compose up -d   # do NOT pass --build: the images are already"
echo "                         # loaded locally, and building here would try"
echo "                         # to reach the internet and fail."
