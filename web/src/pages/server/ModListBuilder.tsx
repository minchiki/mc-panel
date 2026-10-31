import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Loader2, Monitor, Package, RefreshCw, Search, Server as ServerIcon, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch, Tooltip } from "@/components/ui/overlays";
import { Badge, CollapsibleCard, Select, Textarea } from "@/components/ui/primitives";
import { errorText, get, post } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";

type Side = "required" | "optional" | "unsupported" | "unknown";
interface ModMatch {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  clientSide: Side;
  serverSide: Side;
}
interface ResolveRow {
  query: string;
  match: ModMatch | null;
  alternatives: ModMatch[];
}
interface BuildJob {
  state: "running" | "done" | "failed";
  log: string[];
  mods: { title: string; file: string; version: string; onServer: boolean; onClient: boolean; dependencyOf: string | null }[];
  problems: string[];
  error: string | null;
}
interface Preset {
  mods: { id: string; title: string }[];
  autoUpdate: boolean;
  updatedAt: number;
}
interface JobResponse {
  job: BuildJob | null;
  zip: { size: number; mtime: number } | null;
  preset: Preset | null;
}

function SideBadges({ m }: { m: ModMatch }) {
  const server = m.serverSide !== "unsupported";
  const client = m.clientSide !== "unsupported";
  return (
    <span className="flex gap-1">
      {server && (
        <Tooltip content="Ставится на сервер">
          <Badge variant="secondary" className="gap-1 px-1.5">
            <ServerIcon className="size-3" />
          </Badge>
        </Tooltip>
      )}
      {client && (
        <Tooltip content="Нужен игрокам — попадёт в zip">
          <Badge variant="secondary" className="gap-1 px-1.5">
            <Monitor className="size-3" />
          </Badge>
        </Tooltip>
      )}
    </span>
  );
}

