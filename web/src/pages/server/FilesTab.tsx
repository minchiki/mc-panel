import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Download,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Link2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { lazy, Suspense, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";
import { Card, EmptyState, Input, Progress } from "@/components/ui/primitives";
import { errorText, get, post, put, upload } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import type { FileEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DangerZoneCard } from "./DangerZoneCard";
import { useServerContext } from "./ServerLayout";

const CodeEditor = lazy(() => import("@/components/CodeEditor"));
const EDITABLE = /\.(ya?ml|json5?|properties|toml|txt|cfg|conf|ini|sh|js|md|xml|log|mcmeta|secret|csv|lang)$/i;

type Prompt = { kind: "mkdir" | "newfile" | "rename" | "zip"; target?: FileEntry; paths?: string[] } | null;

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export default function FilesTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [dir, setDir] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [promptValue, setPromptValue] = useState("");
  const [editing, setEditing] = useState<{ path: string; content: string; original: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = `/api/servers/${server.id}/files`;

  const listing = useQuery({
    queryKey: ["files", server.id, dir],
    queryFn: async () => (await get<{ entries: FileEntry[] }>(`${base}?path=${encodeURIComponent(dir)}`)).entries,
  });
  const refresh = () => {
    setSelected(new Set());
    return qc.invalidateQueries({ queryKey: ["files", server.id] });
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
      void qc.invalidateQueries({ queryKey: ["server", server.id] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const open = async (entry: FileEntry) => {
    if (entry.type === "dir") return setDir(entry.path), setSelected(new Set());
    if (!EDITABLE.test(entry.name) && entry.size > 0) {
      window.location.href = `${base}/download?path=${encodeURIComponent(entry.path)}`;
      return;
    }
    try {
      const res = await get<{ content: string }>(`${base}/content?path=${encodeURIComponent(entry.path)}`);
      setEditing({ path: entry.path, content: res.content, original: res.content });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await put(`${base}/content`, { path: editing.path, content: editing.content });
      setEditing({ ...editing, original: editing.content });
      toast.success("Файл сохранён");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const closeEditor = async () => {
    if (editing && editing.content !== editing.original) {
      if (!(await confirm({ title: "Закрыть без сохранения?", description: "Несохранённые изменения пропадут.", confirmText: "Закрыть", destructive: true }))) return;
    }
    setEditing(null);
  };

  const doUpload = async (files: File[]) => {
    if (!files.length) return;
    setUploadPct(0);
    try {
      await upload(`${base}/upload?path=${encodeURIComponent(dir)}`, files, setUploadPct);
      toast.success(`Загружено файлов: ${files.length}`);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setUploadPct(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void doUpload(Array.from(e.dataTransfer.files));
  };

  const remove = async (paths: string[]) => {
    const ok = await confirm({
      title: paths.length === 1 ? `Удалить «${paths[0]!.split("/").pop()}»?` : `Удалить ${paths.length} объектов?`,
      description: "Папки удаляются вместе со всем содержимым. Восстановить можно только из бэкапа.",
      confirmText: "Удалить",
      destructive: true,
    });
    if (ok) await run(() => post(`${base}/delete`, { paths }), "Удалено");
  };

  const openPrompt = (p: NonNullable<Prompt>) => {
    setPrompt(p);
    setPromptValue(p.kind === "rename" ? (p.target?.name ?? "") : p.kind === "zip" ? "archive.zip" : "");
  };

  const submitPrompt = async () => {
    if (!prompt || !promptValue.trim()) return;
    const name = promptValue.trim();
    const p = prompt;
    setPrompt(null);
    if (p.kind === "mkdir") await run(() => post(`${base}/mkdir`, { path: joinPath(dir, name) }), "Папка создана");
    if (p.kind === "newfile") {
      await run(() => put(`${base}/content`, { path: joinPath(dir, name), content: "" }));
      setEditing({ path: joinPath(dir, name), content: "", original: "" });
    }
    if (p.kind === "rename" && p.target) await run(() => post(`${base}/rename`, { from: p.target!.path, to: joinPath(dir, name) }), "Переименовано");
    if (p.kind === "zip" && p.paths) await run(() => post(`${base}/zip`, { paths: p.paths, name }), "Архив создан");
  };

  const segments = dir ? dir.split("/") : [];
  const entries = listing.data ?? [];
  const allSelected = entries.length > 0 && selected.size === entries.length;

  if (editing) {
    const dirty = editing.content !== editing.original;
    return (
      <Card className="flex h-[75vh] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <FileText className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-sm">
            {editing.path}
            {dirty && <span className="ml-2 text-warning">● не сохранено</span>}
          </span>
          <Button variant="outline" size="sm" onClick={() => void closeEditor()}>
            Закрыть
          </Button>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
            Сохранить <span className="hidden text-xs opacity-70 sm:inline">Ctrl+S</span>
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<Spinner />}>
            <CodeEditor value={editing.content} fileName={editing.path} onChange={(content) => setEditing((e) => (e ? { ...e, content } : e))} onSave={() => void save()} />
          </Suspense>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
    <Card
      className={cn("relative overflow-hidden transition-colors", dragOver && "border-primary ring-2 ring-primary/30")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm scrollbar-thin">
          <button className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setDir("")}>
            <Home className="size-4" />
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-muted-foreground/60" />
              <button className="rounded-md px-1.5 py-1 hover:bg-accent" onClick={() => setDir(segments.slice(0, i + 1).join("/"))}>
                {seg}
              </button>
            </span>
          ))}
        </nav>
        {selected.size > 0 ? (
          <>
            <span className="text-sm text-muted-foreground">Выбрано: {selected.size}</span>
            <Button size="sm" variant="outline" onClick={() => openPrompt({ kind: "zip", paths: [...selected] })}>
              <Archive /> В архив
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void remove([...selected])}>
              <Trash2 /> Удалить
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => void refresh()} aria-label="Обновить">
              <RefreshCw />
            </Button>
            <Button size="sm" variant="outline" onClick={() => openPrompt({ kind: "newfile" })}>
              <FilePlus /> <span className="hidden sm:inline">Файл</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => openPrompt({ kind: "mkdir" })}>
              <FolderPlus /> <span className="hidden sm:inline">Папка</span>
            </Button>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload /> Загрузить
            </Button>
          </>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void doUpload(Array.from(e.target.files ?? [])).then(() => (e.target.value = ""))} />
      </div>

      {uploadPct !== null && (
        <div className="space-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
          Загрузка… {uploadPct}%
          <Progress value={uploadPct} />
        </div>
      )}

      {listing.isLoading ? (
        <Spinner />
      ) : listing.isError ? (
        <div className="p-6 text-sm text-destructive">{errorText(listing.error)}</div>
      ) : entries.length === 0 ? (
        <EmptyState className="m-4" icon={<Folder />} title="Папка пуста" description="Перетащите файлы сюда или нажмите «Загрузить»." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-[hsl(var(--primary))]"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.path)))}
                    aria-label="Выбрать все"
                  />
                </th>
                <th className="py-2 font-medium">Имя</th>
                <th className="hidden py-2 font-medium sm:table-cell">Размер</th>
                <th className="hidden py-2 font-medium md:table-cell">Изменён</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.path} className={cn("group border-b last:border-0 hover:bg-muted/50", selected.has(e.path) && "bg-primary/5")}>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={selected.has(e.path)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(e.path)) next.delete(e.path);
                        else next.add(e.path);
                        setSelected(next);
                      }}
                      aria-label={`Выбрать ${e.name}`}
                    />
                  </td>
                  <td className="py-2">
                    <button className="flex max-w-full items-center gap-2.5 text-left hover:text-primary" onClick={() => void open(e)}>
                      {e.type === "dir" ? (
                        <Folder className="size-4 shrink-0 fill-primary/20 text-primary" />
                      ) : e.type === "link" ? (
                        <Link2 className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <File className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{e.name}</span>
                    </button>
                  </td>
                  <td className="hidden py-2 tabular-nums text-muted-foreground sm:table-cell">{e.type === "file" ? formatBytes(e.size) : "—"}</td>
                  <td className="hidden py-2 text-muted-foreground md:table-cell">{formatDate(e.modifiedAt)}</td>
                  <td className="pr-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Действия">
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {e.type === "file" && EDITABLE.test(e.name) && (
                          <DropdownMenuItem onSelect={() => void open(e)}>
                            <Pencil /> Редактировать
                          </DropdownMenuItem>
                        )}
                        {e.type === "file" && (
                          <DropdownMenuItem asChild>
                            <a href={`${base}/download?path=${encodeURIComponent(e.path)}`}>
                              <Download /> Скачать
                            </a>
                          </DropdownMenuItem>
                        )}
                        {e.name.toLowerCase().endsWith(".zip") && (
                          <DropdownMenuItem onSelect={() => void run(() => post(`${base}/unzip`, { path: e.path }), "Архив распакован")}>
                            <ArchiveRestore /> Распаковать сюда
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => openPrompt({ kind: "zip", paths: [e.path] })}>
                          <Archive /> Заархивировать
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openPrompt({ kind: "rename", target: e })}>
                          <Pencil /> Переименовать
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => void remove([e.path])}>
                          <Trash2 /> Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/10 text-sm font-medium text-primary backdrop-blur-[1px]">
          <Upload className="mr-2 size-5" /> Отпустите, чтобы загрузить в /{dir}
        </div>
      )}

      <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader
            title={
              prompt?.kind === "mkdir" ? "Новая папка" : prompt?.kind === "newfile" ? "Новый файл" : prompt?.kind === "zip" ? "Создать архив" : "Переименовать"
            }
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitPrompt();
            }}
            className="space-y-4"
          >
            <Input autoFocus value={promptValue} onChange={(e) => setPromptValue(e.target.value)} placeholder="Имя" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPrompt(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!promptValue.trim()}>
                Готово
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
    <DangerZoneCard server={server} />
    </div>
  );
}
