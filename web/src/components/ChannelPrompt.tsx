import { Send } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/overlays";
import { useI18n } from "@/lib/i18n";

export const CHANNEL_URL = "https://t.me/huicoding";
const SEEN_KEY = "mcp-channel-seen";

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the prompt will show again next visit */
  }
}

/** One-time ask to subscribe to the author's channel, shown on the first visit from this browser. */
export function ChannelPrompt() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => !alreadySeen());

  const close = () => {
    markSeen();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm text-center">
        <div className="flex flex-col items-center gap-4">
          <Logo className="size-16 drop-shadow-[0_6px_16px_hsl(var(--primary)/0.35)]" />
          <DialogHeader title={t("channel.title")} description={t("channel.text")} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("channel.later")}
          </Button>
          <Button asChild onClick={close}>
            <a href={CHANNEL_URL} target="_blank" rel="noreferrer">
              <Send /> {t("channel.subscribe")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
