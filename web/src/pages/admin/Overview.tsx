import { useQuery } from "@tanstack/react-query";
import { Boxes, Cpu, HardDrive, MemoryStick, Server as ServerIcon, Timer, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle, Progress } from "@/components/ui/primitives";
import { useServers } from "@/hooks/servers";
import { get } from "@/lib/api";
import { formatBytes, formatDuration, formatMb } from "@/lib/format";
import { coreName } from "../Servers";

interface Overview {
  host: { hostname: string; uptimeSec: number; load: number[]; cpus: number; cpuPercent: number; memTotal: number; memFree: number; diskTotal: number; diskFree: number };
  servers: { total: number; online: number; allocatedRamMb: number; containers: number };
  users: number;
  version: string;
}

function Tile({ icon, label, value, sub, pct }: { icon: ReactNode; label: string; value: string; sub?: string; pct?: number }) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {pct !== undefined && <Progress value={pct} />}
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export default function AdminOverview() {
  useCrumbs([{ label: "Администрирование" }, { label: "Обзор VPS" }]);
  const data = useQuery({ queryKey: ["admin-overview"], queryFn: () => get<Overview>("/api/admin/overview"), refetchInterval: 10_000 });
  const servers = useServers();
  if (!data.data) return <Spinner />;
  const { host, servers: s } = data.data;
  const memUsed = host.memTotal - host.memFree;
  const diskUsed = host.diskTotal - host.diskFree;
  const ramPct = (s.allocatedRamMb * 1024 * 1024 * 100) / host.memTotal;

  return (
    <>
      <PageHeader title="Обзор VPS" description={`${host.hostname} · версия панели ${data.data.version.split("\n")[0]}`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={<Cpu />} label={`CPU · ${host.cpus} ядра`} value={`${host.cpuPercent}%`} pct={host.cpuPercent} sub={`Нагрузка: ${host.load.map((l) => l.toFixed(2)).join(" / ")}`} />
        <Tile icon={<MemoryStick />} label="Память" value={`${formatBytes(memUsed)} / ${formatBytes(host.memTotal)}`} pct={(memUsed / host.memTotal) * 100} sub={`Выделено серверам: ${formatMb(s.allocatedRamMb)} (${Math.round(ramPct)}%)`} />
        <Tile icon={<HardDrive />} label="Диск" value={`${formatBytes(diskUsed)} / ${formatBytes(host.diskTotal)}`} pct={(diskUsed / host.diskTotal) * 100} sub={`Свободно ${formatBytes(host.diskFree)}`} />
        <Tile icon={<Timer />} label="Аптайм VPS" value={formatDuration(host.uptimeSec * 1000)} sub={`Пользователей: ${data.data.users}`} />
      </div>
      {ramPct > 100 && (
        <p className="mt-4 rounded-lg bg-warning/10 p-3 text-sm text-warning">
          Серверам выделено больше памяти, чем есть у VPS. Если все запустятся одновременно, ядро начнёт убивать процессы.
        </p>
      )}

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-4" /> Все серверы · {s.online} из {s.total} онлайн
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Сервер</th>
                <th className="py-2 font-medium">Статус</th>
                <th className="hidden py-2 font-medium sm:table-cell">Ядро</th>
                <th className="py-2 font-medium">Память</th>
                <th className="hidden py-2 font-medium md:table-cell">Порт</th>
                <th className="hidden py-2 font-medium md:table-cell">Игроки</th>
              </tr>
            </thead>
            <tbody>
              {servers.data?.map((srv) => (
                <tr key={srv.id} className="border-b last:border-0">
                  <td className="py-2">
                    <Link to={`/servers/${srv.id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                      <ServerIcon className="size-4 text-muted-foreground" /> {srv.name}
                    </Link>
                  </td>
                  <td className="py-2">
                    <StatusBadge status={srv.status} />
                  </td>
                  <td className="hidden py-2 sm:table-cell">
                    {coreName(srv.core)} {srv.mcVersion}
                  </td>
                  <td className="py-2 tabular-nums">{srv.stats ? `${formatMb(srv.stats.memMb)} / ` : ""}{formatMb(srv.ramMb)}</td>
                  <td className="hidden py-2 font-mono md:table-cell">{srv.port}</td>
                  <td className="hidden py-2 md:table-cell">
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5 text-muted-foreground" /> {srv.players.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
