import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Loader2, PackageOpen, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { coreName, PackPicker, PackSummary } from "@/components/ModpackPicker";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/overlays";
import { CollapsibleCard, Progress } from "@/components/ui/primitives";
import { errorText, get, post } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { PackInfo, PackJob, Server } from "@/lib/types";

interface PackState {
  job: PackJob | null;
  installed: { name: string; version: string; core: string; mcVersion: string; installedAt: number } | null;
  playerPack: { size: number } | null;
}

export function ModpackCard({ server }: { server: Server }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [pack, setPack] = useState<PackInfo | null>(null);
  const [backupFirst, setBackupFirst] = useState(true);
  const [clearMods, setClearMods] = useState(true);
  const [starting, setStarting] = useState(false);
  const base = `/api/servers/${server.id}/mrpack`;
  const state = useQuery({
    queryKey: ["mrpack", server.id],
    queryFn: () => get<PackState>(base),
    refetchInterval: (q) => (q.state.data?.job?.state === "running" ? 1500 : false),
  });
  const job = state.data?.job;
  const running = job?.state === "running";
  const switching = pack && (pack.core !== server.core || pack.mcVersion !== server.mcVersion);
  const canInstall = server.isOwner !== false;

  const install = async () => {
    if (!pack) return;
    const ok = await confirm({
      title: `Установить ${pack.name} ${pack.version}?`,
      description: [
        "Сервер будет остановлен.",
        switching ? `Ядро сменится: ${coreName(server.core)} ${server.mcVersion} → ${coreName(pack.core)} ${pack.mcVersion}.` : "",
        switching && pack.mcVersion !== server.mcVersion ? "Мир от другой версии Minecraft может не открыться: на понижение версии мир не рассчитан." : "",
        clearMods ? "Текущие моды переедут в папку mods.old-…" : "",
        backupFirst ? "Перед установкой сделаем бэкап." : "Бэкап делаться не будет.",
      ]
        .filter(Boolean)
        .join(" "),
      confirmText: "Установить",
      destructive: Boolean(switching),
    });
    if (!ok) return;
    setStarting(true);
    try {
      await post(base, { packId: pack.id, backupFirst, clearMods });
      setPack(null);
      toast.info("Установка сборки началась, ход виден здесь и в консоли");
      await qc.invalidateQueries({ queryKey: ["mrpack", server.id] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setStarting(false);
    }
  };

  const installed = state.data?.installed;
  return (
    <CollapsibleCard
      defaultOpen={running || !installed}
      title={
        <>
          <PackageOpen className="size-4 text-primary" /> Сборка модов (.mrpack)
        </>
      }
      description={
        installed
          ? `Сейчас стоит ${installed.name} ${installed.version} (${coreName(installed.core)} ${installed.mcVersion}), установлена ${formatDate(installed.installedAt)}.`
          : "Загрузите готовую сборку Modrinth: панель сама поставит нужное ядро и версию, скачает серверные моды и настройки, а клиентские пропустит."
      }
    >
      <div className="space-y-4">
        {installed && state.data?.playerPack && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Сборка для игроков</p>
              <p className="text-xs text-muted-foreground">
                Тот же .mrpack ({formatBytes(state.data.playerPack.size)}): импортируйте в Modrinth App, Prism Launcher или ATLauncher и подключайтесь к {server.address}.
              </p>
            </div>
            <Button asChild size="sm">
              <a href={`${base}/download`}>
                <Download /> Скачать .mrpack
              </a>
            </Button>
          </div>
        )}

        {job && (running || job.state === "failed" || Date.now() - job.startedAt < 15 * 60_000) && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              {running ? <Loader2 className="size-4 animate-spin text-primary" /> : job.state === "done" ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-destructive" />}
              {job.pack}: {running ? "устанавливается" : job.state === "done" ? "установлена" : "ошибка"}
            </p>
            {running && job.total > 0 && <Progress value={(job.done / job.total) * 100} />}
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-console p-2.5 font-mono text-xs text-zinc-300 scrollbar-thin">
              {job.log.slice(-12).join("\n").replace(/\x1b\[[0-9;]*m/g, "") || "Жду своей очереди (сервер ещё устанавливается или останавливается)…"}
            </pre>
          </div>
        )}

        {!running && canInstall && (
          <>
            {pack ? <PackSummary pack={pack} onClear={() => setPack(null)} /> : <PackPicker onPicked={setPack} />}
            {pack && switching && (
              <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Сборке нужен {coreName(pack.core)} {pack.mcVersion}, а сервер сейчас {coreName(server.core)} {server.mcVersion}. Панель переустановит ядро. Если мир делался на другой версии,
                надёжнее поставить сборку на новый сервер: «Создать сервер» → «Из сборки».
              </p>
            )}
            {pack && (
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3 text-sm">
                  Сделать бэкап перед установкой <Switch checked={backupFirst} onCheckedChange={setBackupFirst} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  Убрать моды, которые стоят сейчас (в папку mods.old-…) <Switch checked={clearMods} onCheckedChange={setClearMods} />
                </label>
                <Button className="w-full" loading={starting} onClick={() => void install()}>
                  <PackageOpen /> Установить сборку
                </Button>
              </div>
            )}
          </>
        )}
        {!canInstall && <p className="text-xs text-muted-foreground">Ставить сборку может только владелец сервера.</p>}
      </div>
    </CollapsibleCard>
  );
}
