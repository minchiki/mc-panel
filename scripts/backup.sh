#!/usr/bin/env bash
# Backs up the panel itself: SQLite DB (consistent online copy), secrets and
# nginx config. Game servers have their own backups in the UI.
# Keeps the newest $KEEP archives in /var/backups/mc-panel.
set -euo pipefail
DEST=/var/backups/mc-panel
KEEP="${KEEP:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

install -d -m 700 "$DEST"
sqlite3 /var/lib/mc-panel/panel.db ".backup '$TMP/panel.db'"
cp -a /etc/mc-panel/.env "$TMP/env"
[ -f /etc/nginx/sites-available/mc-panel ] && cp -a /etc/nginx/sites-available/mc-panel "$TMP/nginx-mc-panel.conf"
git -C /opt/mc-panel rev-parse HEAD > "$TMP/panel-commit" 2>/dev/null || true

umask 077
tar -czf "$DEST/mc-panel-$STAMP.tar.gz" -C "$TMP" .
ls -1t "$DEST"/mc-panel-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup: $DEST/mc-panel-$STAMP.tar.gz"
