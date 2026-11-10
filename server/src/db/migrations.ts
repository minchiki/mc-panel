// Append-only list: never edit an entry that has shipped, add a new one instead.
export const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')),
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    max_servers INTEGER NOT NULL DEFAULT 3,
    max_ram_mb INTEGER NOT NULL DEFAULT 4096,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );

  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );

  CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    core TEXT NOT NULL,
    mc_version TEXT NOT NULL,
    core_build TEXT,
    java_version INTEGER NOT NULL,
    ram_mb INTEGER NOT NULL,
    cpu_limit REAL NOT NULL,
    disk_mb INTEGER NOT NULL,
    port INTEGER NOT NULL UNIQUE,
    startup TEXT NOT NULL DEFAULT '',
    jvm_flags TEXT NOT NULL DEFAULT '',
    domain TEXT,
    desired_state TEXT NOT NULL DEFAULT 'stopped',
    install_state TEXT NOT NULL DEFAULT 'pending',
    auto_restart INTEGER NOT NULL DEFAULT 1,
    rcon_password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE subusers (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    server_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_server ON audit_log(server_id, created_at);
  CREATE INDEX audit_user ON audit_log(user_id, created_at);

  CREATE TABLE backups (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE backup_settings (
    server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    max_count INTEGER NOT NULL DEFAULT 5,
    excludes TEXT NOT NULL DEFAULT 'logs\ncache\ncrash-reports'
  );

  CREATE TABLE schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    last_result TEXT
  );

  CREATE TABLE player_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    player TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    left_at INTEGER
  );
  CREATE INDEX player_sessions_server ON player_sessions(server_id, joined_at);

  CREATE TABLE metrics (
    server_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    cpu REAL,
    mem_mb REAL,
    net_rx INTEGER,
    net_tx INTEGER,
    disk_mb REAL,
    players INTEGER,
    tps REAL
  );
  CREATE INDEX metrics_server_ts ON metrics(server_id, ts);

  CREATE TABLE databases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_enc TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE mod_presets (
    server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    mods TEXT NOT NULL,
    installed_files TEXT NOT NULL DEFAULT '[]',
    auto_update INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    ip TEXT
  );
  CREATE INDEX password_resets_user ON password_resets (user_id, created_at);

  -- Reset links go only to a confirmed address; emails set before this existed count as confirmed.
  ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET email_verified = 1 WHERE email IS NOT NULL;

  CREATE TABLE email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  -- 152-FZ: when and which edition of the personal data consent a user accepted at sign-up.
  ALTER TABLE users ADD COLUMN consent_at INTEGER;
  ALTER TABLE users ADD COLUMN consent_version TEXT;
  `,
];
