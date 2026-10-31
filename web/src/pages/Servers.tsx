import { Boxes, Cpu, MemoryStick, Plus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { PowerButtons } from "@/components/PowerButtons";
import { ServerIcon } from "@/components/ServerIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Progress, Skeleton } from "@/components/ui/primitives";
import { useServers } from "@/hooks/servers";
import { formatMb, plural } from "@/lib/format";
import type { Server } from "@/lib/types";
import { Spinner } from "@/components/Spinner";

const CORE_NAMES: Record<string, string> = {
  vanilla: "Vanilla",
  paper: "Paper",
  purpur: "Purpur",
  spigot: "Spigot",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  velocity: "Velocity",
  bungeecord: "BungeeCord",
};

export const coreName = (core: string) => CORE_NAMES[core] ?? core;

function ServerCard({ server }: { server: Server }) {
  const memPct = server.stats ? (server.stats.memMb / server.ramMb) * 100 : 0;
  const cpuPct = server.stats ? server.stats.cpu / server.cpuLimit : 0;
  const live = server.status === "online" || server.status === "starting";
  return (
    <Card className="group flex flex-col transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
      <Link to={`/servers/${server.id}`} className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
          <ServerIcon serverId={server.id} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold group-hover:text-primary">{server.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{coreName(server.core)}</Badge>
              <Badge variant="outline">{server.mcVersion}</Badge>
            </div>
          </div>
          </div>
          <StatusBadge status={server.status} />
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-sm">
          <span className="truncate">{server.address}</span>
          <CopyButton text={server.address} className="ml-auto" />
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" /> Игроки
            </div>
            <div className="font-medium tabular-nums">{live ? server.players.length : "—"}</div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="size-3.5" /> CPU
            </div>
            <div className="font-medium tabular-nums">{server.stats ? `${Math.round(cpuPct)}%` : "—"}</div>
            <Progress value={cpuPct} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MemoryStick className="size-3.5" /> RAM
            </div>
            <div className="truncate font-medium tabular-nums">{server.stats ? `${formatMb(server.stats.memMb)}` : formatMb(server.ramMb)}</div>
            <Progress value={memPct} />
          </div>
        </div>
      </Link>
      <div className="border-t px-5 py-3">
        <PowerButtons server={server} compact />
      </div>
    </Card>
  );
}

export function ServersPage() {
  useCrumbs([{ label: "Серверы" }]);
  const { data, isLoading } = useServers();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-60" />
        ))}
      </div>
    );
  }
  if (!data) return <Spinner />;

  const online = data.filter((s) => s.status === "online").length;
  const players = data.reduce((a, s) => a + s.players.length, 0);

  return (
    <>
      <PageHeader
        title="Серверы"
        description={
          data.length
            ? `${data.length} ${plural(data.length, "сервер", "сервера", "серверов")} · онлайн ${online} · ${players} ${plural(players, "игрок", "игрока", "игроков")}`
            : undefined
        }
        actions={
          <Button asChild>
            <Link to="/servers/new">
              <Plus /> Создать сервер
            </Link>
          </Button>
        }
      />
      {data.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="Пока нет ни одного сервера"
          description="Создайте первый сервер: выберите ядро (например, Paper), версию Minecraft и сколько памяти ему выделить. Установка займёт около минуты."
          action={
            <Button asChild size="lg">
              <Link to="/servers/new">
                <Plus /> Создать сервер
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </div>
      )}
    </>
  );
}
