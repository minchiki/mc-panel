export type Role = "admin" | "user";

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  totpEnabled: boolean;
  maxServers: number;
  maxRamMb: number;
  disabled: boolean;
  createdAt: number;
}

export type ServerStatus = "offline" | "installing" | "starting" | "online" | "stopping" | "crashed";
export type Permission =
  | "console"
  | "power"
  | "files"
  | "settings"
  | "players"
  | "plugins"
  | "backups"
  | "schedules"
  | "databases"
  | "network"
  | "monitor";

export interface LiveStats {
  cpu: number;
  memMb: number;
  memLimitMb: number;
  netRx: number;
  netTx: number;
  at: number;
}

export interface Server {
  id: string;
  name: string;
  ownerId: number;
  core: string;
  mcVersion: string;
  coreBuild: string | null;
  javaVersion: number;
  ramMb: number;
  cpuLimit: number;
  diskMb: number;
  port: number;
  domain: string | null;
  address: string;
  jvmFlags: string;
  autoRestart: boolean;
  installState: "pending" | "installing" | "installed" | "failed";
  desiredState: "running" | "stopped";
  status: ServerStatus;
  players: string[];
  stats: LiveStats | null;
  tps: number | null;
  startedAt: number | null;
  createdAt: number;
  permissions?: Permission[];
  isOwner?: boolean;
  diskUsedMb?: number;
}

export interface CoreInfo {
  id: string;
  name: string;
  description: string;
  kind: "server" | "proxy";
  addons: { dir: "plugins" | "mods" };
}

export interface VersionEntry {
  id: string;
  build?: string;
  stable: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "link";
  size: number;
  modifiedAt: number;
}

export interface AuditEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  server_id: string | null;
  action: string;
  details: string | null;
  ip: string | null;
  created_at: number;
}

export interface PublicSettings {
  registrationEnabled: boolean;
  accentColor: string;
  panelName: string;
}
