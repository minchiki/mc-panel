import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { errorText, post, put } from "@/lib/api";
import type { User } from "@/lib/types";

/** Optional recovery email: add, change (confirmed by a link) or remove. */
export function EmailCard({ user }: { user: User }) {
  const { settings } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const mailOn = Boolean(settings?.passwordReset);
  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });

  const save = async (e: FormEvent, value = email) => {
    e.preventDefault();
    setLoading(true);
    try {
      await put("/api/auth/email", { email: value, password });
      toast.success(value ? `Письмо отправлено на ${value}: откройте ссылку, чтобы подтвердить` : "Почта удалена");
      setEditing(false);
      setEmail("");
      setPassword("");
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  const cancelPending = async () => {
    await post("/api/auth/email/cancel").catch(() => {});
    await refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" /> Почта
        </CardTitle>
        <CardDescription>Необязательно. Нужна, только чтобы восстановить пароль, если вы его забудете.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {user.email ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{user.email}</span>
            {user.emailVerified ? (
              <Badge>
                <CheckCircle2 className="mr-1 size-3" /> подтверждена
              </Badge>
            ) : (
              <Badge variant="secondary">не подтверждена</Badge>
            )}
          </div>
        ) : (
          !user.pendingEmail && <p className="text-sm text-muted-foreground">Почта не добавлена.</p>
        )}
        {user.pendingEmail && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
            <Clock className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Ждём подтверждения <b>{user.pendingEmail}</b>: откройте ссылку из письма (проверьте и «Спам»).
            </span>
            <Button size="sm" variant="ghost" onClick={() => void cancelPending()}>
              Отменить
            </Button>
          </div>
        )}
        {!mailOn && <p className="text-xs text-muted-foreground">Отправка почты на панели пока не настроена администратором, поэтому добавить почту сейчас нельзя.</p>}

        {mailOn && !editing && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Mail /> {user.email || user.pendingEmail ? "Изменить почту" : "Добавить почту"}
            </Button>
            {user.email && !user.emailVerified && (
              <Button variant="ghost" onClick={() => (setEmail(user.email!), setEditing(true))}>
                Подтвердить
              </Button>
            )}
          </div>
        )}
        {editing && (
          <form onSubmit={(e) => void save(e)} className="space-y-3 rounded-lg border p-3">
            <Field label="Почта">
              <Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Текущий пароль">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={loading}>
                Отправить письмо
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Отмена
              </Button>
              {user.email && (
                <Button type="button" variant="ghost" className="ml-auto text-destructive" disabled={!password || loading} onClick={(e) => void save(e as unknown as FormEvent, "")}>
                  Удалить почту
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
