import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Plus, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { AuditList } from "@/components/AuditList";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/overlays";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { del, errorText, get, post } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AuditEntry, User } from "@/lib/types";
import { EmailCard } from "./EmailCard";
import { LegalLinks } from "./Legal";

function PasswordCard() {
  const [form, setForm] = useState({ current: "", next: "", repeat: "" });
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.next !== form.repeat) return toast.error("Новые пароли не совпадают");
    setLoading(true);
    try {
      await post("/api/auth/password", { current: form.current, next: form.next });
      setForm({ current: "", next: "", repeat: "" });
      toast.success("Пароль изменён", { description: "Другие сессии завершены" });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Пароль</CardTitle>
        <CardDescription>После смены остальные устройства будут разлогинены.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Текущий пароль">
            <Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />
          </Field>
          <Field label="Новый пароль" hint="Минимум 10 символов">
            <Input type="password" autoComplete="new-password" minLength={10} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required />
          </Field>
          <Field label="Ещё раз">
            <Input type="password" autoComplete="new-password" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} required />
          </Field>
          <Button type="submit" loading={loading}>
            <KeyRound /> Сменить пароль
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TwoFactorCard({ user }: { user: User }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [disable, setDisable] = useState(false);
  const [password, setPassword] = useState("");

  const start = async () => {
    try {
      setSetup(await post<{ secret: string; qrDataUrl: string }>("/api/auth/2fa/setup"));
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const enable = async () => {
    try {
      const res = await post<{ user: User }>("/api/auth/2fa/enable", { code });
      qc.setQueryData(["me"], res.user);
      setSetup(null);
      setCode("");
      toast.success("2FA включена");
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const turnOff = async () => {
    try {
      const res = await post<{ user: User }>("/api/auth/2fa/disable", { password, code });
      qc.setQueryData(["me"], res.user);
      setDisable(false);
      setPassword("");
      setCode("");
      toast.success("2FA отключена");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Двухфакторная защита {user.totpEnabled ? <Badge>включена</Badge> : <Badge variant="warning">выключена</Badge>}
        </CardTitle>
        <CardDescription>Код из Google Authenticator, Aegis или 1Password при каждом входе.</CardDescription>
      </CardHeader>
      <CardContent>
        {user.totpEnabled ? (
          <Button variant="outline" onClick={() => setDisable(true)}>
            <ShieldOff /> Отключить 2FA
          </Button>
        ) : (
          <Button onClick={() => void start()}>
            <ShieldCheck /> Включить 2FA
          </Button>
        )}
      </CardContent>

      <Dialog open={setup !== null} onOpenChange={(o) => !o && setSetup(null)}>
        <DialogContent>
          <DialogHeader title="Настройка 2FA" description="Отсканируйте QR-код в приложении и введите 6 цифр, которые оно покажет." />
          {setup && (
            <div className="space-y-4">
              <img src={setup.qrDataUrl} alt="QR-код для приложения-аутентификатора" className="mx-auto size-48 rounded-lg bg-white p-2" />
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                <span className="flex-1 break-all">{setup.secret}</span>
                <CopyButton text={setup.secret} />
              </div>
              <Input inputMode="numeric" placeholder="123456" maxLength={6} className="text-center font-mono text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              <DialogFooter>
                <Button onClick={() => void enable()} disabled={code.length !== 6}>
                  Подтвердить
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disable} onOpenChange={setDisable}>
        <DialogContent>
          <DialogHeader title="Отключить 2FA" description="Подтвердите паролем и текущим кодом." />
          <div className="space-y-3">
            <Input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input inputMode="numeric" placeholder="Код 2FA" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <DialogFooter>
              <Button variant="destructive" onClick={() => void turnOff()} disabled={!password || code.length !== 6}>
                Отключить
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ApiKeysCard() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => (await get<{ keys: { id: number; name: string; prefix: string; created_at: number; last_used_at: number | null }[] }>("/api/auth/api-keys")).keys,
  });
  const create = async () => {
    try {
      const res = await post<{ key: string }>("/api/auth/api-keys", { name: name.trim() });
      setCreated(res.key);
      setName("");
      await qc.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const remove = async (id: number) => {
    if (!(await confirm({ title: "Удалить ключ?", description: "Скрипты, использующие его, перестанут работать.", confirmText: "Удалить", destructive: true }))) return;
    await del(`/api/auth/api-keys/${id}`).catch((err) => toast.error(errorText(err)));
    await qc.invalidateQueries({ queryKey: ["api-keys"] });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>API-ключи</CardTitle>
        <CardDescription>
          Для ботов и скриптов: заголовок <code className="rounded bg-muted px-1">Authorization: Bearer mcp_…</code>. Ключ имеет ваши права.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input placeholder="Название, например discord-bot" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          <Button type="submit" disabled={!name.trim()}>
            <Plus /> Создать
          </Button>
        </form>
        {created && (
          <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Скопируйте ключ сейчас: больше он не будет показан.</p>
            <div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 font-mono text-xs">
              <span className="flex-1 break-all">{created}</span>
              <CopyButton text={created} />
            </div>
          </div>
        )}
        <ul className="divide-y">
          {keys.data?.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium">{k.name}</span>
              <code className="text-xs text-muted-foreground">{k.prefix}…</code>
              <span className="ml-auto text-xs text-muted-foreground">{k.last_used_at ? `использован ${formatDate(k.last_used_at)}` : "не использовался"}</span>
              <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => void remove(k.id)} aria-label="Удалить">
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: async () => (await get<{ sessions: { created_at: number; ip: string; user_agent: string }[] }>("/api/auth/sessions")).sessions });
  const revoke = async () => {
    await post("/api/auth/sessions/revoke-others").catch((err) => toast.error(errorText(err)));
    toast.success("Остальные сессии завершены");
    await sessions.refetch();
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Активные сессии</CardTitle>
          <CardDescription>Устройства, где выполнен вход</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void revoke()}>
          <LogOut /> Выйти на остальных
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {sessions.data?.map((s, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2">
              <span className="truncate">{s.user_agent || "Неизвестное устройство"}</span>
              <span className="text-xs text-muted-foreground">
                {s.ip} · {formatDate(s.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  useCrumbs([{ label: "Аккаунт" }]);
  const { user } = useAuth();
  const activity = useQuery({ queryKey: ["my-activity"], queryFn: async () => (await get<{ entries: AuditEntry[] }>("/api/auth/activity")).entries });
  if (!user) return null;
  return (
    <>
      <PageHeader title={user.username} description={`${user.role === "admin" ? "Администратор" : "Пользователь"} · лимит: ${user.maxServers} серв., ${Math.round(user.maxRamMb / 1024)} ГБ RAM`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <PasswordCard />
          <EmailCard user={user} />
        </div>
        <div className="space-y-6">
          <TwoFactorCard user={user} />
          <SessionsCard />
        </div>
        <div className="lg:col-span-2">
          <ApiKeysCard />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Мои действия</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditList entries={activity.data ?? []} showServer />
          </CardContent>
        </Card>
      </div>
      <LegalLinks className="mt-8" />
    </>
  );
}
