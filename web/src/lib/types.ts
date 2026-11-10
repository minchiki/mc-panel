export type Role = "admin" | "user";

export interface User {
  id: number;
  username: string;
  email: string | null;
  /** The address is confirmed and can receive password reset links. */
  emailVerified: boolean;
  /** Address waiting for its confirmation link to be opened. */
  pendingEmail?: string | null;
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
  /** Mail is configured, so "Forgot password" and email confirmation work. */
  passwordReset: boolean;
  /** Personal data operator for the privacy policy (empty: "the panel administrator"). */
  operatorName?: string;
  operatorContact?: string;
}

/** A .mrpack uploaded to the panel and inspected (see server/src/plugins/mrpack.ts). */
export interface PackInfo {
  id: string;
  name: string;
  version: string;
  summary: string;
  core: string;
  mcVersion: string;
  build: string | null;
  java: number;
  serverFiles: number;
  clientOnlyFiles: number;
  downloadMb: number;
  overrideFiles: number;
}

export interface PackJob {
  state: "running" | "done" | "failed";
  pack: string;
  startedAt: number;
  done: number;
  total: number;
  log: string[];
  error: string | null;
}