export function ModListBuilder({ server }: { server: Server }) {
  const qc = useQueryClient();
  const base = `/api/servers/${server.id}/modlist`;
  const [text, setText] = useState("");
  const [rows, setRows] = useState<(ResolveRow & { chosen: string | null })[] | null>(null);
  const [resolving, setResolving] = useState(false);
  const status = useQuery({
    queryKey: ["modlist", server.id],
    queryFn: () => get<JobResponse>(`${base}/job`),
    refetchInterval: (q) => (q.state.data?.job?.state === "running" ? 1500 : false),
  });
  const job = status.data?.job ?? null;
  const preset = status.data?.preset ?? null;
  const running = job?.state === "running";

  useEffect(() => {
    if (job?.state === "done") void qc.invalidateQueries({ queryKey: ["addons", server.id] });
  }, [job?.state, qc, server.id]);

  const resolve = async () => {
    setResolving(true);
    try {
      const res = await post<{ rows: ResolveRow[] }>(`${base}/resolve`, { text });
      setRows(res.rows.map((r) => ({ ...r, chosen: r.match?.id ?? null })));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setResolving(false);
    }
  };

  const build = async (ids: string[]) => {
    try {
      await post(`${base}/build`, { projectIds: ids });
      setRows(null);
      await status.refetch();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const rebuild = async () => {
    try {
      await post(`${base}/rebuild`);
      await status.refetch();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const toggleAuto = async (v: boolean) => {
    await post(`${base}/preset`, { autoUpdate: v }).catch((err) => toast.error(errorText(err)));
    await status.refetch();
  };

  const chosenIds = (rows ?? []).map((r) => r.chosen).filter((x): x is string => Boolean(x));
  const allOptions = (r: ResolveRow) => [r.match, ...r.alternatives].filter((m): m is ModMatch => Boolean(m));

  const summary = running ? (
    <Badge variant="secondary" className="gap-1">
      <Loader2 className="size-3 animate-spin" /> собирается
    </Badge>
  ) : preset?.mods.length ? (
    <Badge variant="outline">пресет: {preset.mods.length}</Badge>
  ) : null;

  return (
    <CollapsibleCard
      title={
        <>
          <Wand2 className="size-4 text-primary" /> Сборка по списку
        </>
      }
      description={
        <>
          Напишите названия модов — панель найдёт их под {server.core} {server.mcVersion}, докачает зависимости, поставит серверные на сервер и соберёт
          zip для игроков. Список сохраняется как пресет: при смене версии в «Настройках» моды скачаются заново под новую версию.
        </>
      }
      aside={summary}
    >
        {preset && preset.mods.length > 0 && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Пресет: {preset.mods.length} модов · обновлён {formatDate(preset.updatedAt)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={preset.autoUpdate} onCheckedChange={(v) => void toggleAuto(v)} /> Обновлять при смене версии
                </label>
                <Button size="sm" variant="outline" onClick={() => void rebuild()} disabled={running}>
                  <RefreshCw /> Пересобрать
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setText(preset.mods.map((m) => m.title).join("\n"))}>
                  Изменить список
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {preset.mods.map((m) => (
                <Badge key={m.id} variant="outline">
                  {m.title}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {status.isSuccess && !preset?.mods.length && !running && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Пресет пока не создан.</span> Впишите моды ниже и нажмите «Найти моды» → «Собрать» — список
            сохранится здесь как пресет и будет сам перекачиваться при смене версии сервера.
          </p>
        )}

        {status.data?.zip && !running && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            <Package className="size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Моды для игроков готовы</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(status.data.zip.size)} · {formatDate(status.data.zip.mtime)} · распаковать в папку игры, внутри есть инструкция
              </p>
            </div>
            <Button asChild size="sm">
              <a href={`${base}/client.zip`}>
                <Download /> Скачать zip
              </a>
            </Button>
          </div>
        )}

        {!rows && !running && (
          <>
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Create\nJEI\nJourneyMap\nIron Chests\nWaystones"}
              className="font-mono text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">По одному в строке или через запятую. Поиск по Modrinth.</span>
              <Button onClick={() => void resolve()} loading={resolving} disabled={!text.trim()}>
                <Search /> Найти моды
              </Button>
            </div>
          </>
        )}

        {rows && (
          <div className="space-y-3">
            <ul className="divide-y rounded-lg border">
              {rows.map((r, i) => {
                const options = allOptions(r);
                const chosen = options.find((o) => o.id === r.chosen) ?? null;
                return (
                  <li key={r.query} className={cn("flex flex-wrap items-center gap-3 p-2.5", !chosen && "opacity-60")}>
                    {chosen?.icon ? (
                      <img src={chosen.icon} alt="" className="size-8 rounded-md bg-muted object-cover" />
                    ) : (
                      <span className={cn("flex size-8 items-center justify-center rounded-md", options.length ? "bg-muted" : "bg-destructive/15 text-destructive")}>
                        {options.length ? <Package className="size-4" /> : <AlertTriangle className="size-4" />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-muted-foreground">«{r.query}»</p>
                      {options.length === 0 ? (
                        <p className="text-sm text-destructive">Не найден под {server.mcVersion} — возможно, его нет на Modrinth</p>
                      ) : (
                        <Select
                          className="h-8 text-sm"
                          value={r.chosen ?? ""}
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, chosen: e.target.value || null } : x)))}
                        >
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.title}
                            </option>
                          ))}
                          <option value="">— не ставить —</option>
                        </Select>
                      )}
                    </div>
                    {chosen && <SideBadges m={chosen} />}
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Убрать">
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setRows(null)}>
                Назад к списку
              </Button>
              <Button onClick={() => void build(chosenIds)} disabled={chosenIds.length === 0}>
                <Wand2 /> Собрать ({chosenIds.length})
              </Button>
            </div>
          </div>
        )}

        {job && (running || job.state !== "done" || job.problems.length > 0 || rows === null) && (
          <div className="space-y-2">
            {running && (
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin text-primary" /> Собираю… ({job.mods.length} скачано)
              </p>
            )}
            {job.state === "done" && (
              <p className="flex items-center gap-2 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" /> На сервер: {job.mods.filter((m) => m.onServer).length}, игрокам: {job.mods.filter((m) => m.onClient).length}.
                Перезапустите сервер.
              </p>
            )}
            {job.state === "failed" && <p className="text-sm text-destructive">Ошибка: {job.error}</p>}
            {job.problems.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                {job.problems.map((p) => (
                  <li key={p}>⚠ {p}</li>
                ))}
              </ul>
            )}
            <pre className="max-h-48 overflow-auto rounded-lg bg-console p-3 font-mono text-xs leading-relaxed text-zinc-300 scrollbar-thin">{job.log.join("\n")}</pre>
          </div>
        )}
    </CollapsibleCard>
  );
}
