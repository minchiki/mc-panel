import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter, DialogHeader, Switch } from "@/components/ui/overlays";
import { Badge, Card, Field, Input, Select } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { del, errorText, get, patch, post, put } from "@/lib/api";
import { formatDate, formatMb } from "@/lib/format";
import type { Role, User } from "@/lib/types";

type Row = User & { servers: number };
interface Draft {
  id?: number;
  username: string;
  email: string;
  password: string;
  role: Role;
  maxServers: number;
  maxRamMb: number;
  disabled: boolean;
  resetTotp: boolean;
}

export default function AdminUsers() {
  useCrumbs([{ label: "Администрирование" }, { label: "Пользователи" }]);
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: async () => (await get<{ users: Row[] }>("/api/admin/users")).users });
  const registration = useQuery({ queryKey: ["admin-settings"], queryFn: () => get<{ settings: { registrationEnabled: boolean } }>("/api/admin/settings") });

  const save = async () => {
    if (!draft) return;
    try {
      if (draft.id) {
        await patch(`/api/admin/users/${draft.id}`, {
          role: draft.role,
          maxServers: draft.maxServers,
          maxRamMb: draft.maxRamMb,
          disabled: draft.disabled,
          password: draft.password || undefined,
          resetTotp: draft.resetTotp || undefined,
        });
      } else {
        await post("/api/admin/users", { username: draft.username, email: draft.email, password: draft.password, role: draft.role, maxServers: draft.maxServers, maxRamMb: draft.maxRamMb });
      }
      toast.success("Сохранено");
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (u: Row) => {
    if (!(await confirm({ title: `Удалить ${u.username}?`, description: "Сначала удалите или передайте его серверы.", confirmText: "Удалить", destructive: true }))) return;
    try {
      await del(`/api/admin/users/${u.id}`);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const toggleRegistration = async (enabled: boolean) => {
    if (
      enabled &&
      !(await confirm({
        title: "Открыть регистрацию для всех?",
        description:
          "Любой, кто знает адрес, сможет создать аккаунт. По закону 406-ФЗ российских пользователей сайта с регистрацией нужно подтверждать по российскому номеру телефона или через Госуслуги, а панель этого не умеет. Для своих друзей надёжнее оставить регистрацию закрытой и создавать аккаунты вручную.",
        confirmText: "Всё равно открыть",
      }))
    )
      return;
    try {
      await put("/api/admin/settings", { registrationEnabled: enabled });
      await registration.refetch();
      void qc.invalidateQueries({ queryKey: ["public-settings"] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Пользователи"
        actions={
          <>
            <label className="flex items-center gap-2 rounded-lg border px-3 text-sm">
              <Switch checked={registration.data?.settings.registrationEnabled ?? false} onCheckedChange={(c) => void toggleRegistration(c)} /> Открытая регистрация
            </label>
            <Button onClick={() => setDraft({ username: "", email: "", password: "", role: "user", maxServers: 3, maxRamMb: 4096, disabled: false, resetTotp: false })}>
              <Plus /> Пользователь
            </Button>
          </>
        }
      />
      {users.isLoading ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-3 font-medium">Пользователь</th>
                <th className="py-3 font-medium">Роль</th>
                <th className="hidden py-3 font-medium sm:table-cell">Серверы</th>
                <th className="hidden py-3 font-medium md:table-cell">Лимит памяти</th>
                <th className="hidden py-3 font-medium lg:table-cell">2FA</th>
                <th className="hidden py-3 font-medium lg:table-cell">Создан</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">
                      {u.username} {u.disabled && <Badge variant="destructive">отключён</Badge>}
                    </div>
                    {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                  </td>
                  <td className="py-2.5">{u.role === "admin" ? <Badge>админ</Badge> : <Badge variant="secondary">пользователь</Badge>}</td>
                  <td className="hidden py-2.5 sm:table-cell">
                    {u.servers} / {u.maxServers}
                  </td>
                  <td className="hidden py-2.5 md:table-cell">{formatMb(u.maxRamMb)}</td>
                  <td className="hidden py-2.5 lg:table-cell">{u.totpEnabled ? "да" : "нет"}</td>
                  <td className="hidden py-2.5 text-muted-foreground lg:table-cell">{formatDate(u.createdAt)}</td>
                  <td className="pr-3 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDraft({ id: u.id, username: u.username, email: u.email ?? "", password: "", role: u.role, maxServers: u.maxServers, maxRamMb: u.maxRamMb, disabled: u.disabled, resetTotp: false })}
                      aria-label="Изменить"
                    >
                      <Pencil />
                    </Button>
                    {u.id !== me?.id && (
                      <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(u)} aria-label="Удалить">
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader title={draft?.id ? `Пользователь ${draft.username}` : "Новый пользователь"} />
          {draft && (
            <div className="space-y-4">
              {!draft.id && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Имя">
                    <Input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                  </Field>
                </div>
              )}
              <Field label={draft.id ? "Новый пароль (оставьте пустым, чтобы не менять)" : "Пароль"} hint="Минимум 10 символов">
                <Input type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Роль">
                  <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                    <option value="user">Пользователь</option>
                    <option value="admin">Администратор</option>
                  </Select>
                </Field>
                <Field label="Макс. серверов">
                  <Input type="number" min={0} value={draft.maxServers} onChange={(e) => setDraft({ ...draft, maxServers: Number(e.target.value) })} />
                </Field>
                <Field label="Память всего, МБ">
                  <Input type="number" min={0} step={512} value={draft.maxRamMb} onChange={(e) => setDraft({ ...draft, maxRamMb: Number(e.target.value) })} />
                </Field>
              </div>
              {draft.id && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={draft.disabled} onCheckedChange={(c) => setDraft({ ...draft, disabled: c })} /> Отключить вход
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={draft.resetTotp} onCheckedChange={(c) => setDraft({ ...draft, resetTotp: c })} /> Сбросить 2FA (если потерян телефон)
                  </label>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Отмена
                </Button>
                <Button onClick={() => void save()}>Сохранить</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
