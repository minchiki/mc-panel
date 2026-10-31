import { Loader2 } from "lucide-react";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex min-h-[40vh] items-center justify-center"}>
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
