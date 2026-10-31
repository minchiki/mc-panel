import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/primitives";

export interface ChartPoint {
  ts: number;
  value: number | null;
}

/**
 * One measure per chart (never a second y-axis). Single series, so the title
 * names it and no legend is needed; the hover tooltip carries exact values.
 */
export function MetricChart({
  title,
  current,
  points,
  format,
  domain,
  timeFormat,
}: {
  title: string;
  current: string;
  points: ChartPoint[];
  format: (v: number) => string;
  domain?: [number | "auto", number | "auto"];
  timeFormat: (ts: number) => string;
}) {
  const id = `g-${title.replace(/\W/g, "")}`;
  const hasData = points.some((p) => p.value !== null);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
        <span className="text-lg font-semibold tabular-nums">{current}</span>
      </div>
      <div className="h-40">
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Нет данных за период</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={timeFormat}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                width={44}
                domain={domain ?? [0, "auto"]}
                tickFormatter={format}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
                }}
                labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("ru-RU")}
                formatter={(v) => [format(Number(v)), title]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill={`url(#${id})`}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
