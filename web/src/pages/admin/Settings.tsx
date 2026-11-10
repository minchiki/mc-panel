import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Download, KeyRound, Mail, Palette, Save, Scale, Send } from "lucide-react";
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
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  panelUrl: string;
  operatorName: string;
  operatorContact: string;
}

const SMTP_PRESETS = [
  { name: "Яндекс", host: "smtp.yandex.ru", port: 465, help: "id.yandex.ru → Безопасность → Пароли приложений → Почта" },
  { name: "Mail.ru", host: "smtp.mail.ru", port: 465, help: "Настройки почты → Безопасность → Пароли для внешних приложений" },
  { name: "Gmail", host: "smtp.gmail.com", port: 465, help: "myaccount.google.com → Безопасность → Пароли приложений (нужна 2FA)" },
];

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
  const [mailTo, setMailTo] = useState("");
  const [mailTesting, setMailTesting] = useState(false);
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

  const testEmail = async () => {
    setMailTesting(true);
    try {
      await save();
      const res = await post<{ to: string }>("/api/admin/settings/test-email", { to: mailTo });
      toast.success(`Тестовое письмо отправлено на ${res.to}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMailTesting(false);
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
              <Mail className="size-4" /> Почта
            </CardTitle>
            <CardDescription>
              Для «Забыли пароль?» и подтверждения почты. Заведите отдельный ящик для панели и создайте в нём пароль приложения: обычный пароль от почты SMTP не примет. Пока поля пустые, восстановление по
              почте выключено, и никто не увидит предложения добавить почту.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {SMTP_PRESETS.map((p) => (
                <Button key={p.name} type="button" size="sm" variant={form.smtpHost === p.host ? "default" : "outline"} onClick={() => setForm({ ...form, smtpHost: p.host, smtpPort: p.port })}>
                  {p.name}
                </Button>
              ))}
            </div>
            {SMTP_PRESETS.find((p) => p.host === form.smtpHost) && (
              <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Пароль приложения: {SMTP_PRESETS.find((p) => p.host === form.smtpHost)!.help}</p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="SMTP-сервер">
                <Input value={form.smtpHost} onChange={(e) => set("smtpHost", e.target.value.trim())} placeholder="smtp.yandex.ru" />
              </Field>
              <Field label="Порт" hint="465 или 587">
                <Input type="number" value={form.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Логин (адрес ящика)">
                <Input value={form.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} placeholder="mcpanel.noreply@yandex.ru" autoComplete="off" />
              </Field>
              <Field label="Пароль приложения" hint="Сохранённый пароль показан звёздочками">
                <Input type="password" value={form.smtpPass} onChange={(e) => set("smtpPass", e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <Field label="От кого" hint="Как письмо будет подписано. Адрес должен совпадать с ящиком выше.">
              <Input value={form.smtpFrom} onChange={(e) => set("smtpFrom", e.target.value)} placeholder={`${form.panelName || "MC Panel"} <${form.smtpUser || "mcpanel.noreply@yandex.ru"}>`} />
            </Field>
            <Field label="Адрес панели" hint="Из него собираются ссылки в письмах">
              <div className="flex gap-2">
                <Input value={form.panelUrl} onChange={(e) => set("panelUrl", e.target.value.trim())} placeholder="https://panel.example.ru" />
                <Button type="button" variant="outline" onClick={() => set("panelUrl", window.location.origin)}>
                  Этот адрес
                </Button>
              </div>
            </Field>
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
              <Input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="Куда отправить тест (по умолчанию ваша почта)" type="email" />
              <Button variant="outline" onClick={() => void testEmail()} loading={mailTesting} disabled={!form.smtpHost}>
                <Send /> Сохранить и отправить тест
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="size-4" /> Персональные данные (152-ФЗ)
            </CardTitle>
            <CardDescription>
              Панель сама показывает <a href="/privacy" target="_blank" className="text-primary underline">политику обработки данных</a> и отдельное{" "}
              <a href="/consent" target="_blank" className="text-primary underline">согласие</a>, а при регистрации спрашивает галочку согласия. Впишите, кто оператор данных и куда писать с вопросами. По
              закону данные россиян должны храниться в России, поэтому держите панель на российском VPS. Если собираете данные пользователей, подайте уведомление в Роскомнадзор на pd.rkn.gov.ru.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Оператор" hint="ФИО, ИП или название организации">
              <Input value={form.operatorName ?? ""} onChange={(e) => set("operatorName", e.target.value)} placeholder="Иванов Иван Иванович" />
            </Field>
            <Field label="Контакт для запросов" hint="Почта или @ник в Telegram">
              <Input value={form.operatorContact ?? ""} onChange={(e) => set("operatorContact", e.target.value)} placeholder="privacy@example.ru" />
            </Field>
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
