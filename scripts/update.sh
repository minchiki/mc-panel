#!/usr/bin/env bash
# Updates MC Panel to the latest commit of its git remote and restarts it.
# Game servers keep running (they are separate containers); the panel re-attaches.
# A panel self-backup is taken first. If the build or the health check fails,
# the previous commit is rebuilt and restarted automatically.
set -euo pipefail
APP_DIR=/opt/mc-panel

healthy() {
  for _ in $(seq 1 40); do
    curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

echo "=== update started $(date -Is)"
"$APP_DIR/scripts/backup.sh"
cd "$APP_DIR"
before=$(git rev-parse HEAD)
if git remote | grep -q .; then
  git pull --ff-only
else
  echo "no git remote configured, rebuilding current checkout"
fi
after=$(git rev-parse HEAD)
echo "version: ${before:0:7} -> ${after:0:7}"

if "$APP_DIR/scripts/build.sh" && systemctl restart mc-panel && healthy; then
  echo "=== update OK (${after:0:7})"
  exit 0
fi

echo "=== update FAILED, rolling back to ${before:0:7}"
git reset --hard "$before"
if "$APP_DIR/scripts/build.sh" && systemctl restart mc-panel && healthy; then
  echo "=== rolled back to ${before:0:7}, panel is up. See the log above for the failure."
else
  echo "=== rollback failed too, see journalctl -u mc-panel"
fi
exit 1
