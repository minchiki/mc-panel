import {
  Activity,
  Archive,
  CalendarClock,
  Cpu,
  Database,
  FolderOpen,
  HardDrive,
  MemoryStick,
  Network,
  Puzzle,
  Settings2,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { useCrumbs } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { PowerButtons } from "@/components/PowerButtons";
import { ServerIcon } from "@/components/ServerIcon";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Card, EmptyState, Progress } from "@/components/ui/primitives";
import { useServer, useServerSubscription } from "@/hooks/servers";
import { errorText } from "@/lib/api";
import { formatDuration, formatMb } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { Permission, Server } from "@/lib/types";
import { cn } from "@/lib/utils";
import { coreName } from "../Servers";

export function useServerContext(): Server {
  return useOutletContext<Server>();
}

interface TabDef {
  to: string;
  label: MessageKey;
  icon: ReactNode;
  perm: Permission | "owner";
}

function tabsFor(server: Server): TabDef[] {
  const addonLabel: MessageKey = ["fabric", "forge", "neoforge"].includes(server.core) ? "tabs.mods" : "tabs.plugins";
  const tabs: TabDef[] = [
    { to: "", label: "tabs.console", icon: <Terminal />, perm: "console" },
    { to: "files", label: "tabs.files", icon: <FolderOpen />, perm: "files" },
    { to: "addons", label: addonLabel, icon: <Puzzle />, perm: "plugins" },
    { to: "players", label: "tabs.players", icon: <Users />, perm: "players" },
    { to: "settings", label: "tabs.settings", icon: <Settings2 />, perm: "settings" },
    { to: "backups", label: "tabs.backups", icon: <Archive />, perm: "backups" },
    { to: "schedules", label: "tabs.schedules", icon: <CalendarClock />, perm: "schedules" },
    { to: "monitoring", label: "tabs.monitoring", icon: <Activity />, perm: "monitor" },
    { to: "databases", label: "tabs.databases", icon: <Database />, perm: "databases" },
    { to: "network", label: "tabs.network", icon: <Network />, perm: "network" },
    { to: "access", label: "tabs.access", icon: <ShieldCheck />, perm: "owner" },
  ];
  return tabs.filter((t) => (t.perm === "owner" ? server.isOwner : server.permissions?.includes(t.perm)));
}

function Stat({ icon, label, value, pct }: { icon: ReactNode; label: string; value: string; pct?: number }) {
  return (
    <div className="space-y-2 rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon} {label}
      </div>
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      {pct !== undefined && <Progress value={pct} />}
    </div>
  );
}

export default function ServerLayout() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { data: server, isLoading, error } = useServer(id);
  useServerSubscription(id);
  useCrumbs([{ label: "Серверы", to: "/" }, { label: server?.name ?? "…" }]);

  if (isLoading) return <Spinner />;
  if (!server) return <EmptyState icon={<TriangleAlert />} title="Сервер не найден" description={error ? errorText(error) : undefined} />;

  const live = server.status === "online" || server.status === "starting";
  const cpuPct = server.stats ? server.stats.cpu / server.cpuLimit : 0;
  const tabs = tabsFor(server);

  return (
    <div className="space-y-6">
      <Card className="beam overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
          <ServerIcon serverId={server.id} className="size-14 rounded-xl" />
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{server.name}</h1>
              <StatusBadge status={server.status} size="lg" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{coreName(server.core)}</Badge>
              <Badge variant="outline">{server.mcVersion}</Badge>
              <Badge variant="outline">Java {server.javaVersion}</Badge>
              <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-foreground">
                {server.address}
                <CopyButton text={server.address} />
              </span>
              {live && server.startedAt && <span>· работает {formatDuration(Date.now() - server.startedAt)}</span>}
            </div>
          </div>
          </div>
          <PowerButtons server={server} />
        </div>
        <div className="grid grid-cols-2 gap-3 border-t bg-muted/20 p-4 sm:grid-cols-4 sm:px-6">
          <Stat icon={<Cpu />} label="Процессор" value={server.stats ? `${Math.round(cpuPct)}%` : "—"} pct={cpuPct} />
          <Stat
            icon={<MemoryStick />}
            label="Память"
            value={server.stats ? `${formatMb(server.stats.memMb)} / ${formatMb(server.ramMb)}` : formatMb(server.ramMb)}
            pct={server.stats ? (server.stats.memMb / server.ramMb) * 100 : undefined}
          />
          <Stat icon={<Users />} label="Игроки" value={live ? String(server.players.length) : "—"} />
          <Stat
            icon={<HardDrive />}
            label="Диск"
            value={`${formatMb(server.diskUsedMb ?? 0)} / ${formatMb(server.diskMb)}`}
            pct={((server.diskUsedMb ?? 0) / server.diskMb) * 100}
          />
        </div>
      </Card>

      {server.installState === "failed" && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Установка не удалась</p>
            <p className="text-muted-foreground">Причина есть в консоли. Переустановить ядро можно в «Настройки» → «Ядро и версия».</p>
          </div>
        </div>
      )}

      <nav className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" aria-label="Разделы сервера">
        <div className="flex min-w-max gap-1 border-b">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === ""}
              className={({ isActive }) =>
                cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors [&_svg]:size-4",
                  isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {tab.icon}
              {t(tab.label)}
            </NavLink>
          ))}
        </div>
      </nav>

      <Outlet context={server} />
    </div>
  );
}
