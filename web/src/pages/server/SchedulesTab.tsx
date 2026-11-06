import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter, DialogHeader, Switch } from "@/components/ui/overlays";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, Select } from "@/components/ui/primitives";
import { del, errorText, get, post } from "@/lib/api";
import { formatDate, formatDateFull } from "@/lib/format";
import { useServerContext } from "./ServerLayout";

type Action = "restart" | "start" | "stop" | "command" | "backup" | "broadcast";

interface Schedule {
  id: number;
  name: string;
  cron: string;
  action: Action;
  payload: string;
  enabled: number;
  last_run_at: number | null;
  last_result: string | null;
  next: number[];
}

const ACTIONS: Record<Action, { label: string; payload?: string; placeholder?: string }> = {
  restart: { label: "Перезапуск", payload: "Предупредить игроков за N секунд", placeholder: "60" },
  backup: { label: "Бэкап", payload: "Название бэкапа (необязательно)", placeholder: "Ночной бэкап" },
  command: { label: "Команда в консоль", payload: "Команда без /", placeholder: "save-all" },
  broadcast: { label: "Сообщение игрокам", payload: "Текст", placeholder: "Не забудьте проголосовать за сервер!" },
  start: { label: "Запуск" },
  stop: { label: "Остановка" },
};

const PRESETS = [
  { label: "Каждый день в 05:00", cron: "0 5 * * *" },
  { label: "Каждые 6 часов", cron: "0 */6 * * *" },
  { label: "Каждый час", cron: "0 * * * *" },
  { label: "Каждые 15 минут", cron: "*/15 * * * *" },
  { label: "По понедельникам в 04:00", cron: "0 4 * * 1" },
];

type Draft = { id?: number; name: string; cron: string; action: Action; payload: string; enabled: boolean };
const EMPTY: Draft = { name: "", cron: "0 5 * * *", action: "restart", payload: "60", enabled: true };

export default function SchedulesTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const base = `/api/servers/${server.id}/schedules`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<{ next?: number[]; error?: string }>({});
  const [saving, setSaving] = useState(false);
  const data = useQuery({ queryKey: ["schedules", server.id], queryFn: () => get<{ schedules: Schedule[] }>(base) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["schedules", server.id] });

  useEffect(() => {
    if (!draft?.cron) return;
    const t = setTimeout(() => {
      post<{ next: number[] }>(`${base}/preview`, { cron: draft.cron })
        .then((r) => setPreview({ next: r.next }))
        .catch((err) => setPreview({ error: errorText(err) }));
    }, 300);
    return () => clearTimeout(t);
  }, [draft?.cron, base]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await post(base, { ...draft, name: draft.name.trim() || ACTIONS[draft.action].label });
      toast.success("Задача сохранена");
      setDraft(null);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: Schedule) => {
    try {
      await post(base, { id: s.id, name: s.name, cron: s.cron, action: s.action, payload: s.payload, enabled: !s.enabled });
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (s: Schedule) => {
    if (!(await confirm({ title: `Удалить задачу «${s.name}»?`, confirmText: "Удалить", destructive: true }))) return;
    await del(`${base}/${s.id}`).catch((err) => toast.error(errorText(err)));
    await refresh();
  };

  const runNow = async (s: Schedule) => {
    await post(`${base}/${s.id}/run`).catch((err) => toast.error(errorText(err)));
    toast.success("Задача запущена");
    setTimeout(() => void refresh(), 1500);
  };

  if (data.isLoading) return <Spinner />;
  const list = data.data?.schedules ?? [];
  const meta = draft ? ACTIONS[draft.action] : null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Расписание</CardTitle>
          <CardDescription>Автоматические рестарты, бэкапы, команды и объявления. Время московское.</CardDescription>
        </div>
        <Button onClick={() => setDraft({ ...EMPTY })}>
          <Plus /> Задача
        </Button>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title="Нет задач"
            description="Например, ежедневный рестарт в 5 утра с предупреждением игроков или бэкап каждые 6 часов."
            action={<Button onClick={() => setDraft({ ...EMPTY })}>Создать задачу</Button>}
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <Switch checked={Boolean(s.enabled)} onCheckedChange={() => void toggle(s)} />
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge variant="secondary">{ACTIONS[s.action].label}</Badge>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.cron}</code>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.enabled && s.next[0] ? `Следующий запуск: ${formatDateFull(s.next[0])}` : "Выключена"}
                    {s.last_run_at && ` · Последний: ${formatDate(s.last_run_at)} (${s.last_result})`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => void runNow(s)} aria-label="Запустить сейчас">
                    <Play />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setDraft({ id: s.id, name: s.name, cron: s.cron, action: s.action, payload: s.payload, enabled: Boolean(s.enabled) })} aria-label="Изменить">
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(s)} aria-label="Удалить">
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader title={draft?.id ? "Изменить задачу" : "Новая задача"} />
          {draft && (
            <div className="space-y-4">
              <Field label="Действие">
                <Select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as Action, payload: ACTIONS[e.target.value as Action].placeholder ?? "" })}>
                  {Object.entries(ACTIONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {meta?.payload && (
                <Field label={meta.payload}>
                  <Input value={draft.payload} placeholder={meta.placeholder} onChange={(e) => setDraft({ ...draft, payload: e.target.value })} />
                </Field>
              )}
              <Field label="Когда (cron)" hint="минута час день месяц день-недели" error={preview.error}>
                <Input className="font-mono" value={draft.cron} onChange={(e) => setDraft({ ...draft, cron: e.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <Button key={p.cron} type="button" size="sm" variant={draft.cron === p.cron ? "default" : "outline"} onClick={() => setDraft({ ...draft, cron: p.cron })}>
                    {p.label}
                  </Button>
                ))}
              </div>
              {preview.next && !preview.error && (
                <p className="text-xs text-muted-foreground">Ближайшие запуски: {preview.next.map((n) => formatDate(n)).join(", ")}</p>
              )}
              <Field label="Название (необязательно)">
                <Input value={draft.name} placeholder={meta?.label} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={64} />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Отмена
                </Button>
                <Button onClick={() => void save()} loading={saving} disabled={Boolean(preview.error)}>
                  Сохранить
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
