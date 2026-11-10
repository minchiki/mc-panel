<div align="center">

# MC Panel
<img width="1280" height="640" alt="github-social-preview" src="https://github.com/user-attachments/assets/50a8f7fc-42ee-4438-848c-4a1a513907da" />

**Свой хостинг Minecraft-серверов на вашем VPS. Установка одной командой, управление из браузера.**

![License](https://img.shields.io/badge/license-MIT-green)
![Ubuntu](https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04-E95420?logo=ubuntu&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-isolated%20servers-2496ED?logo=docker&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-22-5FA04E?logo=node.js&logoColor=white)

**[🚀 Установка за 10 минут: просто делайте по шагам](docs/QUICKSTART.md)**

[🌐 Сайт](https://mc-panel.space) · [📘 Инструкция со скриншотами](https://mc-panel.space/guide/) · [Подробная инструкция](docs/INSTALL.md) · [FAQ](docs/FAQ.md) · [Бот-помощник в Telegram](https://t.me/faqmcpanel_bot) · [Быстрый старт](#установка) · [Безопасность](#безопасность) · [Решения и причины](docs/DECISIONS.md)

</div>

---

Веб-панель для хостинга Minecraft-серверов на своём VPS. Каждый игровой сервер работает в отдельном Docker-контейнере со своими лимитами RAM, CPU и диска. Сама панель — сервис на Node.js за nginx.

Подойдёт, если хочется играть с друзьями на своём сервере и не разбираться в консоли Linux: поставили панель, нажали «Создать сервер», отправили друзьям адрес.

## Возможности

| | |
|---|---|
| **Ядра** | Vanilla, Paper, Purpur, Spigot (BuildTools), Fabric, Forge, NeoForge, Velocity, BungeeCord. Версии берутся из официальных API, Java 8/17/21/25 выбирается для каждого сервера отдельно |
| **Управление** | Консоль в реальном времени, файловый менеджер с редактором, форма `server.properties` с превью MOTD |
| **Плагины и моды** | Каталог Modrinth, Hangar, SpigotMC и CurseForge, установка в один клик |
| **Сборки модов** | Готовые сборки Modrinth (`.mrpack`): новый сервер из сборки или установка на существующий. Ядро, версия и Java подставляются сами, клиентские моды пропускаются, файлы проверяются по SHA-512, игрокам отдаётся та же сборка |
| **Надёжность** | Бэкапы по расписанию, планировщик задач, авто-рестарт с защитой от бесконечных падений, обновление панели без остановки серверов |
| **Игроки** | Список игроков, пинг, права оператора, белый список; базы MariaDB для плагинов |
| **Мониторинг** | Графики нагрузки, уведомления в Telegram и Discord |
| **Команда** | Роли, помощники с правами на отдельные разделы, 2FA, API-ключи, журнал действий |
| **Изоляция** | Контейнер на сервер: не root, свои лимиты, своя сеть, доступ только к своей папке |

## Для кого эта панель

MC Panel сделана **только под Minecraft** и для **новичков**: ставится одной командой, весь путь описан по шагам на русском, есть каталог плагинов и модов и [бот-помощник](https://t.me/faqmcpanel_bot).

Если вам нужна панель для десятков разных игр, несколько физических серверов под одной панелью или зрелая экосистема дополнений, посмотрите [Pterodactyl](https://pterodactyl.io/) или [Pelican](https://pelican.dev/): они мощнее и старше, но сложнее в установке.

## Установка

**Новичку:** [установка за 10 минут](docs/QUICKSTART.md) или [подробная инструкция](docs/INSTALL.md) (в ней есть отдельная часть «для продвинутых»).

**На бонусах:** сервер в облаке Сбера (Cloud.ru) на приветственные бонусы, нужна карта: [инструкция по кнопкам](docs/CLOUDRU.md).

**Быстро.** На чистой Ubuntu 22.04/24.04 (или Debian 12) от root:

```sh
curl -fsSL https://raw.githubusercontent.com/minchiki/mc-panel/main/scripts/bootstrap.sh -o bootstrap.sh
sudo bash bootstrap.sh
```

`bootstrap.sh` сам ставит Docker, Node.js 22, nginx и fail2ban, скачивает панель в `/opt/mc-panel` и запускает `scripts/install.sh`. Скрипты идемпотентные: их можно запускать повторно. `install.sh`:
- создаёт пользователя `mcpanel`, папки и `.env` с новыми секретами (существующий `.env` не трогает);
- собирает панель, ставит systemd-юниты, сайт nginx, правила fail2ban и logrotate;
- создаёт первого администратора `admin`.

Если Docker, Node.js ≥ 22.13 и nginx уже стоят, можно обойтись без bootstrap: `sudo PUBLIC_HOST=<IP-или-домен> bash /opt/mc-panel/scripts/install.sh`.

В облаке откройте в группе безопасности (файрволе) входящие TCP 80, 443 и TCP+UDP 25565–25665. Для cloud.ru см. [docs/CLOUDRU.md](docs/CLOUDRU.md).

## Первый вход

Логин и пароль администратора лежат в файле, который читает только root:

```sh
sudo cat /root/mc-panel-admin.txt
```

Откройте `http://<IP>/`, войдите и сразу смените пароль: «Аккаунт» → «Пароль». Там же включите 2FA. После этого файл можно удалить: `sudo rm /root/mc-panel-admin.txt`.

Если пароль потерян:
```sh
cd /opt/mc-panel/server && sudo -u mcpanel env $(sudo cat /etc/mc-panel/.env | xargs) node dist/cli.js reset-password admin
```

Есть также `disable-2fa <user>` и `create-admin <user>`.

## Создать сервер и подключиться

1. «Серверы» → «Создать сервер».
2. Выберите ядро (Vanilla, Paper, Fabric и др.) и версию. Java подставится автоматически.
3. Задайте память и примите EULA.
4. Установка идёт в консоли сервера и занимает около минуты. Затем нажмите «Запустить».
5. Адрес для игроков показан в карточке сервера, например `203.0.113.10` или `203.0.113.10:25566`. В Minecraft: «Сетевая игра» → «Добавить сервер».

Свой домен привязывается во вкладке «Сеть», там же инструкция по A- и SRV-записям.

---

## Для продвинутых

Всё ниже нужно, когда база уже работает: структура папок, бэкапы, обновления, HTTPS, безопасность и разработка. Полный разбор: [вторая часть инструкции](docs/INSTALL.md#часть-2-для-продвинутых).

### Где что лежит

| Путь | Что там |
|---|---|
| `/opt/mc-panel` | код панели (git) |
| `/etc/mc-panel/.env` | секреты и настройки (права 600, владелец `mcpanel`) |
| `/var/lib/mc-panel/panel.db` | база панели (SQLite) |
| `/srv/minecraft/servers/<id>/` | файлы игровых серверов |
| `/srv/minecraft/backups/<id>/` | бэкапы игровых серверов |
| `/srv/minecraft/mariadb/` | данные MariaDB (создаётся при первой базе) |
| `/var/log/mc-panel/` | `auth.log` (неудачные входы, читает fail2ban), `update.log` |
| `/var/backups/mc-panel/` | ежедневные бэкапы самой панели |

### Бэкапы

- **Игровые серверы:** вкладка «Бэкапы». Ручной бэкап создаётся кнопкой, автоматический — в «Расписание» → «Бэкап». Хранится N последних (настраивается). Восстановление и скачивание в один клик. Бэкап живого сервера делается с `save-off` / `save-all flush`.
- **Сама панель:** таймер `mc-panel-backup.timer` каждый день в 04:30 сохраняет базу, `.env` и конфиг nginx в `/var/backups/mc-panel`. Вручную: `sudo /opt/mc-panel/scripts/backup.sh`.

### Обновление панели

- **Из интерфейса:** «Настройки панели» → «Обновить панель».
- **Из консоли:** `sudo /opt/mc-panel/scripts/update.sh`.

Обновление делает бэкап панели, `git pull`, пересборку и перезапуск. Игровые серверы при этом **не останавливаются**: панель заново подключается к их контейнерам.

Откат на прошлую версию:
```sh
cd /opt/mc-panel && sudo git log --oneline       # найти нужный коммит
sudo git checkout <commit> && sudo scripts/build.sh && sudo systemctl restart mc-panel
```

### HTTPS

Когда появится домен с A-записью на IP сервера:
```sh
sudo DOMAIN=panel.example.com EMAIL=you@example.com bash /opt/mc-panel/scripts/install.sh
```

certbot получит сертификат, добавит редирект на HTTPS и автопродление (таймер `certbot.timer`), а панель включит Secure-cookies.

### Безопасность

- Пароли хранятся в argon2id. Есть 2FA (TOTP) и rate limit, неудачные входы банит fail2ban (8 попыток за 10 минут → бан на час).
- Cookie сессии: `HttpOnly` + `SameSite=Strict`. Изменяющие запросы требуют заголовок `X-Requested-With` (защита от CSRF). Строгий CSP.
- Файловый менеджер не выпускает за папку сервера: учитываются `..`, симлинки и zip-slip. Файлы, которые панель пишет сама, открываются с `O_NOFOLLOW`.
- Панель работает от `mcpanel` в песочнице systemd (`ProtectSystem=strict`, `NoNewPrivileges`). Пользователи общаются с Docker только через API панели.
- Контейнеры серверов:
  - не-root, `cap-drop ALL`, `no-new-privileges`, read-only rootfs;
  - лимиты памяти, CPU и процессов;
  - у каждого своя сеть, друг друга они не видят;
  - примонтирована только папка своего сервера.
- TOTP-секреты и пароли баз зашифрованы AES-256-GCM ключом из `.env`.

### Разработка

```sh
cd server && npm install && npm test     # юнит-тесты
cd web && npm install && npm run dev     # фронтенд с прокси на :3000
```

Стек: Fastify 5 + TypeScript + `node:sqlite` + dockerode; React 18 + Vite + Tailwind + Radix (компоненты в стиле shadcn/ui) + TanStack Query + Monaco + Recharts.
Неочевидные решения описаны в [docs/DECISIONS.md](docs/DECISIONS.md).

---

Новости и другие проекты: [HUICODING](https://t.me/huicoding).
