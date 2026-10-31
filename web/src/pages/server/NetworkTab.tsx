import { useQueryClient } from "@tanstack/react-query";
import { Globe, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { errorText, patch } from "@/lib/api";
import { useServerContext } from "./ServerLayout";

export default function NetworkTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const [port, setPort] = useState(String(server.port));
  const [domain, setDomain] = useState(server.domain ?? "");
  const [saving, setSaving] = useState(false);
  const ip = server.address.split(":")[0]!;
  const host = server.domain || ip;

  const save = async () => {
    setSaving(true);
    try {
      const res = await patch<{ restartNeeded: boolean }>(`/api/servers/${server.id}/network`, { port: Number(port), domain });
      toast.success("Сохранено", { description: res.restartNeeded ? "Новый порт заработает после перезапуска" : undefined });
      await qc.invalidateQueries({ queryKey: ["server", server.id] });
      await qc.invalidateQueries({ queryKey: ["servers"] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const srvName = domain ? `_minecraft._tcp.${domain}` : "_minecraft._tcp.play.example.com";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Адрес подключения</CardTitle>
          <CardDescription>Его игроки вводят в «Сетевая игра» → «Добавить сервер».</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-4">
            <Globe className="size-5 text-primary" />
            <span className="flex-1 truncate font-mono text-lg font-semibold">{server.address}</span>
            <CopyButton text={server.address} label="Скопировать" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Порт и домен</CardTitle>
            <CardDescription>Порт из диапазона 25565–25665. Сервер на 25565 подключается без номера порта.</CardDescription>
          </div>
          <Button onClick={() => void save()} loading={saving}>
            <Save /> Сохранить
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Порт">
            <Input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Домен (необязательно)" hint="Например, play.example.com. Его нужно настроить у регистратора, см. ниже.">
            <Input placeholder="play.example.com" value={domain} onChange={(e) => setDomain(e.target.value.trim())} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Как привязать домен</CardTitle>
          <CardDescription>В панели DNS вашего регистратора (REG.RU, Cloudflare и т.п.) создайте записи:</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-4 pl-5">
            <li>
              <p className="font-medium">A-запись на IP сервера</p>
              <div className="mt-2 grid gap-2 rounded-lg bg-muted/60 p-3 font-mono text-xs sm:grid-cols-3">
                <span>Имя: {domain || "play.example.com"}</span>
                <span>Тип: A</span>
                <span className="flex items-center gap-1">
                  Значение: {ip} <CopyButton text={ip} />
                </span>
              </div>
            </li>
            {server.port !== 25565 && (
              <li>
                <p className="font-medium">SRV-запись, чтобы не писать порт</p>
                <div className="mt-2 grid gap-2 rounded-lg bg-muted/60 p-3 font-mono text-xs sm:grid-cols-2">
                  <span className="flex items-center gap-1 break-all">
                    Имя: {srvName} <CopyButton text={srvName} />
                  </span>
                  <span>Тип: SRV</span>
                  <span>Приоритет: 0 · Вес: 5</span>
                  <span>Порт: {server.port}</span>
                  <span className="sm:col-span-2">Цель: {domain || "play.example.com"}</span>
                </div>
              </li>
            )}
            <li>Подождите 5–30 минут, пока записи разойдутся, и подключайтесь по {domain || "домену"}.</li>
          </ol>
          <p className="text-xs text-muted-foreground">Cloudflare: для A-записи выключите проксирование (серое облако), Minecraft через прокси Cloudflare не работает. Текущий хост: {host}.</p>
        </CardContent>
      </Card>
    </div>
  );
}
