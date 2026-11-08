import { FileArchive, Link2, Loader2, PackageOpen, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Input, Progress } from "@/components/ui/primitives";
import { errorText, post, upload } from "@/lib/api";
import type { PackInfo } from "@/lib/types";

const CORE_NAMES: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" };
export const coreName = (c: string) => CORE_NAMES[c] ?? c;

/** Upload a .mrpack file or paste a Modrinth CDN link; calls onPicked with what the pack needs. */
export function PackPicker({ onPicked }: { onPicked: (p: PackInfo) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const fromFile = async (file: File) => {
    setError("");
    if (!file.name.toLowerCase().endsWith(".mrpack")) return setError("Нужен файл с расширением .mrpack");
    setPct(0);
    try {
      const res = (await upload("/api/mrpack/upload", [file], (p) => {
        setPct(p);
        if (p >= 100) setChecking(true);
      })) as { pack: PackInfo };
      onPicked(res.pack);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPct(null);
      setChecking(false);
    }
  };

  const fromUrl = async () => {
    setError("");
    setChecking(true);
    try {
      onPicked((await post<{ pack: PackInfo }>("/api/mrpack/url", { url })).pack);
      setUrl("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const busy = pct !== null || checking;
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f && !busy) void fromFile(f);
        }}
        className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-70"
      >
        {busy ? <Loader2 className="size-7 animate-spin text-primary" /> : <FileArchive className="size-7 text-primary" />}
        <span className="font-medium">{pct !== null && pct < 100 ? `Загружаю… ${pct}%` : checking ? "Проверяю сборку…" : "Выберите или перетащите файл .mrpack"}</span>
        <span className="text-xs text-muted-foreground">Сборка из Modrinth App, Prism Launcher или скачанная с modrinth.com</span>
        {pct !== null && <Progress value={pct} className="mt-1 w-full max-w-xs" />}
      </button>
      <input ref={input} type="file" accept=".mrpack" className="hidden" onChange={(e) => e.target.files?.[0] && void fromFile(e.target.files[0])} />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="или ссылка https://cdn.modrinth.com/…/сборка.mrpack" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
        </div>
        <Button variant="outline" onClick={() => void fromUrl()} disabled={busy || !url.trim()}>
          <Upload /> Загрузить
        </Button>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** What is inside the pack, in one compact card. */
export function PackSummary({ pack, onClear }: { pack: PackInfo; onClear?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <PackageOpen className="mt-0.5 size-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-semibold">
          {pack.name} <span className="font-normal text-muted-foreground">{pack.version}</span>
        </p>
        {pack.summary && <p className="line-clamp-2 text-xs text-muted-foreground">{pack.summary}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Badge>
            {coreName(pack.core)} {pack.mcVersion}
          </Badge>
          {pack.build && <Badge variant="secondary">загрузчик {pack.build}</Badge>}
          <Badge variant="secondary">Java {pack.java}</Badge>
          <Badge variant="outline">
            на сервер {pack.serverFiles} файлов · {pack.downloadMb} МБ
          </Badge>
          {pack.clientOnlyFiles > 0 && <Badge variant="outline">только для игроков: {pack.clientOnlyFiles}</Badge>}
        </div>
      </div>
      {onClear && (
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClear} aria-label="Убрать сборку">
          <X />
        </Button>
      )}
    </div>
  );
}
