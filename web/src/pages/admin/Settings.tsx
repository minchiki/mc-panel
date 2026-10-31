import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Download, KeyRound, Palette, Save, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { errorText, get, post, put } from "@/lib/api";
import { applyAccent } from "@/lib/utils";

interface Settings {
  registrationEnabled: boolean;
  accentColor: string;
  panelName: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramApiBase: string;
  telegramRelayKey: string;
  discordWebhook: string;
  notifyEvents: Record<NotifyEvent, boolean>;
  diskAlertPercent: number;
  curseforgeApiKey: string;
}

type NotifyEvent = "started" | "stopped" | "crash" | "backupOk" | "backupFailed" | "disk";

const EVENTS: { key: NotifyEvent; label: string; hint: string }[] = [
  { key: "started", label: "Сервер запущен", hint: "Когда сервер дошёл до состояния «онлайн»" },
  { key: "stopped", label: "Сервер остановлен", hint: "Обычная остановка из панели" },
  { key: "crash", label: "Сервер упал", hint: "Падение и бесконечные перезапуски" },
  { key: "backupOk", label: "Бэкап создан", hint: "Каждый успешный бэкап, в том числе по расписанию" },
  { key: "backupFailed", label: "Бэкап не удался", hint: "Ошибка при создании бэкапа" },
  { key: "disk", label: "Мало места на диске", hint: "Диск VPS или лимит сервера" },
];

interface UpdateInfo {
  current: string;
  available: boolean;
  behindBy: number;
  latest: string;
  message: string;
}

