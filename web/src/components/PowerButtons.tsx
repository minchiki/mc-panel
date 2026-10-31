import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCw, Skull, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Tooltip } from "@/components/ui/overlays";
import { errorText, post } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";

type Action = "start" | "stop" | "restart" | "kill";

export function PowerButtons({ server, compact, className }: { server: Server; compact?: boolean; className?: string }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: Action) => post<{ status: string }>(`/api/servers/${server.id}/power`, { action }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["server", server.id] }),
    onError: (err) => toast.error(errorText(err)),
  });

  if (!server.permissions?.includes("power")) return null;
  const s = server.status;
  const running = s === "online" || s === "starting";
  const busy = mutation.isPending || s === "stopping" || s === "installing";
  const canStart = (s === "offline" || s === "crashed") && server.installState === "installed";
  const size = compact ? "sm" : "default";
  const pending = mutation.isPending ? mutation.variables : null;

  const kill = async () => {
    if (await confirm({ title: `${t("power.kill")}?`, description: t("power.killHint"), confirmText: t("power.kill"), destructive: true })) {
      mutation.mutate("kill");
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {!running && s !== "stopping" ? (
        <Button size={size} disabled={!canStart || busy} loading={pending === "start"} onClick={() => mutation.mutate("start")}>
          <Play /> {t("power.start")}
        </Button>
      ) : (
        <Tooltip content={t("power.stopHint")}>
          <Button size={size} variant="secondary" disabled={busy} loading={pending === "stop"} onClick={() => mutation.mutate("stop")}>
            <Square /> {t("power.stop")}
          </Button>
        </Tooltip>
      )}
      <Tooltip content={t("power.restartHint")}>
        <Button size={size} variant="outline" disabled={!running || busy} loading={pending === "restart"} onClick={() => mutation.mutate("restart")}>
          <RotateCw /> {!compact && t("power.restart")}
        </Button>
      </Tooltip>
      {(running || s === "stopping") && (
        <Tooltip content={t("power.killHint")}>
          <Button size={size} variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={kill} aria-label={t("power.kill")}>
            <Skull />
            {!compact && <span className="hidden sm:inline">{t("power.kill")}</span>}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
