// Minimal valid configuration so modules importing `config` can load in tests.
process.env.SECRET_KEY ??= "0".repeat(64);
process.env.MARIADB_ROOT_PASSWORD ??= "test-password-1234567";
process.env.SERVERS_DIR ??= "/tmp/mcp-test/servers";
