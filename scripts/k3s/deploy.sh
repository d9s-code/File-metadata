#!/usr/bin/env bash
# Run this on the k3s server, in this repo, to install the app or move it to a
# new build. It needs no internet. In order:
#
#   1. checks deploy/k8s is filled in (secret.yaml, the server's address, the TLS secret);
#   2. imports the images from the tar made by scripts/k3s/build-images.sh;
#   3. takes a backup of the database as it is (when the app is running already);
#   4. applies deploy/k8s with the new build — the backend upgrades the database
#      before it starts (all or nothing: if that fails, nothing is changed and
#      the error shows here);
#   5. waits until everything runs, and says which build that is.
#
# Usage: scripts/k3s/deploy.sh rf-emitter-images-<tag>.tar [--skip-backup]
#        scripts/k3s/deploy.sh --config-only   # apply changed settings, same build
#
# Uses "sudo k3s kubectl"; set KUBECTL=kubectl if you have your own kubeconfig.
set -euo pipefail
cd "$(dirname "$0")/../.."

KUBECTL="${KUBECTL:-sudo k3s kubectl}"
CTR="${CTR:-sudo k3s ctr}"
NS=prs
DIR=deploy/k8s

tar_file=""
skip_backup=false
config_only=false
for arg in "$@"; do
  case "$arg" in
    --skip-backup) skip_backup=true ;;
    --config-only) config_only=true ;;
    *.tar) tar_file="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if [ "$config_only" = false ] && [ -z "$tar_file" ]; then
  echo "Usage: $0 rf-emitter-images-<tag>.tar [--skip-backup]   (or --config-only)" >&2
  exit 2
fi

echo "== Checking $DIR"
problems=()
[ -f "$DIR/secret.yaml" ] || problems+=("$DIR/secret.yaml is missing — copy secret.example.yaml to it and fill it in")
if [ -f "$DIR/secret.yaml" ] && grep -v '^\s*#' "$DIR/secret.yaml" | grep -q CHANGE_ME; then
  problems+=("$DIR/secret.yaml still has CHANGE_ME values")
fi
if grep -q '^\s*- postgres-on-docker.yaml' "$DIR/kustomization.yaml" && grep -q '"192.0.2.10"' "$DIR/postgres-on-docker.yaml"; then
  problems+=("$DIR/postgres-on-docker.yaml still has the example address — put this server's IP address there")
fi
if [ ${#problems[@]} -gt 0 ]; then
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi

$KUBECTL apply -f "$DIR/namespace.yaml" >/dev/null
if ! $KUBECTL -n "$NS" get secret prs-tls >/dev/null 2>&1; then
  echo "The TLS secret prs-tls doesn't exist yet. Make it from your certificate's two files:" >&2
  echo "  $KUBECTL -n $NS create secret tls prs-tls --cert=prs.crt --key=prs.key" >&2
  exit 1
fi

if [ "$config_only" = false ]; then
  name="$(basename "$tar_file")"
  tag="${name#rf-emitter-images-}"
  tag="${tag%.tar}"
  if [ "$tag" = "$name" ] || [ -z "$tag" ]; then
    echo "Can't tell the build from the file name $name (expected rf-emitter-images-<tag>.tar)." >&2
    exit 1
  fi
  echo "== Importing the images ($tag)"
  $CTR -n k8s.io images import "$tar_file"

  running=false
  $KUBECTL -n "$NS" get deploy/backup >/dev/null 2>&1 && running=true
  if [ "$running" = true ] && [ "$skip_backup" = false ]; then
    echo "== Backing up the database first"
    if ! $KUBECTL -n "$NS" exec deploy/backup -- python scripts/backup_db.py --no-prune; then
      echo "The backup failed (see above), so nothing was changed. Fix it, or run again with --skip-backup." >&2
      exit 1
    fi
  fi

  # The build to run: both images get this tag.
  sed -i "s/^\(\s*newTag:\).*/\1 \"$tag\"/" "$DIR/kustomization.yaml"
fi

echo "== Applying $DIR"
$KUBECTL apply -k "$DIR"
if [ "$config_only" = true ]; then
  # Settings are read at start: restart what reads them.
  $KUBECTL -n "$NS" rollout restart deploy/backend deploy/backup
fi

echo "== Waiting for the backend (it upgrades the database first)"
if ! $KUBECTL -n "$NS" rollout status deploy/backend --timeout=10m; then
  echo >&2
  echo "The backend didn't start. Its database upgrade says:" >&2
  $KUBECTL -n "$NS" logs deploy/backend -c upgrade-database --tail=40 >&2 || true
  echo >&2
  echo "A failed upgrade changes nothing. To go back to the build that ran before:" >&2
  echo "  scripts/k3s/deploy.sh rf-emitter-images-<previous tag>.tar --skip-backup" >&2
  exit 1
fi
$KUBECTL -n "$NS" rollout status deploy/frontend --timeout=5m
$KUBECTL -n "$NS" rollout status deploy/backup --timeout=5m

echo "== Running build"
$KUBECTL -n "$NS" exec deploy/backend -- python -c \
  "from app.build_info import build_info; b = build_info(); print(b['commit'] or 'development build', b['built_at'] or '')"
