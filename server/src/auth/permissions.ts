export const SERVER_PERMISSIONS = [
  "console",
  "power",
  "files",
  "settings",
  "players",
  "plugins",
  "backups",
  "schedules",
  "databases",
  "network",
  "monitor",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

export function isPermission(value: string): value is ServerPermission {
  return (SERVER_PERMISSIONS as readonly string[]).includes(value);
}

export function parsePermissions(raw: string): ServerPermission[] {
  return raw.split(",").filter(isPermission);
}
