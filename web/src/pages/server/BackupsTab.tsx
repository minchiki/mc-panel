import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Download, Loader2, Plus, Save, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, Input, Textarea } from "@/components/ui/primitives";
import { del, errorText, get, post, put } from "@/lib/api";
import { formatBytes, formatDateFull } from "@/lib/format";
import { useServerContext } from "./ServerLayout";

interface Backup {
  id: string;
  name: string;
  size_bytes: number;
  status: "running" | "done" | "failed";
  error: string | null;
  created_at: number;
}

export default function BackupsTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const base = `/api/servers/${server.id}/backups`;
  const [name, setName] = useState("");
  const [settings, setSettings] = useState({ max_count: 5, excludes: "" });
  const data = useQuery({
    queryKey: ["backups", server.id],
    queryFn: () => get<{ backups: Backup[]; settings: { max_count: number; excludes: string } }>(base),
    refetchInterval: (q) => (q.state.data?.backups.some((b) => b.status === "running") ? 2000 : false),
  });
  useEffect(() => {
    if (data.data) setSettings(data.data.settings);
  }, [data.data?.settings]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["backups", server.id] });

  const create = async () => {
    try {
      await post(base, { name: name.trim() });
      setName("");
      toast.success("Создаю бэкап…", { description: "Сервер продолжит работать, мир временно не автосохраняется" });
      setTimeout(() => void refresh(), 500);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const restore = async (b: Backup) => {
    const ok = await confirm({
      title: `Восстановить «${b.name}»?`,
      description: "Сервер будет остановлен, а все текущие файлы заменены содержимым бэкапа. Сделайте свежий бэкап, если текущее состояние может понадобиться.",
      confirmText: "Восстановить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await post(`${base}/${b.id}/restore`);
      toast.success("Восстановление запущено, ход виден в консоли");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (b: Backup) => {
    if (!(await confirm({ title: `Удалить бэкап «${b.name}»?`, confirmText: "Удалить", destructive: true }))) return;
    try {
      await del(`${base}/${b.id}`);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const saveSettings = async () => {
    try {
      await put(`${base}/settings`, settings);
      toast.success("Настройки бэкапов сохранены");
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (data.isLoading) return <Spinner />;
  const backups = data.data?.backups ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>Бэкапы</CardTitle>
          <CardDescription>
            Хранится не больше {data.data?.settings.max_count}, самые старые удаляются автоматически. Бэкапы по расписанию настраиваются во вкладке «Расписание».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Input placeholder="Название (необязательно)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <Button type="submit" disabled={backups.some((b) => b.status === "running")}>
              <Plus /> Создать бэкап
            </Button>
          </form>
          {backups.length === 0 ? (
            <EmptyState icon={<Archive />} title="Бэкапов пока нет" description="Сделайте первый перед тем, как ставить плагины или обновлять версию." />
          ) : (
            <ul className="divide-y rounded-lg border">
              {backups.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    {b.status === "running" ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : b.status === "failed" ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : (
                      <Archive className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateFull(b.created_at)} ·{" "}
                      {b.status === "running" ? "создаётся…" : b.status === "failed" ? <span className="text-destructive">{b.error}</span> : formatBytes(b.size_bytes)}
                    </p>
                  </div>
                  {b.status === "done" && (
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => void restore(b)}>
                        <ArchiveRestore /> Восстановить
                      </Button>
                      <Button size="icon" variant="ghost" asChild>
                        <a href={`${base}/${b.id}/download`} aria-label="Скачать">
                          <Download />
                        </a>
                      </Button>
                    </div>
                  )}
                  {b.status !== "running" && (
                    <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(b)} aria-label="Удалить">
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Параметры</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Сколько хранить" hint="От 1 до 50">
            <Input type="number" min={1} max={50} value={settings.max_count} onChange={(e) => setSettings({ ...settings, max_count: Number(e.target.value) })} />
          </Field>
          <Field label="Исключения" hint="Папки и файлы, по одному на строку, относительно корня сервера">
            <Textarea rows={5} className="font-mono text-xs" value={settings.excludes} onChange={(e) => setSettings({ ...settings, excludes: e.target.value })} />
          </Field>
          <Button variant="outline" className="w-full" onClick={() => void saveSettings()}>
            <Save /> Сохранить
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
