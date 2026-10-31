import Anser from "anser";
import { ArrowDownToLine, ChevronRight, Download, Eraser, Pause, Play } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import { Card } from "@/components/ui/primitives";
import { get } from "@/lib/api";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/ws";
import { useServerContext } from "./ServerLayout";

const MAX_LINES = 1500;
const HISTORY_KEY = (id: string) => `mcp-cmd-history-${id}`;

const Line = memo(function Line({ text }: { text: string }) {
  const parts = Anser.ansiToJson(text, { use_classes: false, remove_empty: true });
  return (
    <div className="whitespace-pre-wrap break-all">
      {parts.length === 0
        ? " "
        : parts.map((p, i) => (
            <span
              key={i}
              style={{
                color: p.fg ? `rgb(${p.fg})` : undefined,
                backgroundColor: p.bg ? `rgb(${p.bg})` : undefined,
                fontWeight: p.decorations?.includes("bold") ? 600 : undefined,
              }}
            >
              {p.content}
            </span>
          ))}
    </div>
  );
});

function loadHistory(id: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY(id)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export default function ConsoleTab() {
  const server = useServerContext();
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadHistory(server.id));
  const [historyIdx, setHistoryIdx] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const canSend = server.status === "online" || server.status === "starting";

  useEffect(() => {
    setLines([]);
    const off = socket.on((evt) => {
      if (evt.type === "error") toast.error(evt.message);
      if (evt.type !== "console" || evt.serverId !== server.id) return;
      setLines((prev) => {
        const next = evt.replace ? evt.lines : [...prev, ...evt.lines];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    // The layout subscribed before this tab mounted, so fetch the backlog once.
    get<{ lines: string[] }>(`/api/servers/${server.id}/console`)
      .then((res) => setLines(res.lines))
      .catch(() => undefined);
    return off;
  }, [server.id]);

  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim().replace(/^\//, "");
    if (!cmd) return;
    if (!socket.send({ type: "command", serverId: server.id, command: cmd })) {
      toast.error("Нет соединения с панелью, команда не отправлена");
      return;
    }
    const next = [cmd, ...history.filter((h) => h !== cmd)].slice(0, 50);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY(server.id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setHistoryIdx(-1);
    setCommand("");
    setFollow(true);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      setCommand(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = historyIdx - 1;
      setHistoryIdx(Math.max(idx, -1));
      setCommand(idx >= 0 ? (history[idx] ?? "") : "");
    }
  };

  const downloadLog = () => {
    const blob = new Blob([lines.map((l) => Anser.ansiToText(l)).join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${server.name}-console-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="text-sm text-muted-foreground">
          {lines.length ? `${lines.length} строк` : "Здесь появится вывод сервера"}
        </p>
        <div className="flex items-center gap-1">
          <Tooltip content={follow ? "Пауза автопрокрутки" : "Включить автопрокрутку"}>
            <Button variant="ghost" size="icon" onClick={() => setFollow(!follow)} aria-label="Автопрокрутка">
              {follow ? <Pause /> : <Play />}
            </Button>
          </Tooltip>
          <Tooltip content="Очистить окно (на сервер не влияет)">
            <Button variant="ghost" size="icon" onClick={() => setLines([])} aria-label="Очистить">
              <Eraser />
            </Button>
          </Tooltip>
          <Tooltip content="Скачать то, что сейчас в консоли. Полные логи — в «Файлы» → logs">
            <Button variant="ghost" size="icon" onClick={downloadLog} aria-label="Скачать лог">
              <Download />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="relative">
        <div
          ref={box}
          onScroll={onScroll}
          className="h-[min(60vh,600px)] overflow-y-auto bg-console px-4 py-3 font-mono text-[12.5px] leading-relaxed text-zinc-200 scrollbar-thin"
          role="log"
          aria-live="polite"
        >
          {lines.length === 0 ? (
            <p className="text-zinc-500">
              {server.status === "offline" ? "Сервер выключен. Нажмите «Запустить», и здесь появится лог." : "Ожидаю вывод…"}
            </p>
          ) : (
            lines.map((l, i) => <Line key={i} text={l} />)
          )}
        </div>
        {!follow && (
          <Button size="sm" variant="secondary" className="absolute bottom-3 right-5 shadow-lg" onClick={() => setFollow(true)}>
            <ArrowDownToLine /> Вниз
          </Button>
        )}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t bg-console px-3 py-2">
        <ChevronRight className="size-4 shrink-0 text-primary" />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKey}
          disabled={!canSend || !server.permissions?.includes("console")}
          placeholder={canSend ? "Введите команду, например: say Привет (↑↓ история)" : "Сервер не запущен"}
          className={cn("h-9 flex-1 bg-transparent font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed")}
          autoComplete="off"
          spellCheck={false}
          maxLength={1000}
        />
        <Button type="submit" size="sm" disabled={!canSend || !command.trim()}>
          Отправить
        </Button>
      </form>
    </Card>
  );
}
