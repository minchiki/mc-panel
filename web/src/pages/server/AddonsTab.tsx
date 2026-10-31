import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2, Package, Puzzle, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input } from "@/components/ui/primitives";
import { errorText, get, post, upload } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ModListBuilder } from "./ModListBuilder";
import { useServerContext } from "./ServerLayout";

type Source = "modrinth" | "curseforge" | "hangar" | "spiget";
const SOURCE_NAMES: Record<Source, string> = { modrinth: "Modrinth", curseforge: "CurseForge", hangar: "Hangar (PaperMC)", spiget: "SpigotMC" };

interface Installed {
  file: string;
  name: string;
  enabled: boolean;
  sizeBytes: number;
}
interface CatalogItem {
  source: Source;
  id: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon: string | null;
  url: string;
}

function compact(n: number): string {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export default function AddonsTab() {
  const server = useServerContext();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const base = `/api/servers/${server.id}/addons`;
  const [source, setSource] = useState<Source | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const info = useQuery({ queryKey: ["addons", server.id], queryFn: () => get<{ dir: string; sources: Source[]; installed: Installed[] }>(base) });
  const activeSource = source ?? info.data?.sources[0] ?? null;
  const isMods = info.data?.dir === "mods";
  const noun = isMods ? "мод" : "плагин";

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    queryKey: ["addon-search", server.id, activeSource, debounced],
    queryFn: async () => (await get<{ items: CatalogItem[] }>(`${base}/search?source=${activeSource}&q=${encodeURIComponent(debounced)}`)).items,
    enabled: Boolean(activeSource),
    staleTime: 60_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["addons", server.id] });

  const install = async (item: CatalogItem) => {
    setInstalling(item.id);
    try {
      const res = await post<{ file: string; restartNeeded: boolean }>(`${base}/install`, { source: item.source, id: item.id });
      toast.success(`Установлен ${res.file}`, { description: res.restartNeeded ? "Перезапустите сервер, чтобы он загрузился" : undefined });
      await refresh();
    } catch (err) {
      toast.error(errorText(err), { duration: 10_000 });
    } finally {
      setInstalling(null);
    }
  };

  const toggle = async (a: Installed) => {
    try {
      await post(`${base}/toggle`, { file: a.file, enabled: !a.enabled });
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (a: Installed) => {
    if (!(await confirm({ title: `Удалить ${a.name}?`, description: "Файл jar будет удалён. Настройки в его папке останутся.", confirmText: "Удалить", destructive: true }))) return;
    try {
      await post(`${base}/delete`, { file: a.file });
      await refresh();
      toast.success("Удалено");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onUpload = async (files: File[]) => {
    if (!files.length) return;
    try {
      await upload(`${base}/upload`, files);
      toast.success("Загружено");
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (info.isLoading) return <Spinner />;
  if (!info.data) return null;

  if (info.data.sources.length === 0) {
    return (
      <EmptyState
        icon={<Puzzle />}
        title="Ванильный сервер не поддерживает плагины"
        description="Чтобы ставить плагины, смените ядро на Paper или Purpur в «Настройки» → «Ядро и версия». Мир сохранится."
      />
    );
  }

  return (
    <div className="space-y-6">
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="order-2 xl:order-1">
        <CardHeader>
          <CardTitle>Каталог</CardTitle>
          <CardDescription>
            Показаны {isMods ? "моды" : "плагины"}, совместимые с {server.mcVersion}. Установка в один клик, после неё нужен перезапуск.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {info.data.sources.map((s) => (
              <Button key={s} size="sm" variant={activeSource === s ? "default" : "outline"} onClick={() => setSource(s)}>
                {SOURCE_NAMES[s]}
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder={`Поиск: например, ${isMods ? "sodium, jei" : "LuckPerms, EssentialsX"}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {activeSource === "curseforge" && (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Некоторые авторы запрещают скачивание с CurseForge сторонними программами — такие моды придётся скачать на сайте и загрузить кнопкой справа.
            </p>
          )}
          {activeSource === "spiget" && (
            <p className="rounded-lg bg-warning/10 p-3 text-xs text-warning">
              SpigotMC защищает скачивание от ботов, поэтому часть плагинов отсюда не установится автоматически. Тогда скачайте jar на сайте и загрузите кнопкой справа.
            </p>
          )}
          {search.isLoading ? (
            <Spinner className="flex justify-center py-10" />
          ) : search.isError ? (
            <p className="text-sm text-destructive">{errorText(search.error)}</p>
          ) : search.data?.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {search.data?.map((item) => (
                <div key={`${item.source}-${item.id}`} className="flex gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40">
                  {item.icon ? (
                    <img src={item.icon} alt="" className="size-11 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
                  ) : (
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Package className="size-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <a href={item.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-primary">
                        {item.title}
                        <ExternalLink className="ml-1 inline size-3 opacity-50" />
                      </a>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Download className="size-3" /> {compact(item.downloads)}
                      </span>
                      <Button size="sm" className="h-7" loading={installing === item.id} disabled={installing !== null} onClick={() => void install(item)}>
                        Установить
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="order-1 h-fit xl:order-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Установлено</CardTitle>
            <CardDescription>
              Папка <span className="font-mono">{info.data.dir}/</span>
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload /> .jar
          </Button>
          <input ref={fileInput} type="file" accept=".jar" multiple hidden onChange={(e) => void onUpload(Array.from(e.target.files ?? [])).then(() => (e.target.value = ""))} />
        </CardHeader>
        <CardContent>
          {info.data.installed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Пока ни одного {isMods ? "мода" : "плагина"}. Найдите {noun} в каталоге.</p>
          ) : (
            <ul className="divide-y">
              {info.data.installed.map((a) => (
                <li key={a.file} className="flex items-center gap-3 py-2.5">
                  <Switch checked={a.enabled} onCheckedChange={() => void toggle(a)} aria-label={a.enabled ? "Выключить" : "Включить"} />
                  <div className={cn("min-w-0 flex-1", !a.enabled && "opacity-50")}>
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => void remove(a)} aria-label="Удалить">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {installing && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Скачиваю…
            </p>
          )}
        </CardContent>
      </Card>
    </div>
    {isMods && <ModListBuilder server={server} />}
    </div>
  );
}
