#!/usr/bin/env bash
# Builds backend and frontend in place. Used by install.sh and update.sh.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/mc-panel}"

cd "$APP_DIR/server"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent

if [ -f "$APP_DIR/web/package.json" ]; then
  cd "$APP_DIR/web"
  npm ci --no-audit --no-fund --loglevel=error
  npm run build --silent
fi

cd "$APP_DIR"
git rev-parse --short HEAD 2>/dev/null > "$APP_DIR/server/VERSION" || echo "unknown" > "$APP_DIR/server/VERSION"
date -u +%Y-%m-%dT%H:%MZ >> "$APP_DIR/server/VERSION"
