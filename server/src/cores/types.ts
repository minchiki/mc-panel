export const CORES = ["vanilla", "paper", "purpur", "spigot", "fabric", "forge", "neoforge", "velocity", "bungeecord"] as const;
export type Core = (typeof CORES)[number];

export const JAVA_VERSIONS = [8, 17, 21, 25] as const;
export type JavaVersion = (typeof JAVA_VERSIONS)[number];

export interface CoreInfo {
  id: Core;
  name: string;
  description: string;
  kind: "server" | "proxy";
  /** Folder for add-ons, and which catalogue loaders apply. */
  addons: { dir: "plugins" | "mods"; modrinthLoaders: string[]; hangarPlatform?: "PAPER" | "VELOCITY"; spiget: boolean };
}

export const CORE_INFO: Record<Core, CoreInfo> = {
  vanilla: {
    id: "vanilla",
    name: "Vanilla",
    description: "Официальный сервер Mojang без модификаций",
    kind: "server",
    addons: { dir: "plugins", modrinthLoaders: [], spiget: false },
  },
  paper: {
    id: "paper",
    name: "Paper",
    description: "Быстрый сервер с плагинами Bukkit/Paper. Лучший выбор по умолчанию",
    kind: "server",
    addons: { dir: "plugins", modrinthLoaders: ["paper", "spigot", "bukkit"], hangarPlatform: "PAPER", spiget: true },
  },
  purpur: {
    id: "purpur",
    name: "Purpur",
    description: "Форк Paper с дополнительными настройками геймплея",
    kind: "server",
    addons: { dir: "plugins", modrinthLoaders: ["purpur", "paper", "spigot", "bukkit"], hangarPlatform: "PAPER", spiget: true },
  },
  spigot: {
    id: "spigot",
    name: "Spigot",
    description: "Классический сервер с плагинами. Собирается через BuildTools (5–10 минут)",
    kind: "server",
    addons: { dir: "plugins", modrinthLoaders: ["spigot", "bukkit"], spiget: true },
  },
  fabric: {
    id: "fabric",
    name: "Fabric",
    description: "Лёгкий загрузчик модов",
    kind: "server",
    addons: { dir: "mods", modrinthLoaders: ["fabric"], spiget: false },
  },
  forge: {
    id: "forge",
    name: "Forge",
    description: "Классический загрузчик модов",
    kind: "server",
    addons: { dir: "mods", modrinthLoaders: ["forge"], spiget: false },
  },
  neoforge: {
    id: "neoforge",
    name: "NeoForge",
    description: "Современный форк Forge",
    kind: "server",
    addons: { dir: "mods", modrinthLoaders: ["neoforge"], spiget: false },
  },
  velocity: {
    id: "velocity",
    name: "Velocity",
    description: "Современный прокси для объединения нескольких серверов",
    kind: "proxy",
    addons: { dir: "plugins", modrinthLoaders: ["velocity"], hangarPlatform: "VELOCITY", spiget: false },
  },
  bungeecord: {
    id: "bungeecord",
    name: "BungeeCord",
    description: "Классический прокси (всегда последняя сборка)",
    kind: "proxy",
    addons: { dir: "plugins", modrinthLoaders: ["bungeecord", "waterfall"], spiget: true },
  },
};

export function isCore(value: string): value is Core {
  return (CORES as readonly string[]).includes(value);
}

export interface VersionEntry {
  id: string;
  /** Loader/build identifier for cores that have one (Forge build, NeoForge version...). */
  build?: string;
  stable: boolean;
}

export interface InstallContext {
  serverId: string;
  dataDir: string;
  mcVersion: string;
  build?: string;
  java: number;
  log: (line: string) => void;
}

export interface InstallResult {
  /** Shell-free command template; {{XMS}}, {{XMX}}, {{FLAGS}} are substituted at start. */
  startup: string;
  build?: string;
}
