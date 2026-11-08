import { useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/overlays";
import { Field, Input } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { errorText, put } from "@/lib/api";

const KEY = "mcp-email-prompt";
const LATER_MS = 7 * 24 * 3600_000;

function snoozed(userId: number): boolean {
  try {
    const v = localStorage.getItem(`${KEY}-${userId}`);
    return v === "never" || (v !== null && Number(v) > Date.now());
  } catch {
    return true;
  }
}
function snooze(userId: number, value: "never" | number): void {
  try {
    localStorage.setItem(`${KEY}-${userId}`, String(value));
  } catch {
    /* private mode: it will ask again next time */
  }
}
const channelPromptDone = () => {
  try {
    return localStorage.getItem("mcp-channel-seen") === "1";
  } catch {
    return true;
  }
};

/**
 * A gentle, skippable suggestion to add an email for password recovery.
 * Shown only when the panel can send mail, the account has no confirmed or pending address,
 * and the user hasn't snoozed it. Never blocks anything.
 */
export function EmailPrompt() {
  const { user, settings } = useAuth();
  const qc = useQueryClient();
  const location = useLocation();
  const [closed, setClosed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const show =
    !closed &&
    Boolean(settings?.passwordReset) &&
    Boolean(user) &&
    !user!.emailVerified &&
    !user!.pendingEmail &&
    !location.pathname.startsWith("/confirm-email") &&
    channelPromptDone() &&
    !snoozed(user!.id);
  if (!show || !user) return null;

  const later = () => {
    snooze(user.id, Date.now() + LATER_MS);
    setClosed(true);
  };
  const never = () => {
    snooze(user.id, "never");
    setClosed(true);
    toast.info("Хорошо, не будем напоминать. Почту всегда можно добавить в «Аккаунте».");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await put("/api/auth/email", { email, password });
      toast.success(`Письмо отправлено на ${email}. Откройте ссылку в нём, чтобы подтвердить почту.`);
      setClosed(true);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && later()}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Mail className="size-7" />
          </span>
          <DialogHeader
            title="Добавить почту на всякий случай?"
            description="Если забудете пароль, восстановите его по ссылке из письма. Это необязательно: почту видите только вы и администратор."
          />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Почта" htmlFor="ep-email">
            <Input id="ep-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Текущий пароль" hint="Чтобы никто другой не поменял почту за вас" htmlFor="ep-pass">
            <Input id="ep-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            <Mail /> Добавить и подтвердить
          </Button>
        </form>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={never}>
            Не напоминать
          </Button>
          <Button variant="outline" size="sm" onClick={later}>
            Позже
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
