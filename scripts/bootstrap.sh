#!/usr/bin/env bash
# MC Panel bootstrap: takes a CLEAN Ubuntu 22.04/24.04 (or Debian 12) VPS to a running panel.
# Installs git, nginx, fail2ban, Docker and Node.js 22, clones the repo to /opt/mc-panel
# and runs scripts/install.sh. Idempotent: safe to run again after an interruption.
#
#   curl -fsSL https://raw.githubusercontent.com/minchiki/mc-panel/main/scripts/bootstrap.sh -o bootstrap.sh
#   sudo bash bootstrap.sh
#
# Optional settings (environment variables):
#   REPO_URL     git address of the panel          (default below)
#   BRANCH       branch to install                 (default: main)
#   PUBLIC_HOST  IP or domain shown to players     (default: detected automatically)
#   DOMAIN, EMAIL  set both to get HTTPS (Let's Encrypt); the domain must already point at this VPS
#   ADMIN_USER   first administrator's login       (default: admin)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/minchiki/mc-panel.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/mc-panel
export DEBIAN_FRONTEND=noninteractive

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите от root: sudo bash bootstrap.sh"
command -v apt-get >/dev/null || die "нужен Ubuntu или Debian (не найден apt-get)"

if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}-${VERSION_ID:-}" in
    ubuntu-22.04|ubuntu-24.04|ubuntu-26.04|debian-12|debian-13) ;;
    *) warn "система ${PRETTY_NAME:-неизвестная} не проверялась. Рекомендуем Ubuntu 22.04 или 24.04. Продолжаю через 10 секунд (Ctrl+C - отмена)"; sleep 10 ;;
  esac
fi

log "обновляю список пакетов"
apt-get update -qq

log "ставлю базовые пакеты"
PKGS="ca-certificates curl git gnupg openssl sqlite3 nginx fail2ban logrotate"
if [ -n "${DOMAIN:-}" ]; then PKGS="$PKGS certbot python3-certbot-nginx"; fi
# shellcheck disable=SC2086
apt-get install -y -qq $PKGS >/dev/null

# Building the web UI needs ~1.5 GB of memory. On small VPSes add swap so the build is not killed.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  log "мало памяти (${mem_mb} МБ), создаю файл подкачки 2 ГБ"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  log "ставлю Docker"
  if ! (curl -fsSL --retry 3 --max-time 60 https://get.docker.com | sh >/dev/null 2>&1); then
    warn "официальный установщик Docker недоступен, ставлю docker.io из репозитория системы"
    apt-get install -y -qq docker.io >/dev/null
  fi
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || die "Docker не запустился. Посмотрите: systemctl status docker"

node_ok() {
  command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'
}
if ! node_ok; then
  log "ставлю Node.js 22"
  curl -fsSL --retry 3 --max-time 60 https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 \
    || die "не удалось подключить репозиторий Node.js (deb.nodesource.com). Проверьте интернет на VPS: curl -I https://deb.nodesource.com"
  apt-get install -y -qq nodejs >/dev/null
  node_ok || die "после установки Node.js версия все ещё ниже 22.13: $(node -v 2>/dev/null || echo 'нет node')"
fi

systemctl enable --now nginx >/dev/null 2>&1 || true

log "скачиваю панель в $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" pull -q --ff-only origin "$BRANCH"
elif [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  die "папка $APP_DIR уже есть и это не копия панели. Переместите её и запустите снова"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR" \
    || die "не удалось скачать $REPO_URL. Проверьте адрес и интернет на VPS"
fi

log "запускаю установку панели (сборка занимает 2-5 минут)"
exec bash "$APP_DIR/scripts/install.sh"
