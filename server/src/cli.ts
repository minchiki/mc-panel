import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { deleteUserSessions } from "./auth/sessions.js";
import { createUser, findByUsername, setPassword } from "./auth/users.js";
import { randomPassword } from "./lib/crypto.js";
import { run } from "./db/index.js";

/**
 * Admin CLI, run on the host:
 *   node dist/cli.js create-admin <username>   → prints a generated password once
 *   node dist/cli.js reset-password <username> → prints a new generated password
 *   node dist/cli.js disable-2fa <username>
 */
async function main(): Promise<void> {
  const [cmd, username] = process.argv.slice(2);
  if (!cmd || !username) {
    console.error("usage: cli.js <create-admin|reset-password|disable-2fa> <username>");
    process.exit(2);
  }
  openDb(config.DATA_DIR);
  if (cmd === "create-admin") {
    if (findByUsername(username)) {
      console.error(`user ${username} already exists`);
      process.exit(1);
    }
    const password = randomPassword(20);
    await createUser({ username, password, role: "admin" });
    run("UPDATE users SET max_servers = 100, max_ram_mb = 262144 WHERE username = ?", username);
    console.log(password);
  } else if (cmd === "reset-password") {
    const user = findByUsername(username);
    if (!user) throw new Error(`user ${username} not found`);
    const password = randomPassword(20);
    await setPassword(user.id, password);
    deleteUserSessions(user.id);
    console.log(password);
  } else if (cmd === "disable-2fa") {
    run("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE username = ?", username);
    console.log("ok");
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
