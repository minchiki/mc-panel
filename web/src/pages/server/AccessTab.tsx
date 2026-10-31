import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AuditList } from "@/components/AuditList";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/overlays";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { del, errorText, get, put } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { AuditEntry, Permission } from "@/lib/types";
import { useServerContext } from "./ServerLayout";

interface Subuser {
  userId: number;
  username: string;
  permissions: Permission[];
}

const PERM_LABELS: Record<Permission, { tab: MessageKey; hint: string }> = {
  console: { tab: "tabs.console", hint: "Видеть лог и вводить команды" },
  power: { tab: "tabs.console", hint: "Запуск, остановка, рестарт" },
  files: { tab: "tabs.files", hint: "Файлы сервера" },
  settings: { tab: "tabs.settings", hint: "server.properties, Java, флаги" },
  players: { tab: "tabs.players", hint: "Кик, бан, OP, вайтлист" },
  plugins: { tab: "tabs.plugins", hint: "Установка и удаление" },
  backups: { tab: "tabs.backups", hint: "Создание и восстановление" },
  schedules: { tab: "tabs.schedules", hint: "Задачи по расписанию" },
  databases: { tab: "tabs.databases", hint: "Включая пароли БД" },
  network: { tab: "tabs.network", hint: "Порт и домен" },
  monitor: { tab: "tabs.monitoring", hint: "Графики нагрузки" },
};

export default function AccessTab() {
  const server = useServerContext();
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const base = `/api/servers/${server.id}/subusers`;
  const [edit, setEdit] = useState<{ username: string; permissions: Set<Permission>; existing: boolean } | null>(null);
  const subs = useQuery({ queryKey: ["subusers", server.id], queryFn: () => get<{ available: Permission[]; subusers: Subuser[] }>(base) });
  const activity = useQuery({ queryKey: ["activity", server.id], queryFn: async () => (await get<{ entries: AuditEntry[] }>(`/api/servers/${server.id}/activity`)).entries });

  const save = async () => {
    if (!edit) return;
    try {
      await put(base, { username: edit.username.trim(), permissions: [...edit.permissions] });
      toast.success("Доступ сохранён");
      setEdit(null);
      await qc.invalidateQueries({ queryKey: ["subusers", server.id] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (s: Subuser) => {
    if (!(await confirm({ title: `Забрать доступ у ${s.username}?`, confirmText: "Забрать", destructive: true }))) return;
    await del(`${base}/${s.userId}`).catch((err) => toast.error(errorText(err)));
    await qc.invalidateQueries({ queryKey: ["subusers", server.id] });
  };

  const permLabel = (p: Permission) => (p === "power" ? "Питание" : p === "monitor" ? t("tabs.monitoring") : t(PERM_LABELS[p].tab));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Помощники</CardTitle>
            <CardDescription>Дайте другу или модератору доступ к отдельным разделам. У человека должен быть аккаунт в панели.</CardDescription>
          </div>
          <Button onClick={() => setEdit({ username: "", permissions: new Set<Permission>(["console", "power", "players", "monitor"]), existing: false })}>
            <UserPlus /> Добавить
          </Button>
        </CardHeader>
        <CardContent>
          {subs.isLoading ? (
            <Spinner />
          ) : subs.data?.subusers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Помощников нет, доступ только у владельца.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {subs.data?.subusers.map((s) => (
                <li key={s.userId} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="font-medium">{s.username}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {s.permissions.map((p) => (
                      <Badge key={p} variant="secondary">
                        {permLabel(p)}
                      </Badge>
                    ))}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => setEdit({ username: s.username, permissions: new Set(s.permissions), existing: true })} aria-label="Изменить">
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(s)} aria-label="Удалить">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Журнал действий</CardTitle>
          <CardDescription>Кто и что делал с этим сервером</CardDescription>
        </CardHeader>
        <CardContent>{activity.isLoading ? <Spinner /> : <AuditList entries={activity.data ?? []} />}</CardContent>
      </Card>

      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader title={edit?.existing ? `Доступ: ${edit.username}` : "Новый помощник"} />
          {edit && (
            <div className="space-y-4">
              {!edit.existing && (
                <Field label="Имя пользователя в панели">
                  <Input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} autoFocus />
                </Field>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {(subs.data?.available ?? []).map((p) => (
                  <label key={p} className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                      checked={edit.permissions.has(p)}
                      onChange={() => {
                        const next = new Set(edit.permissions);
                        if (next.has(p)) next.delete(p);
                        else next.add(p);
                        setEdit({ ...edit, permissions: next });
                      }}
                    />
                    <span>
                      <span className="block text-sm font-medium">{permLabel(p)}</span>
                      <span className="block text-xs text-muted-foreground">{PERM_LABELS[p].hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEdit(null)}>
                  Отмена
                </Button>
                <Button onClick={() => void save()} disabled={!edit.username.trim()}>
                  Сохранить
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
