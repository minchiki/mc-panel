#!/usr/bin/env bash
# MC Panel installer. Idempotent: safe to re-run; never overwrites existing
# secrets, data or the admin account.
#
#   sudo PUBLIC_HOST=1.2.3.4 bash scripts/install.sh
#   sudo DOMAIN=panel.example.com EMAIL=me@example.com bash scripts/install.sh   # + HTTPS
#
# Expects the repository at /opt/mc-panel and Docker, Node.js >= 22.13, nginx installed
# (Stage 1 of the VPS setup does that).
set -euo pipefail

APP_DIR=/opt/mc-panel
DATA_DIR=/var/lib/mc-panel
LOG_DIR=/var/log/mc-panel
ETC_DIR=/etc/mc-panel
SRV_DIR=/srv/minecraft
PANEL_USER=mcpanel
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
PUBLIC_HOST="${PUBLIC_HOST:-${DOMAIN:-$(curl -fsS -m 5 https://api.ipify.org || hostname -I | awk '{print $1}')}}"
ADMIN_USER="${ADMIN_USER:-admin}"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -d "$APP_DIR/server" ] || die "$APP_DIR/server not found"
command -v docker >/dev/null || die "docker is not installed"
command -v nginx >/dev/null || die "nginx is not installed"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node.js >= 22.13 is required (node:sqlite)"

log "user $PANEL_USER"
if ! id "$PANEL_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$PANEL_USER"
fi
usermod -aG docker,systemd-journal "$PANEL_USER"
PANEL_UID=$(id -u "$PANEL_USER")
PANEL_GID=$(id -g "$PANEL_USER")

log "directories"
install -d -m 700 -o "$PANEL_USER" -g "$PANEL_USER" "$DATA_DIR"
install -d -m 750 -o "$PANEL_USER" -g "$PANEL_USER" "$LOG_DIR"
install -d -m 755 "$SRV_DIR"
for d in servers backups cache; do install -d -m 750 -o "$PANEL_USER" -g "$PANEL_USER" "$SRV_DIR/$d"; done
install -d -m 700 "$SRV_DIR/mariadb"
install -d -m 750 -o root -g "$PANEL_USER" "$ETC_DIR"

log "secrets ($ETC_DIR/.env)"
ENV_FILE="$ETC_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA_DIR
SERVERS_DIR=$SRV_DIR/servers
BACKUPS_DIR=$SRV_DIR/backups
MARIADB_DIR=$SRV_DIR/mariadb
LOG_DIR=$LOG_DIR
WEB_DIR=$APP_DIR/web/dist
PUBLIC_HOST=$PUBLIC_HOST
PORT_RANGE_START=25565
PORT_RANGE_END=25665
CONTAINER_UID=$PANEL_UID
CONTAINER_GID=$PANEL_GID
TZ=Europe/Moscow
SECRET_KEY=$(openssl rand -hex 32)
MARIADB_ROOT_PASSWORD=$(openssl rand -base64 33 | tr -d '/+=' | head -c 32)
EOF
  umask 022
fi
# Keep PUBLIC_HOST in sync when a domain is added later.
if [ -n "$DOMAIN" ]; then sed -i "s/^PUBLIC_HOST=.*/PUBLIC_HOST=$DOMAIN/" "$ENV_FILE"; fi
chown "$PANEL_USER:$PANEL_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

log "build"
"$APP_DIR/scripts/build.sh"

log "systemd units"
install -m 644 "$APP_DIR/deploy/mc-panel.service" /etc/systemd/system/mc-panel.service
install -m 644 "$APP_DIR/deploy/mc-panel-update.service" /etc/systemd/system/mc-panel-update.service
install -m 644 "$APP_DIR/deploy/mc-panel-update.path" /etc/systemd/system/mc-panel-update.path
install -m 644 "$APP_DIR/deploy/mc-panel-backup.service" /etc/systemd/system/mc-panel-backup.service
install -m 644 "$APP_DIR/deploy/mc-panel-backup.timer" /etc/systemd/system/mc-panel-backup.timer
systemctl daemon-reload
systemctl enable --now mc-panel-update.path mc-panel-backup.timer >/dev/null
systemctl enable mc-panel >/dev/null
systemctl restart mc-panel

log "nginx"
SERVER_NAME="${DOMAIN:-_}"
SITE=/etc/nginx/sites-available/mc-panel
# Don't clobber a config certbot has already extended with HTTPS.
if [ ! -f "$SITE" ] || ! grep -q "managed by Certbot" "$SITE"; then
  sed "s/__SERVER_NAME__/$SERVER_NAME/" "$APP_DIR/deploy/nginx.conf.template" > "$SITE"
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/mc-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl reload nginx

log "fail2ban + logrotate"
install -m 644 "$APP_DIR/deploy/fail2ban-filter.conf" /etc/fail2ban/filter.d/mc-panel.conf
install -m 644 "$APP_DIR/deploy/fail2ban-jail.conf" /etc/fail2ban/jail.d/mc-panel.conf
touch "$LOG_DIR/auth.log" && chown "$PANEL_USER:$PANEL_USER" "$LOG_DIR/auth.log"
systemctl restart fail2ban
install -m 644 "$APP_DIR/deploy/logrotate.conf" /etc/logrotate.d/mc-panel

if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  log "HTTPS for $DOMAIN (Let's Encrypt)"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  sed -i "s/^SECURE_COOKIES=.*//" "$ENV_FILE"; echo "SECURE_COOKIES=true" >> "$ENV_FILE"
  systemctl restart mc-panel
fi

log "waiting for the panel"
for _ in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 2 http://127.0.0.1:3000/api/health >/dev/null || die "panel did not start: journalctl -u mc-panel"

CRED_FILE=/root/mc-panel-admin.txt
if sudo -u "$PANEL_USER" sqlite3 "$DATA_DIR/panel.db" "SELECT COUNT(*) FROM users" | grep -qx 0; then
  log "first admin: $ADMIN_USER"
  PASS=$(cd "$APP_DIR/server" && sudo -u "$PANEL_USER" env $(grep -v '^#' "$ENV_FILE" | xargs) node dist/cli.js create-admin "$ADMIN_USER")
  umask 077
  printf 'MC Panel admin\nURL: http://%s/\nlogin: %s\npassword: %s\n\nChange the password after the first login.\n' \
    "$PUBLIC_HOST" "$ADMIN_USER" "$PASS" > "$CRED_FILE"
  umask 022
  log "admin credentials saved to $CRED_FILE (root only)"
fi

log "done: http://${DOMAIN:-$PUBLIC_HOST}/"
