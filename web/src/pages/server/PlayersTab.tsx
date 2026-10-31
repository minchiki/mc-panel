import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Crown, DoorOpen, ShieldOff, UserMinus, UserPlus, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Tooltip } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input } from "@/components/ui/primitives";
import { errorText, get, post } from "@/lib/api";
import { formatDate, formatDuration } from "@/lib/format";
import { useServerContext } from "./ServerLayout";

interface PlayersData {
  online: string[];
  known: { player: string; last_seen: number; sessions: number; total_ms: number }[];
  history: { player: string; joined_at: number; left_at: number | null }[];
  whitelist: { name: string }[];
  ops: { name: string; level?: number }[];
  bannedPlayers: { name: string; reason?: string }[];
  bannedIps: { ip: string; reason?: string }[];
}

type Action = "kick" | "ban" | "pardon" | "op" | "deop" | "whitelist-add" | "whitelist-remove" | "ban-ip" | "pardon-ip";

function Avatar({ name }: { name: string }) {
  // Initial-based avatar: no third-party skin service is contacted.
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-bold uppercase text-primary">{name.slice(0, 2)}</span>
  );
}

function ListCard({ title, description, empty, children }: { title: string; description?: string; empty: string; children: ReactNode[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children.length ? <ul className="divide-y">{children}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  );
}

export default function PlayersTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [newName, setNewName] = useState("");
  const data = useQuery({ queryKey: ["players", server.id], queryFn: () => get<PlayersData>(`/api/servers/${server.id}/players`), refetchInterval: 15_000 });
  const online = server.status === "online";

  const act = async (action: Action, target: string, opts?: { confirmTitle?: string; reason?: boolean }) => {
    if (opts?.confirmTitle && !(await confirm({ title: opts.confirmTitle, confirmText: "Да", destructive: true }))) return;
    try {
      await post(`/api/servers/${server.id}/players/action`, { action, target });
      toast.success("Команда отправлена");
      setTimeout(() => void qc.invalidateQueries({ queryKey: ["players", server.id] }), 800);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (data.isLoading) return <Spinner />;
  if (!data.data) return null;
  const d = data.data;
  const offlineHint = online ? undefined : "Сервер выключен: управление игроками работает через консоль игры, запустите сервер.";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Сейчас онлайн · {server.players.length}</CardTitle>
          {offlineHint && <CardDescription>{offlineHint}</CardDescription>}
        </CardHeader>
        <CardContent>
          {server.players.length === 0 ? (
            <EmptyState icon={<Users />} title="Никого нет" description={online ? `Подключение: ${server.address}` : undefined} className="py-8" />
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {server.players.map((p) => (
                <li key={p} className="flex items-center gap-3 rounded-lg border p-2.5">
                  <Avatar name={p} />
                  <span className="min-w-0 flex-1 truncate font-medium">{p}</span>
                  <Tooltip content="Выдать OP">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => void act("op", p)} aria-label="OP">
                      <Crown />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Кикнуть">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => void act("kick", p)} aria-label="Кик">
                      <DoorOpen />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Забанить">
                    <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => void act("ban", p, { confirmTitle: `Забанить ${p}?` })} aria-label="Бан">
                      <Ban />
                    </Button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) void act("whitelist-add", newName.trim()).then(() => setNewName(""));
            }}
          >
            <Input placeholder="Ник игрока" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={16} className="sm:max-w-xs" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline" disabled={!online || !newName.trim()}>
                <UserPlus /> В вайтлист
              </Button>
              <Button type="button" variant="outline" disabled={!online || !newName.trim()} onClick={() => void act("op", newName.trim())}>
                <Crown /> OP
              </Button>
              <Button type="button" variant="outline" disabled={!online || !newName.trim()} onClick={() => void act("ban", newName.trim(), { confirmTitle: `Забанить ${newName}?` })}>
                <Ban /> Бан
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ListCard title="Вайтлист" description="Включается в «Настройки» → white-list" empty="Список пуст">
          {d.whitelist.map((w) => (
            <li key={w.name} className="flex items-center gap-2 py-2">
              <Avatar name={w.name} />
              <span className="flex-1 truncate text-sm">{w.name}</span>
              <Button variant="ghost" size="icon" className="size-8" disabled={!online} onClick={() => void act("whitelist-remove", w.name)} aria-label="Убрать">
                <UserMinus />
              </Button>
            </li>
          ))}
        </ListCard>
        <ListCard title="Операторы" empty="Нет операторов">
          {d.ops.map((o) => (
            <li key={o.name} className="flex items-center gap-2 py-2">
              <Avatar name={o.name} />
              <span className="flex-1 truncate text-sm">{o.name}</span>
              <Button variant="ghost" size="icon" className="size-8" disabled={!online} onClick={() => void act("deop", o.name)} aria-label="Снять OP">
                <ShieldOff />
              </Button>
            </li>
          ))}
        </ListCard>
        <ListCard title="Баны" empty="Никто не забанен">
          {[
            ...d.bannedPlayers.map((b) => (
              <li key={`p-${b.name}`} className="flex items-center gap-2 py-2">
                <Avatar name={b.name} />
                <span className="flex-1 truncate text-sm" title={b.reason}>
                  {b.name}
                </span>
                <Button variant="ghost" size="sm" disabled={!online} onClick={() => void act("pardon", b.name)}>
                  Разбанить
                </Button>
              </li>
            )),
            ...d.bannedIps.map((b) => (
              <li key={`ip-${b.ip}`} className="flex items-center gap-2 py-2">
                <span className="flex-1 truncate font-mono text-sm">{b.ip}</span>
                <Button variant="ghost" size="sm" disabled={!online} onClick={() => void act("pardon-ip", b.ip)}>
                  Разбанить
                </Button>
              </li>
            )),
          ]}
        </ListCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>История заходов</CardTitle>
          <CardDescription>Последние 100 сессий, собираются из лога сервера</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {d.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока никто не заходил.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Игрок</th>
                  <th className="py-2 font-medium">Зашёл</th>
                  <th className="py-2 font-medium">Длительность</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 font-medium">{h.player}</td>
                    <td className="py-2 text-muted-foreground">{formatDate(h.joined_at)}</td>
                    <td className="py-2 text-muted-foreground">{h.left_at ? formatDuration(h.left_at - h.joined_at) : <span className="text-success">в игре</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
