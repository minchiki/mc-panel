import { useQueryClient } from "@tanstack/react-query";
import { Globe, PackageX, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { CollapsibleCard } from "@/components/ui/primitives";
import { errorText, post } from "@/lib/api";
import type { Server } from "@/lib/types";

const MOD_CORES = ["fabric", "forge", "neoforge"];

export function DangerZoneCard({ server }: { server: Server }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"world" | "addons" | null>(null);
  const base = `/api/servers/${server.id}/files`;
  const isMods = MOD_CORES.includes(server.core);
  const addonsNoun = isMods ? "моды" : "плагины";
  const canResetAddons = server.core !== "vanilla" && (server.isOwner || server.permissions?.includes("plugins"));

  const refreshAll = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["files", server.id] }),
      qc.invalidateQueries({ queryKey: ["addons", server.id] }),
      qc.invalidateQueries({ queryKey: ["modlist", server.id] }),
      qc.invalidateQueries({ queryKey: ["server", server.id] }),
    ]);

  const resetWorld = async () => {
    const ok = await confirm({
      title: "Пересоздать мир?",
      description: "Сервер остановится, перед удалением сделается бэкап. Папки мира (обычный, Незер, Энд) будут удалены — при следующем запуске создастся новый мир.",
      confirmText: "Пересоздать",
      destructive: true,
      typeToConfirm: server.name,
    });
    if (!ok) return;
    setBusy("world");
    try {
      const res = await post<{ removed: string[] }>(`${base}/reset-world`, { backupFirst: true });
      toast.success("Мир удалён", { description: `Удалено: ${res.removed.join(", ")}. Запустите сервер — сгенерируется новый мир.` });
      await refreshAll();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const resetAddons = async () => {
    const ok = await confirm({
      title: `Сбросить ${addonsNoun}?`,
      description: `Сервер остановится, все jar-файлы из папки ${isMods ? "mods" : "plugins"}/ будут удалены, пресет «Сборки по списку» и zip для игроков — тоже. Конфиги останутся.`,
      confirmText: "Сбросить",
      destructive: true,
    });
    if (!ok) return;
    setBusy("addons");
    try {
      const res = await post<{ removed: number }>(`${base}/reset-addons`);
      toast.success(`Удалено файлов: ${res.removed}`);
      await refreshAll();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <CollapsibleCard
      className="border-destructive/30"
      title={
        <>
          <TriangleAlert className="size-4 text-destructive" /> Опасная зона
        </>
      }
      description="Необратимые действия с миром и модами. Сервер будет остановлен."
    >
      <div className="divide-y rounded-lg border">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Пересоздать мир</p>
            <p className="text-xs text-muted-foreground">Удаляет текущий мир, сначала делает бэкап. Настройки, игроки в whitelist и {addonsNoun} сохранятся.</p>
          </div>
          <Button variant="destructive" size="sm" loading={busy === "world"} disabled={busy !== null} onClick={() => void resetWorld()}>
            <Globe /> Пересоздать мир
          </Button>
        </div>
        {canResetAddons && (
          <div className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Сбросить {addonsNoun}</p>
              <p className="text-xs text-muted-foreground">Удаляет все установленные {addonsNoun}, чтобы начать сборку заново. Мир не трогается.</p>
            </div>
            <Button variant="destructive" size="sm" loading={busy === "addons"} disabled={busy !== null} onClick={() => void resetAddons()}>
              <PackageX /> Сбросить {addonsNoun}
            </Button>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
