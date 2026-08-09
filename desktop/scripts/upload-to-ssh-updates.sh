#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${UPDATE_SSH_HOST:-root@115.29.184.180}"
REMOTE_DIR="${UPDATE_SSH_DIR:-/var/www/kaypal-ai-content-updates}"
DIST_DIR="${DIST_DIR:-$(cd "$(dirname "$0")/.." && pwd)/dist}"
SSH_KEY="${UPDATE_SSH_KEY:-}"

if [ ! -d "$DIST_DIR" ]; then
  echo "dist directory not found: $DIST_DIR" >&2
  exit 1
fi

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(
  find "$DIST_DIR" -maxdepth 1 -type f \
    \( -name "latest*.yml" \
      -o -name "*.exe" \
      -o -name "*.dmg" \
      -o -name "*.zip" \
      -o -name "*.AppImage" \
      -o -name "*.deb" \
      -o -name "*.blockmap" \) \
    | sort
)

if [ "${#files[@]}" -eq 0 ]; then
  echo "no update artifacts found in $DIST_DIR" >&2
  exit 1
fi

echo "Uploading ${#files[@]} file(s) to ${REMOTE_HOST}:${REMOTE_DIR}/"
ssh_args=()
rsync_ssh="ssh"
if [ -n "$SSH_KEY" ]; then
  ssh_args=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
  rsync_ssh="ssh -i '$SSH_KEY' -o IdentitiesOnly=yes"
fi

ssh "${ssh_args[@]}" "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"
rsync -av --progress -e "$rsync_ssh" "${files[@]}" "${REMOTE_HOST}:${REMOTE_DIR}/"

echo ""
echo "Uploaded. Configure Nginx to serve this directory over HTTPS, then use:"
echo "  AI_CONTENT_UPDATE_URL=https://<your-domain>/updates/"
