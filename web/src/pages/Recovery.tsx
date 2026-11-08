import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Mail, MailCheck } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { errorText, post } from "@/lib/api";
import { AuthLayout } from "./Login";

/** Reads "#token=..." (tokens travel after "#", so they never reach server logs). */
function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}
/** Drops the token from the address bar right away (history, screenshots, people looking over the shoulder). */
function hideToken(): void {
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
}

export function ForgotPage() {
  const { settings } = useAuth();
  const [login, setLogin] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await post("/api/auth/forgot", { login });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  if (settings && !settings.passwordReset) {
    return (
      <AuthLayout title="Восстановление пароля" subtitle="На этой панели восстановление по почте не настроено">
        <p className="text-sm text-muted-foreground">Попросите администратора панели сбросить вам пароль.</p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link to="/login">Ко входу</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Забыли пароль?" subtitle={sent ? "Проверьте почту" : "Пришлём ссылку для нового пароля"}>
      {sent ? (
        <div className="space-y-4 text-sm">
          <p className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-primary">
            <MailCheck className="mt-0.5 size-4 shrink-0" />
            Если такой аккаунт есть и к нему привязана подтверждённая почта, письмо со ссылкой уже в пути. Ссылка действует 30 минут.
          </p>
          <p className="text-muted-foreground">Не пришло за пару минут? Загляните в «Спам». Почты в аккаунте нет? Тогда пароль сбросит администратор панели.</p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Ко входу</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Имя пользователя или почта" htmlFor="f-login">
            <Input id="f-login" autoComplete="username" autoFocus value={login} onChange={(e) => setLogin(e.target.value)} required />
          </Field>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            <Mail /> Отправить ссылку
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/login">Я вспомнил пароль</Link>
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

interface ResetCheck {
  valid: boolean;
  username?: string;
  needTotp?: boolean;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(tokenFromHash);
  const [check, setCheck] = useState<ResetCheck | null>(null);
  const [form, setForm] = useState({ password: "", password2: "", totp: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    hideToken();
    if (!token) return setCheck({ valid: false });
    post<ResetCheck>("/api/auth/reset/check", { token })
      .then(setCheck)
      .catch(() => setCheck({ valid: false }));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.password2) return setError("Пароли не совпадают");
    setError("");
    setLoading(true);
    try {
      const res = await post<{ ok?: boolean; needTotp?: boolean }>("/api/auth/reset", { token, password: form.password, totp: form.totp || undefined });
      if (res.needTotp) return setCheck((c) => ({ ...c!, needTotp: true }));
      toast.success("Пароль изменён. Войдите с новым паролем.");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  if (!check) {
    return (
      <AuthLayout title="Новый пароль" subtitle="Проверяю ссылку…">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </AuthLayout>
    );
  }
  if (!check.valid) {
    return (
      <AuthLayout title="Ссылка не работает" subtitle="Она устарела или уже была использована">
        <p className="text-sm text-muted-foreground">Ссылка из письма действует 30 минут и срабатывает один раз. Запросите новую.</p>
        <Button asChild className="mt-4 w-full">
          <Link to="/forgot">Получить новую ссылку</Link>
        </Button>
      </AuthLayout>
    );
  }
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthLayout title="Новый пароль" subtitle={`Для аккаунта ${check.username}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Новый пароль" hint="Минимум 10 символов" htmlFor="rp-1">
          <Input id="rp-1" type="password" autoComplete="new-password" minLength={10} autoFocus value={form.password} onChange={set("password")} required />
        </Field>
        <Field label="Ещё раз" htmlFor="rp-2">
          <Input id="rp-2" type="password" autoComplete="new-password" value={form.password2} onChange={set("password2")} required />
        </Field>
        {check.needTotp && (
          <Field label="Код 2FA" hint="На аккаунте включена двухфакторная защита" htmlFor="rp-totp">
            <Input
              id="rp-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              className="text-center font-mono text-lg tracking-[0.4em]"
              value={form.totp}
              onChange={(e) => setForm({ ...form, totp: e.target.value.replace(/\D/g, "") })}
              required
            />
          </Field>
        )}
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          <KeyRound /> Сохранить пароль
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ConfirmEmailPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const token = tokenFromHash();
    hideToken();
    if (!token) return setState({ ok: false, text: "В ссылке нет кода подтверждения." });
    post<{ email: string }>("/api/auth/email/confirm", { token })
      .then((r) => {
        setState({ ok: true, text: `Почта ${r.email} подтверждена. Теперь, если забудете пароль, восстановите его по ссылке из письма.` });
        void qc.invalidateQueries({ queryKey: ["me"] });
      })
      .catch((err) => setState({ ok: false, text: errorText(err) }));
  }, [qc]);

  return (
    <AuthLayout title={state?.ok ? "Почта подтверждена" : state ? "Не получилось" : "Подтверждаю почту…"} subtitle={state?.ok ? "Готово" : ""}>
      {!state ? (
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-4">
          <p className={`flex items-start gap-2 rounded-lg p-3 text-sm ${state.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
            {state.ok && <MailCheck className="mt-0.5 size-4 shrink-0" />} {state.text}
          </p>
          <Button asChild className="w-full">
            <Link to={user ? "/account" : "/login"}>{user ? "В аккаунт" : "Ко входу"}</Link>
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
