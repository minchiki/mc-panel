import { useQuery } from "@tanstack/react-query";
import { Clock, Gauge } from "lucide-react";
import { useState } from "react";
import { MetricChart, type ChartPoint } from "@/components/MetricChart";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { get } from "@/lib/api";
import { formatBytes, formatDuration, formatMb } from "@/lib/format";
import { useServerContext } from "./ServerLayout";

interface Point {
  ts: number;
  cpu: number | null;
  mem_mb: number | null;
  net_rx: number | null;
  net_tx: number | null;
  disk_mb: number | null;
  players: number | null;
  tps: number | null;
}

const RANGES = [
  { id: "1h", label: "Час" },
  { id: "6h", label: "6 часов" },
  { id: "24h", label: "Сутки" },
  { id: "7d", label: "Неделя" },
] as const;

/** Network counters are cumulative per container run; turn them into per-interval rates. */
function rate(points: Point[], key: "net_rx" | "net_tx"): ChartPoint[] {
  return points.map((p, i) => {
    const prev = points[i - 1];
    const a = prev?.[key];
    const b = p[key];
    if (!prev || a === null || a === undefined || b === null || b < a) return { ts: p.ts, value: null };
    return { ts: p.ts, value: (b - a) / ((p.ts - prev.ts) / 1000) };
  });
}

export default function MonitoringTab() {
  const server = useServerContext();
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1h");
  const data = useQuery({
    queryKey: ["metrics", server.id, range],
    queryFn: () => get<{ points: Point[]; tps: number | null }>(`/api/servers/${server.id}/metrics?range=${range}`),
    refetchInterval: 30_000,
  });
  const timeFormat = (ts: number) =>
    new Date(ts).toLocaleString("ru-RU", range === "7d" ? { day: "2-digit", month: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

  const points = data.data?.points ?? [];
  const series = (key: keyof Point): ChartPoint[] => points.map((p) => ({ ts: p.ts, value: p[key] as number | null }));
  const live = server.stats;
  const tps = data.data?.tps ?? server.tps;
  const supportsTps = server.core === "paper" || server.core === "purpur";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <Card className="flex items-center gap-2 px-3 py-2">
            <Clock className="size-4 text-muted-foreground" /> Аптайм:{" "}
            <span className="font-medium">{server.startedAt && server.status === "online" ? formatDuration(Date.now() - server.startedAt) : "—"}</span>
          </Card>
          <Card className="flex items-center gap-2 px-3 py-2">
            <Gauge className="size-4 text-muted-foreground" /> TPS: <span className="font-medium">{supportsTps ? (tps?.toFixed(1) ?? "—") : "только Paper/Purpur"}</span>
          </Card>
        </div>
        <div className="flex gap-1 rounded-lg border p-1" role="tablist" aria-label="Период">
          {RANGES.map((r) => (
            <Button key={r.id} size="sm" variant={range === r.id ? "secondary" : "ghost"} className="h-7" onClick={() => setRange(r.id)} role="tab" aria-selected={range === r.id}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {data.isLoading ? (
        <Spinner />
      ) : (
        <>
          {points.length === 0 && (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              Данные собираются раз в 30 секунд, пока сервер запущен. Графики заполнятся через пару минут после старта.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MetricChart title="CPU, % от лимита" current={live ? `${Math.round(live.cpu / server.cpuLimit)}%` : "—"} points={series("cpu").map((p) => ({ ...p, value: p.value === null ? null : p.value / server.cpuLimit }))} format={(v) => `${Math.round(v)}%`} domain={[0, 100]} timeFormat={timeFormat} />
            <MetricChart title="Память" current={live ? `${formatMb(live.memMb)} / ${formatMb(server.ramMb)}` : "—"} points={series("mem_mb")} format={(v) => formatMb(v)} domain={[0, server.ramMb]} timeFormat={timeFormat} />
            <MetricChart title="Игроки онлайн" current={String(server.players.length)} points={series("players")} format={(v) => String(Math.round(v))} timeFormat={timeFormat} />
            {supportsTps && <MetricChart title="TPS" current={tps?.toFixed(1) ?? "—"} points={series("tps")} format={(v) => v.toFixed(0)} domain={[0, 20]} timeFormat={timeFormat} />}
            <MetricChart title="Входящий трафик" current="" points={rate(points, "net_rx")} format={(v) => `${formatBytes(v)}/с`} timeFormat={timeFormat} />
            <MetricChart title="Исходящий трафик" current="" points={rate(points, "net_tx")} format={(v) => `${formatBytes(v)}/с`} timeFormat={timeFormat} />
            <MetricChart title="Диск" current={`${formatMb(server.diskUsedMb ?? 0)} / ${formatMb(server.diskMb)}`} points={series("disk_mb")} format={(v) => formatMb(v)} timeFormat={timeFormat} />
          </div>
        </>
      )}
    </div>
  );
}