const ACCENTS = ["#22c55e", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#eab308"];

export default function AdminSettings() {
  useCrumbs([{ label: "Администрирование" }, { label: "Настройки панели" }]);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: () => get<{ settings: Settings }>("/api/admin/settings") });
  const [form, setForm] = useState<Settings | null>(null);
  const [testing, setTesting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateCheck = useQuery({ queryKey: ["update-check"], queryFn: () => get<UpdateInfo>("/api/admin/update/check"), staleTime: 60 * 60_000 });
  const updateLog = useQuery({ queryKey: ["update-log"], queryFn: () => get<{ log: string }>("/api/admin/update/status"), refetchInterval: updating ? 3000 : false });

  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);

  if (!form) return <Spinner />;

  const save = async () => {
    try {
      await put("/api/admin/settings", form);
      applyAccent(form.accentColor);
      toast.success("Настройки сохранены");
      await qc.invalidateQueries({ queryKey: ["admin-settings"] });
      await qc.invalidateQueries({ queryKey: ["public-settings"] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await save();
      const res = await post<{ telegram: string; discord: string }>("/api/admin/settings/test-notification");
      toast.info(`Telegram: ${res.telegram} · Discord: ${res.discord}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setTesting(false);
    }
  };

  const update = async () => {
    const ok = await confirm({
      title: "Обновить панель?",
      description: "Панель скачает последнюю версию из git, пересоберётся и перезапустится (около минуты). Игровые серверы продолжат работать.",
      confirmText: "Обновить",
    });
    if (!ok) return;
    try {
      await post("/api/admin/update");
      setUpdating(true);
      toast.info("Обновление запущено, страница переподключится сама");
      setTimeout(() => setUpdating(false), 180_000);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });

  return (
    <>
      <PageHeader
        title="Настройки панели"
        actions={
          <Button onClick={() => void save()}>
            <Save /> Сохранить
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4" /> Внешний вид
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Название панели">
              <Input value={form.panelName} onChange={(e) => set("panelName", e.target.value)} maxLength={40} />
            </Field>
            <Field label="Акцентный цвет">
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      set("accentColor", c);
                      applyAccent(c);
                    }}
                    className={`size-8 rounded-full ring-offset-2 ring-offset-background transition ${form.accentColor === c ? "ring-2 ring-foreground" : ""}`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
                <Input
                  type="color"
                  value={form.accentColor}
                  onChange={(e) => {
                    set("accentColor", e.target.value);
                    applyAccent(e.target.value);
                  }}
                  className="h-8 w-14 cursor-pointer p-1"
                />
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="size-4" /> Уведомления
            </CardTitle>
            <CardDescription>Сообщения в Telegram и Discord о том, что происходит с серверами. Выберите, о чём писать.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Токен Telegram-бота" hint="Создайте бота у @BotFather. Сохранённый токен показан звёздочками.">
              <Input value={form.telegramBotToken} onChange={(e) => set("telegramBotToken", e.target.value)} placeholder="123456:ABC-DEF…" autoComplete="off" />
            </Field>
            <Field label="Chat ID" hint="Узнать можно у @userinfobot; для группы — с минусом">
              <Input value={form.telegramChatId} onChange={(e) => set("telegramChatId", e.target.value)} placeholder="-1001234567890" />
            </Field>
            <Field label="Discord webhook" hint="Настройки канала → Интеграции → Вебхуки">
              <Input value={form.discordWebhook} onChange={(e) => set("discordWebhook", e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
            </Field>
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Telegram заблокирован на VPS? Через relay</summary>
              <div className="mt-3 space-y-4">
                <Field label="Адрес relay" hint="Например https://my-relay.vercel.app/tg. Пусто = напрямую через api.telegram.org">
                  <Input value={form.telegramApiBase} onChange={(e) => set("telegramApiBase", e.target.value)} placeholder="https://…/tg" />
                </Field>
                <Field label="Ключ relay" hint="Сохранённый ключ показан звёздочками">
                  <Input value={form.telegramRelayKey} onChange={(e) => set("telegramRelayKey", e.target.value)} autoComplete="off" />
                </Field>
              </div>
            </details>
            <div className="space-y-1">
              <p className="text-sm font-medium">О чём уведомлять</p>
              {EVENTS.map((e) => (
                <label key={e.key} className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-1 py-2 hover:bg-accent/50">
                  <span className="min-w-0">
                    <span className="block text-sm">{e.label}</span>
                    <span className="block text-xs text-muted-foreground">{e.hint}</span>
                  </span>
                  <Switch checked={form.notifyEvents[e.key]} onCheckedChange={(v) => set("notifyEvents", { ...form.notifyEvents, [e.key]: v })} />
                </label>
              ))}
            </div>
            <Field label="Порог заполнения диска VPS, %">
              <Input type="number" min={50} max={99} value={form.diskAlertPercent} onChange={(e) => set("diskAlertPercent", Number(e.target.value))} />
            </Field>
            <Button variant="outline" onClick={() => void test()} loading={testing}>
              <Send /> Сохранить и отправить тест
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> CurseForge
            </CardTitle>
            <CardDescription>Ключ нужен, чтобы искать и ставить моды из CurseForge во вкладке «Моды». Modrinth работает без ключа.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="API-ключ" hint="Получите бесплатно на console.curseforge.com → API keys. Сохранённый ключ показан звёздочками.">
              <Input value={form.curseforgeApiKey} onChange={(e) => set("curseforgeApiKey", e.target.value)} placeholder="$2a$10$…" autoComplete="off" />
            </Field>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="size-4" /> Обновление панели
            </CardTitle>
            <CardDescription>Перед обновлением автоматически делается бэкап базы панели в /var/backups/mc-panel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {updateCheck.data?.available ? (
              <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                Доступна новая версия: {updateCheck.data.behindBy} {updateCheck.data.behindBy === 1 ? "обновление" : "обновлений"}
                {updateCheck.data.message && <>. Последнее: «{updateCheck.data.message}»</>}
              </p>
            ) : (
              updateCheck.data && <p className="text-sm text-muted-foreground">Установлена последняя известная версия ({updateCheck.data.current || "dev"}).</p>
            )}
            <Button onClick={() => void update()} loading={updating}>
              Обновить панель
            </Button>
            {updateLog.data?.log && (
              <pre className="max-h-64 overflow-auto rounded-lg bg-console p-3 font-mono text-xs text-zinc-300 scrollbar-thin">{updateLog.data.log}</pre>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
