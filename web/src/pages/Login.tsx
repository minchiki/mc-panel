import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { CreeperIcon } from "@/components/CreeperIcon";
import { Button } from "@/components/ui/button";
import { Card, Field, Input } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { errorText, post } from "@/lib/api";
import type { User } from "@/lib/types";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { settings } = useAuth();
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.18),transparent_60%)]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <CreeperIcon className="size-7" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Card className="p-6">{children}</Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">{settings?.panelName ?? "MC Panel"}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, settings } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await post<{ user?: User; needTotp?: boolean }>("/api/auth/login", { username, password, totp: needTotp ? totp : undefined });
      if (res.needTotp) {
        setNeedTotp(true);
        return;
      }
      qc.setQueryData(["me"], res.user);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={needTotp ? "Двухфакторная проверка" : "Вход в панель"} subtitle={needTotp ? "Введите 6 цифр из приложения-аутентификатора" : "Управление вашими Minecraft-серверами"}>
      <form onSubmit={submit} className="space-y-4">
        {!needTotp ? (
          <>
            <Field label="Имя пользователя" htmlFor="username">
              <Input id="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
            </Field>
            <Field label="Пароль" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          </>
        ) : (
          <Field label="Код 2FA" htmlFor="totp">
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              className="text-center font-mono text-lg tracking-[0.4em]"
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
              required
            />
          </Field>
        )}
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          {needTotp ? <ShieldCheck /> : <KeyRound />} {needTotp ? "Подтвердить" : "Войти"}
        </Button>
        {needTotp && (
          <Button type="button" variant="ghost" className="w-full" onClick={() => (setNeedTotp(false), setTotp(""))}>
            Назад
          </Button>
        )}
      </form>
      {settings?.registrationEnabled && !needTotp && (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Нет аккаунта?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, settings } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "", password2: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;
  if (settings && !settings.registrationEnabled) {
    return (
      <AuthLayout title="Регистрация закрыта" subtitle="Попросите администратора создать вам аккаунт">
        <Button asChild className="w-full">
          <Link to="/login">Ко входу</Link>
        </Button>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.password2) return setError("Пароли не совпадают");
    setError("");
    setLoading(true);
    try {
      const res = await post<{ user: User }>("/api/auth/register", { username: form.username, email: form.email, password: form.password });
      qc.setQueryData(["me"], res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthLayout title="Создать аккаунт" subtitle="Заполните поля, это займёт минуту">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Имя пользователя" hint="Латиница, цифры, _ . -, от 3 символов" htmlFor="r-username">
          <Input id="r-username" autoComplete="username" value={form.username} onChange={set("username")} required />
        </Field>
        <Field label="Email (необязательно)" htmlFor="r-email">
          <Input id="r-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Пароль" hint="Минимум 10 символов" htmlFor="r-password">
          <Input id="r-password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={10} />
        </Field>
        <Field label="Повторите пароль" htmlFor="r-password2">
          <Input id="r-password2" type="password" autoComplete="new-password" value={form.password2} onChange={set("password2")} required />
        </Field>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Зарегистрироваться
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Уже есть аккаунт?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Войти
        </Link>
      </p>
    </AuthLayout>
  );
}
