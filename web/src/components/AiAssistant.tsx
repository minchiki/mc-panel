import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, CircleAlert, Loader2, Play, Puzzle, RotateCcw, Sparkles, SquareTerminal, Trash2, X } from "lucide-react";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth";
import { useServer } from "@/hooks/servers";
import { errorText, post } from "@/lib/api";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ types
interface Step {
  tool: string;
  label: string;
}
interface Action {
  kind: "install_addon" | "delete_addon" | "toggle_addon" | "power" | "command";
  title: string;
  source?: string;
  id?: string;
  file?: string;
  enabled?: boolean;
  action?: "start" | "stop" | "restart";
  command?: string;
  state?: "idle" | "running" | "done" | "error";
  note?: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  actions?: Action[];
  serverId?: string;
  error?: boolean;
}

// ------------------------------------------------------------------ context
interface AiApi {
  open: (prompt?: string) => void;
  toggle: () => void;
}
const AiContext = createContext<AiApi>({ open: () => {}, toggle: () => {} });
export const useAi = () => useContext(AiContext);

const storeKey = (uid: number) => `mcp-ai-chat-${uid}`;
function loadChat(uid: number): Msg[] {
  try {
    return JSON.parse(sessionStorage.getItem(storeKey(uid)) ?? "[]") as Msg[];
  } catch {
    return [];
  }
}
function saveChat(uid: number, msgs: Msg[]): void {
  try {
    sessionStorage.setItem(storeKey(uid), JSON.stringify(msgs.slice(-40)));
  } catch {
    /* storage full or blocked: the chat just won't survive a reload */
  }
}

const serverIdFrom = (path: string) => /^\/servers\/([^/]+)/.exec(path)?.[1]?.replace(/^new$/, "");

export function AiProvider({ children }: { children: ReactNode }) {
  const { user, settings } = useAuth();
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null);

  const api = useMemo<AiApi>(
    () => ({
      open: (prompt) => {
        setOpen(true);
        if (prompt) setDraft({ text: prompt, n: Date.now() });
      },
      toggle: () => setOpen((o) => !o),
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AiContext.Provider value={api}>
      {children}
      {user && isOpen && <AiPanel enabled={Boolean(settings?.ai)} isAdmin={user.role === "admin"} userId={user.id} draft={draft} onDraftUsed={() => setDraft(null)} onClose={() => setOpen(false)} />}
    </AiContext.Provider>
  );
}

// ------------------------------------------------------------------ trigger in the header
export function AiTrigger() {
  const { toggle } = useAi();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="group hidden h-9 w-56 items-center gap-2 rounded-lg border bg-muted/40 pl-2.5 pr-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/70 hover:text-foreground md:flex lg:w-64"
      >
        <span className="flex size-5 items-center justify-center rounded-md bg-gradient-to-br from-primary/80 to-emerald-600 text-white shadow-sm">
          <Sparkles className="size-3" />
        </span>
        <span className="flex-1 text-left">Спросить ИИ…</span>
        <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">{mac ? "⌘J" : "Ctrl J"}</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={toggle} aria-label="ИИ-помощник">
        <Sparkles />
      </Button>
    </>
  );
}

// ------------------------------------------------------------------ panel
const SUGGEST_SERVER = [
  "Почему сервер не запускается?",
  "Разбери последний краш и скажи, как исправить",
  "Поставь моды для оптимизации FPS и TPS",
  "Какие моды сейчас установлены?",
];
const SUGGEST_GENERAL = ["Как позвать друзей на сервер?", "Чем отличаются Paper, Fabric и Forge?", "Сколько памяти дать серверу с модами?", "Как сделать бэкап мира?"];

