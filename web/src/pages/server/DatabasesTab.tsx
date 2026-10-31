import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Eye, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/CopyButton";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input } from "@/components/ui/primitives";
import { del, errorText, get, post } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useServerContext } from "./ServerLayout";

interface Db {
  id: number;
  name: string;
  username: string;
  createdAt: number;
}
interface Credentials {
  name: string;
  username: string;
  password: string;
  host: string;
  port: number;
  jdbc: string;
}

export default function DatabasesTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const base = `/api/servers/${server.id}/databases`;
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const data = useQuery({ queryKey: ["databases", server.id], queryFn: async () => (await get<{ databases: Db[] }>(base)).databases });
  const refresh = () => qc.invalidateQueries({ queryKey: ["databases", server.id] });

  const create = async () => {
    setCreating(true);
    try {
      const res = await post<{ restartNeeded: boolean }>(base, { name: label.trim() });
      setLabel("");
      toast.success("База создана", { description: res.restartNeeded ? "Перезапустите сервер, чтобы он увидел хост mcp-mariadb" : undefined });
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const reveal = async (db: Db) => {
    try {
      setCreds(await get<Credentials>(`${base}/${db.id}/credentials`));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const rotate = async (db: Db) => {
    if (!(await confirm({ title: "Сменить пароль?", description: "Старый пароль перестанет работать, обновите его в конфиге плагина.", confirmText: "Сменить" }))) return;
    try {
      await post(`${base}/${db.id}/rotate`);
      toast.success("Пароль изменён");
      await reveal(db);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (db: Db) => {
    const ok = await confirm({ title: `Удалить базу ${db.name}?`, description: "Все таблицы и данные будут удалены безвозвратно.", confirmText: "Удалить", destructive: true, typeToConfirm: db.name });
    if (!ok) return;
    try {
      await del(`${base}/${db.id}`);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (data.isLoading) return <Spinner />;
  const rows = creds
    ? [
        ["Хост", creds.host],
        ["Порт", String(creds.port)],
        ["База", creds.name],
        ["Пользователь", creds.username],
        ["Пароль", creds.password],
        ["JDBC URL", creds.jdbc],
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Базы данных MySQL / MariaDB</CardTitle>
        <CardDescription>Для плагинов вроде LuckPerms, CoreProtect, AuthMe. База доступна только этому серверу по адресу mcp-mariadb:3306.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input placeholder="Короткое имя, например luckperms" value={label} onChange={(e) => setLabel(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} maxLength={16} />
          <Button type="submit" loading={creating}>
            <Plus /> Создать базу
          </Button>
        </form>
        {creating && <p className="text-xs text-muted-foreground">Первая база запускает MariaDB, это может занять до минуты.</p>}
        {(data.data ?? []).length === 0 ? (
          <EmptyState icon={<Database />} title="Баз пока нет" description="Создайте базу и вставьте данные подключения в конфиг плагина." />
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.data!.map((db) => (
              <li key={db.id} className="flex flex-wrap items-center gap-3 p-3">
                <Database className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium">{db.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {db.username} · создана {formatDate(db.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void reveal(db)}>
                  <Eye /> Данные подключения
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void rotate(db)} aria-label="Сменить пароль">
                  <KeyRound />
                </Button>
                <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void remove(db)} aria-label="Удалить">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={creds !== null} onOpenChange={(o) => !o && setCreds(null)}>
        <DialogContent>
          <DialogHeader title="Данные подключения" description="Не показывайте пароль посторонним. Хост работает только изнутри сервера." />
          <dl className="divide-y rounded-lg border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 px-3 py-2">
                <dt className="w-28 shrink-0 text-xs text-muted-foreground">{k}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-sm">{v}</dd>
                <CopyButton text={v!} />
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
