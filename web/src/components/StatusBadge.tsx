import { useI18n } from "@/lib/i18n";
import type { ServerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<ServerStatus, { dot: string; badge: string; pulse?: boolean }> = {
  online: { dot: "bg-success", badge: "bg-success/15 text-success" },
  starting: { dot: "bg-warning", badge: "bg-warning/15 text-warning", pulse: true },
  stopping: { dot: "bg-warning", badge: "bg-warning/15 text-warning", pulse: true },
  installing: { dot: "bg-sky-500", badge: "bg-sky-500/15 text-sky-500", pulse: true },
  crashed: { dot: "bg-destructive", badge: "bg-destructive/15 text-destructive" },
  offline: { dot: "bg-muted-foreground/60", badge: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status, size = "default", className }: { status: ServerStatus; size?: "default" | "lg"; className?: string }) {
  const { t } = useI18n();
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full font-medium",
        size === "lg" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs",
        s.badge,
        className,
      )}
    >
      <span className={cn("rounded-full", size === "lg" ? "size-2.5" : "size-2", s.dot, s.pulse && "animate-pulse-dot", status === "online" && "dot-live")} />
      {t(`status.${status}`)}
    </span>
  );
}
