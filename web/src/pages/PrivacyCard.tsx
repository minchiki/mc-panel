import { useQueryClient } from "@tanstack/react-query";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { errorText, post } from "@/lib/api";
import type { User } from "@/lib/types";

/** 152-FZ rights in one place: see what the panel keeps about you, or withdraw consent by deleting the account. */
export function PrivacyCard({ user }: { user: User }) {
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/auth/my-data", { credentials: "same-origin", headers: { "X-Requested-With": "mc-panel" } });
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mc-panel-${user.username}-data.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" /> Мои данные
        </CardTitle>
        <CardDescription>
          По закону о персональных данных вы можете узнать, что о вас хранит панель, и отозвать согласие, удалив аккаунт. Подробнее в{" "}
          <Link to="/privacy" className="text-primary hover:underline">
            политике
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void download()} loading={downloading}>
          <Download /> Скачать мои данные
        </Button>
        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Удалить аккаунт
        </Button>
      </CardContent>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: "", totp: "", confirm: "" });
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await post<{ ok?: boolean; needTotp?: boolean }>("/api/auth/delete-account", { password: form.password, totp: form.totp || undefined, confirm: form.confirm.trim() });
      if (res.needTotp) return setNeedTotp(true);
      qc.clear();
      toast.success("Аккаунт и данные о нём удалены");
      navigate("/login", { replace: true });
      window.location.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title="Удалить аккаунт навсегда?"
          description="Удалятся логин, почта, сессии, API-ключи, доступы к чужим серверам и журнал ваших действий. Вернуть их будет нельзя. Свои серверы сначала удалите или передайте."
        />
        <form onSubmit={submit} className="space-y-3">
          <Field label="Пароль" htmlFor="da-pass">
            <Input id="da-pass" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoFocus />
          </Field>
          {needTotp && (
            <Field label="Код 2FA" htmlFor="da-totp">
              <Input id="da-totp" inputMode="numeric" maxLength={7} value={form.totp} onChange={(e) => setForm({ ...form, totp: e.target.value.replace(/\D/g, "") })} required />
            </Field>
          )}
          <Field label="Впишите УДАЛИТЬ, чтобы подтвердить" htmlFor="da-confirm">
            <Input id="da-confirm" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} placeholder="УДАЛИТЬ" required />
          </Field>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" variant="destructive" loading={loading} disabled={form.confirm.trim() !== "УДАЛИТЬ" || !form.password}>
              Удалить аккаунт
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
