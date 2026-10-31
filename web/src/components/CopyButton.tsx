import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { copyText, cn } from "@/lib/utils";

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else toast.error("Не удалось скопировать");
      }}
      className={cn("inline-flex items-center gap-1.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", className)}
      aria-label={label ?? "Скопировать"}
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {label && <span className="text-xs">{label}</span>}
    </button>
  );
}
