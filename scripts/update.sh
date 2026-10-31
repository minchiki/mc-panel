#!/usr/bin/env bash
# Updates MC Panel to the latest commit of its git remote and restarts it.
# Game servers keep running (they are separate containers); the panel re-attaches.
# A panel self-backup is taken first, so `git checkout <old>` + build.sh rolls back.
set -euo pipefail
APP_DIR=/opt/mc-panel

echo "=== update started $(date -Is)"
"$APP_DIR/scripts/backup.sh"
cd "$APP_DIR"
before=$(git rev-parse --short HEAD)
if git remote | grep -q .; then
  git pull --ff-only
else
  echo "no git remote configured, rebuilding current checkout"
fi
after=$(git rev-parse --short HEAD)
echo "version: $before -> $after"
"$APP_DIR/scripts/build.sh"
systemctl restart mc-panel
for _ in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null && echo "=== update OK ($after)" || { echo "=== panel failed to start, see journalctl -u mc-panel"; exit 1; }