function AiPanel({ enabled, isAdmin, userId, draft, onDraftUsed, onClose }: { enabled: boolean; isAdmin: boolean; userId: number; draft: { text: string; n: number } | null; onDraftUsed: () => void; onClose: () => void }) {
  const location = useLocation();
  const serverId = serverIdFrom(location.pathname) || undefined;
  const { data: server } = useServer(serverId);
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>(() => loadChat(userId));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => saveChat(userId, msgs), [userId, msgs]);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(t);
  }, [busy]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);
  useEffect(() => {
    if (draft) {
      onDraftUsed();
      void send(draft.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.n]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy || !enabled) return;
      setInput("");
      const next: Msg[] = [...msgs, { role: "user", content: q, serverId }];
      setMsgs(next);
      setBusy(true);
      try {
        const history = next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content || "…" }));
        const res = await post<{ reply: string; steps: Step[]; actions: Action[] }>("/api/ai/chat", { serverId, messages: history.slice(-16) });
        setMsgs((m) => [...m, { role: "assistant", content: res.reply || "Готово.", steps: res.steps, actions: res.actions.map((a) => ({ ...a, state: "idle" })), serverId }]);
      } catch (err) {
        setMsgs((m) => [...m, { role: "assistant", content: errorText(err), error: true }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, enabled, msgs, serverId],
  );

  const runAction = async (mi: number, ai: number) => {
    const msg = msgs[mi];
    const a = msg?.actions?.[ai];
    if (!msg?.serverId || !a) return;
    const update = (patch: Partial<Action>) =>
      setMsgs((all) => all.map((m, i) => (i !== mi ? m : { ...m, actions: m.actions?.map((x, j) => (j === ai ? { ...x, ...patch } : x)) })));
    update({ state: "running" });
    const base = `/api/servers/${msg.serverId}`;
    try {
      if (a.kind === "install_addon") {
        const r = await post<{ file: string; restartNeeded: boolean }>(`${base}/addons/install`, { source: a.source, id: a.id });
        update({ state: "done", note: r.restartNeeded ? `${r.file} · нужен перезапуск` : r.file });
      } else if (a.kind === "delete_addon") {
        await post(`${base}/addons/delete`, { file: a.file });
        update({ state: "done" });
      } else if (a.kind === "toggle_addon") {
        await post(`${base}/addons/toggle`, { file: a.file, enabled: a.enabled });
        update({ state: "done" });
      } else if (a.kind === "power") {
        await post(`${base}/power`, { action: a.action });
        update({ state: "done" });
      } else {
        await post(`${base}/command`, { command: a.command });
        update({ state: "done" });
      }
      await qc.invalidateQueries();
    } catch (err) {
      update({ state: "error", note: errorText(err) });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const suggestions = server ? SUGGEST_SERVER : SUGGEST_GENERAL;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 lg:hidden" onClick={onClose} />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl animate-in slide-in-from-right duration-200 sm:w-[440px]"
        aria-label="ИИ-помощник"
      >
        {/* header */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <span className="relative flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-emerald-700 text-white shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.7)]">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold">ИИ-помощник</p>
            <p className="truncate text-xs text-muted-foreground">{server ? `${server.name} · ${server.core} ${server.mcVersion}` : "Откройте сервер, чтобы я видел его логи"}</p>
          </div>
          {msgs.length > 0 && (
            <Button variant="ghost" size="icon" onClick={() => setMsgs([])} aria-label="Новый чат" title="Новый чат">
              <RotateCcw />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X />
          </Button>
        </div>

        {/* messages */}
        <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-5 scrollbar-thin">
          {!enabled ? (
            <div className="mx-auto mt-10 max-w-xs space-y-3 text-center text-sm text-muted-foreground">
              <Sparkles className="mx-auto size-8 text-primary/70" />
              <p className="font-medium text-foreground">ИИ-помощник ещё не подключён</p>
              {isAdmin ? (
                <p>
                  Добавьте ключ OpenRouter в{" "}
                  <Link to="/admin/settings" className="text-primary underline" onClick={onClose}>
                    «Настройках панели»
                  </Link>
                  . Бесплатных моделей хватает.
                </p>
              ) : (
                <p>Попросите администратора панели включить его в настройках.</p>
              )}
            </div>
          ) : msgs.length === 0 ? (
            <div className="pt-6">
              <div className="mb-6 space-y-1.5">
                <p className="text-lg font-semibold tracking-tight">Чем помочь?</p>
                <p className="text-sm text-muted-foreground">
                  {server ? "Я вижу консоль, файлы и моды этого сервера. Могу найти причину ошибки и подобрать моды." : "Спросите про панель, сервер или моды."} Любое изменение выполняется только после вашей кнопки.
                </p>
              </div>
              <div className="stagger grid gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-xl border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end animate-rise">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2 text-sm">{m.content}</p>
                </div>
              ) : (
                <div key={i} className="space-y-2.5 animate-rise">
                  {m.steps && m.steps.length > 0 && (
                    <div className="space-y-1">
                      {m.steps.map((s, j) => (
                        <p key={j} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Check className="size-3.5 text-primary" /> {s.label}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className={cn("text-sm leading-relaxed", m.error && "flex gap-2 rounded-lg bg-destructive/10 p-3 text-destructive")}>
                    {m.error && <CircleAlert className="mt-0.5 size-4 shrink-0" />}
                    <RichText text={m.content} />
                  </div>
                  {m.actions?.map((a, j) => <ActionCard key={j} action={a} onRun={() => void runAction(i, j)} />)}
                </div>
              ),
            )
          )}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> {slow ? "Бесплатные модели иногда думают до минуты, ещё чуть-чуть…" : `Думаю${server ? " и смотрю сервер" : ""}…`}
            </p>
          )}
        </div>

        {/* input */}
        <div className="shrink-0 border-t p-3">
          <div className="rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              disabled={!enabled}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={server ? "Например: сервер падает после установки модов" : "Спросите что угодно про панель"}
              className="block max-h-40 min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
              <span className="truncate text-[11px] text-muted-foreground">{server ? `Контекст: ${server.name}` : "Без сервера"}</span>
              <Button size="icon" className="size-8 rounded-full" disabled={!input.trim() || busy || !enabled} onClick={() => void send(input)} aria-label="Отправить">
                <ArrowUp />
              </Button>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">ИИ может ошибаться. Действия выполняются только после вашего подтверждения.</p>
        </div>
      </aside>
    </>
  );
}

const ACTION_ICON = { install_addon: Puzzle, delete_addon: Trash2, toggle_addon: Puzzle, power: Play, command: SquareTerminal } as const;

function ActionCard({ action, onRun }: { action: Action; onRun: () => void }) {
  const Icon = ACTION_ICON[action.kind];
  const detail =
    action.kind === "command" ? `/${action.command}` : action.kind === "power" ? { start: "Запуск", stop: "Остановка", restart: "Перезапуск" }[action.action!] : action.file ?? action.source;
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", action.kind === "delete_addon" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{action.title}</p>
        <p className={cn("truncate text-xs", action.state === "error" ? "text-destructive" : "text-muted-foreground")}>{action.note ?? detail}</p>
      </div>
      {action.state === "done" ? (
        <span className="flex items-center gap-1 text-xs font-medium text-primary">
          <Check className="size-4" /> Готово
        </span>
      ) : (
        <Button size="sm" variant={action.kind === "delete_addon" ? "destructive" : "default"} loading={action.state === "running"} onClick={onRun}>
          {action.state === "error" ? "Ещё раз" : "Выполнить"}
        </Button>
      )}
    </div>
  );
}

/** Tiny, safe markdown: paragraphs, "-" lists, **bold**, `code` and ``` blocks. No HTML is ever injected. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/```[\w-]*\n?/);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) =>
        bi % 2 === 1 ? (
          <pre key={bi} className="overflow-x-auto rounded-lg bg-console p-3 font-mono text-xs text-zinc-200 scrollbar-thin">
            {block.replace(/\n$/, "")}
          </pre>
        ) : (
          <Fragment key={bi}>
            {block
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, pi) => {
                const lines = p.split("\n");
                const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s/.test(l) || !l.trim());
                return isList ? (
                  <ul key={pi} className="ml-4 list-disc space-y-1 marker:text-primary/70">
                    {lines
                      .filter((l) => l.trim())
                      .map((l, li) => (
                        <li key={li}>
                          <Inline text={l.replace(/^\s*([-*•]|\d+[.)])\s/, "")} />
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p key={pi} className="whitespace-pre-wrap">
                    <Inline text={p} />
                  </p>
                );
              })}
          </Fragment>
        ),
      )}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
