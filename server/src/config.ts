import { z } from "zod";

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(3000),
  DATA_DIR: z.string().default("/var/lib/mc-panel"),
  SERVERS_DIR: z.string().default("/srv/minecraft/servers"),
  BACKUPS_DIR: z.string().default("/srv/minecraft/backups"),
  MARIADB_DIR: z.string().default("/srv/minecraft/mariadb"),
  LOG_DIR: z.string().default("/var/log/mc-panel"),
  WEB_DIR: z.string().default(""),
  PUBLIC_HOST: z.string().default("127.0.0.1"),
  PORT_RANGE_START: z.coerce.number().int().default(25565),
  PORT_RANGE_END: z.coerce.number().int().default(25665),
  // 32-byte hex key used to encrypt TOTP secrets and DB passwords at rest.
  SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "SECRET_KEY must be 64 hex chars"),
  MARIADB_ROOT_PASSWORD: z.string().min(16),
  CONTAINER_UID: z.coerce.number().int().default(1000),
  CONTAINER_GID: z.coerce.number().int().default(1000),
  TZ: z.string().default("Europe/Moscow"),
  TRUST_PROXY: z.string().default("127.0.0.1"),
  SECURE_COOKIES: z.enum(["auto", "true", "false"]).default("auto"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export const config = load();
