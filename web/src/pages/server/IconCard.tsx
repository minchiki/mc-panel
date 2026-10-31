import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, RotateCw, Trash2, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { iconVersionKey, ServerIcon } from "@/components/ServerIcon";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { del, errorText, post, put } from "@/lib/api";
import { toServerIcon, type FitMode } from "@/lib/image";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";

export function IconCard({ server }: { server: Server }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<FitMode>("cover");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const convert = async (f: File, m: FitMode) => {
    try {
      setPreview(await toServerIcon(f, m));
    } catch (err) {
      toast.error(errorText(err));
      setFile(null);
      setPreview(null);
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    void convert(f, mode);
  };

  const changeMode = (m: FitMode) => {
    setMode(m);
    if (file) void convert(file, m);
  };

  const afterChange = async (restartNeeded: boolean, message: string) => {
    qc.setQueryData(iconVersionKey(server.id), Date.now());
    setFile(null);
    setPreview(null);
    if (!restartNeeded) return toast.success(message);
    toast.success(message, {
      description: "Minecraft читает иконку при запуске, нужен перезапуск",
      action: { label: "Перезапустить", onClick: () => void post(`/api/servers/${server.id}/power`, { action: "restart" }).catch((e) => toast.error(errorText(e))) },
      duration: 10_000,
    });
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await put<{ restartNeeded: boolean }>(`/api/servers/${server.id}/icon`, { png: preview });
      await afterChange(res.restartNeeded, "Иконка установлена");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Убрать иконку?", description: "В списке серверов снова будет стандартная иконка.", confirmText: "Убрать", destructive: true }))) return;
    try {
      const res = await del<{ restartNeeded: boolean }>(`/api/servers/${server.id}/icon`);
      await afterChange(res.restartNeeded, "Иконка убрана");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Иконка сервера</CardTitle>
        <CardDescription>Картинка в списке серверов у игроков. Подойдёт любая: панель сама сделает из неё PNG 64×64.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5 sm:flex-row">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cn(
              "flex min-h-36 flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40",
              drag && "border-primary bg-primary/5 text-primary",
            )}
          >
            <ImagePlus className="size-7" />
            <span className="font-medium text-foreground">{file ? file.name : "Перетащите картинку или нажмите"}</span>
            <span className="text-xs">PNG, JPG, WebP, GIF, BMP, SVG — любой размер</span>
          </button>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ""))} />

          <div className="flex flex-col items-center gap-3 sm:w-56">
            <div className="flex items-end gap-4">
              <div className="flex flex-col items-center gap-1">
                {preview ? (
                  <img src={preview} alt="Предпросмотр" className="size-24 rounded-lg bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:12px_12px]" style={{ imageRendering: "pixelated" }} />
                ) : (
                  <ServerIcon serverId={server.id} className="size-24" />
                )}
                <span className="text-[11px] text-muted-foreground">{preview ? "новая" : "текущая"}</span>
              </div>
              {preview && (
                <div className="flex flex-col items-center gap-1">
                  <img src={preview} alt="" className="size-16 rounded" />
                  <span className="text-[11px] text-muted-foreground">64×64</span>
                </div>
              )}
            </div>
            {file && (
              <div className="flex w-full rounded-lg border p-1 text-xs">
                {(["cover", "contain"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => changeMode(m)}
                    className={cn("flex-1 rounded-md px-2 py-1.5 font-medium transition-colors", mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {m === "cover" ? "Обрезать" : "Вписать целиком"}
                  </button>
                ))}
              </div>
            )}
            <div className="flex w-full gap-2">
              {preview ? (
                <>
                  <Button className="flex-1" onClick={() => void save()} loading={busy}>
                    <Upload /> Установить
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => (setFile(null), setPreview(null))} aria-label="Отмена">
                    <RotateCw />
                  </Button>
                </>
              ) : (
                <Button variant="outline" className="w-full text-muted-foreground hover:text-destructive" onClick={() => void remove()}>
                  <Trash2 /> Убрать иконку
                </Button>
              )}
            </div>
            {file && !preview && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Обрабатываю…
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
