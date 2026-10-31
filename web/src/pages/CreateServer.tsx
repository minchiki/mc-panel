import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Cpu, HardDrive, Info, Loader2, MemoryStick, Rocket, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/overlays";
import { useAuth } from "@/hooks/auth";
import { errorText, get, post } from "@/lib/api";
import { formatMb } from "@/lib/format";
import type { CoreInfo, Server, VersionEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = ["Ядро", "Версия", "Ресурсы", "Готово"] as const;
const RAM_PRESETS = [1024, 2048, 3072, 4096, 6144, 8192];

const CORE_HINTS: Record<string, string> = {
  paper: "Рекомендуем",
  fabric: "Моды",
  forge: "Моды",
  neoforge: "Моды",
  velocity: "Прокси",
  bungeecord: "Прокси",
};

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary ring-2 ring-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("hidden text-sm sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
          {i < STEPS.length - 1 && <span className={cn("h-px flex-1", i < step ? "bg-primary" : "bg-border")} />}
        </li>
      ))}
    </ol>
  );
}

export default function CreateServerPage() {
  useCrumbs([{ label: "Серверы", to: "/" }, { label: "Новый сервер" }]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [core, setCore] = useState("paper");
  const [version, setVersion] = useState<VersionEntry | null>(null);
  const [showUnstable, setShowUnstable] = useState(false);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [ramMb, setRamMb] = useState(2048);
  const [cpuLimit, setCpuLimit] = useState(2);
  const [diskMb, setDiskMb] = useState(10240);
  const [java, setJava] = useState<number | null>(null);
  const [javaTouched, setJavaTouched] = useState(false);
  const [port, setPort] = useState("");
  const [eula, setEula] = useState(false);

  const cores = useQuery({ queryKey: ["cores"], queryFn: () => get<{ cores: CoreInfo[]; java: number[] }>("/api/cores"), staleTime: Infinity });
  const versions = useQuery({
    queryKey: ["versions", core],
    queryFn: async () => (await get<{ versions: VersionEntry[] }>(`/api/cores/${core}/versions`)).versions,
    enabled: step >= 1,
    staleTime: 600_000,
  });
  const recommended = useQuery({
    queryKey: ["java", core, version?.id],
    queryFn: async () => (await get<{ java: number }>(`/api/cores/${core}/java?version=${encodeURIComponent(version!.id)}`)).java,
    enabled: Boolean(version),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (recommended.data && !javaTouched) setJava(recommended.data);
  }, [recommended.data, javaTouched]);

  const filtered = useMemo(
    () => (versions.data ?? []).filter((v) => (showUnstable || v.stable) && v.id.toLowerCase().includes(filter.toLowerCase())),
    [versions.data, showUnstable, filter],
  );

  useEffect(() => {
    if (step === 1 && !version && filtered[0]) setVersion(filtered[0]);
  }, [step, version, filtered]);

  const coreInfo = cores.data?.cores.find((c) => c.id === core);
  const isAdmin = user?.role === "admin";

  const create = useMutation({
    mutationFn: () =>
      post<{ server: Server }>("/api/servers", {
        name: name.trim() || `${coreInfo?.name ?? core} ${version?.id}`,
        core,
        mcVersion: version!.id,
        build: version?.build,
        java,
        ramMb,
        cpuLimit,
        diskMb,
        port: port ? Number(port) : undefined,
        acceptEula: eula,
      }),
    onSuccess: ({ server }) => {
      void qc.invalidateQueries({ queryKey: ["servers"] });
      toast.success("Сервер создан, идёт установка");
      navigate(`/servers/${server.id}`);
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const canNext = step === 0 ? Boolean(core) : step === 1 ? Boolean(version) : step === 2 ? Boolean(java) : eula;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Новый сервер" description="Четыре шага, и сервер начнёт устанавливаться автоматически." />
      <Stepper step={step} />

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {cores.data?.cores.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCore(c.id);
                setVersion(null);
                setJavaTouched(false);
              }}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left shadow-soft transition-all hover:border-primary/40",
                core === c.id && "border-primary ring-2 ring-primary/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.name}</span>
                {CORE_HINTS[c.id] && <Badge variant={c.id === "paper" ? "default" : "secondary"}>{CORE_HINTS[c.id]}</Badge>}
              </div>
              <span className="text-sm text-muted-foreground">{c.description}</span>
            </button>
          ))}
          {cores.isLoading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        </div>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Версия {coreInfo?.name}</CardTitle>
            <CardDescription>Список загружается из официального API. Самая свежая стабильная версия выбрана по умолчанию.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Например, 1.20.1" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={showUnstable} onCheckedChange={setShowUnstable} /> Снапшоты и бета
              </label>
            </div>
            {versions.isLoading && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загружаю список версий…
              </div>
            )}
            {versions.isError && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {errorText(versions.error)}{" "}
                <Button variant="link" className="h-auto p-0" onClick={() => void versions.refetch()}>
                  Повторить
                </Button>
              </div>
            )}
            <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-4">
              {filtered.map((v) => (
                <button
                  key={`${v.id}-${v.build ?? ""}`}
                  type="button"
                  onClick={() => {
                    setVersion(v);
                    setJavaTouched(false);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50",
                    version?.id === v.id && version.build === v.build && "border-primary bg-primary/10 font-medium text-primary",
                  )}
                >
                  <div>{v.id}</div>
                  {v.build && <div className="truncate text-xs text-muted-foreground">{v.build}</div>}
                  {!v.stable && <div className="text-xs text-warning">нестабильная</div>}
                </button>
              ))}
            </div>
            {!versions.isLoading && filtered.length === 0 && !versions.isError && <p className="text-sm text-muted-foreground">Ничего не найдено.</p>}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Ресурсы</CardTitle>
            <CardDescription>Лимиты можно поменять позже в настройках сервера.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MemoryStick className="size-4 text-muted-foreground" /> Оперативная память: <span className="text-primary">{formatMb(ramMb)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {RAM_PRESETS.filter((p) => isAdmin || p <= (user?.maxRamMb ?? 0)).map((p) => (
                  <Button key={p} type="button" size="sm" variant={ramMb === p ? "default" : "outline"} onClick={() => setRamMb(p)}>
                    {formatMb(p)}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Ванильному серверу на 5–10 игроков хватит 2 ГБ, сборке модов нужно 4–8 ГБ.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={<span className="flex items-center gap-2"><Cpu className="size-4 text-muted-foreground" /> Ядра CPU</span>} hint="Сколько ядер может занять сервер">
                <Select value={cpuLimit} onChange={(e) => setCpuLimit(Number(e.target.value))} disabled={!isAdmin}>
                  {[0.5, 1, 1.5, 2, 3, 4].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={<span className="flex items-center gap-2"><HardDrive className="size-4 text-muted-foreground" /> Диск</span>} hint="Место под мир, плагины и логи">
                <Select value={diskMb} onChange={(e) => setDiskMb(Number(e.target.value))} disabled={!isAdmin}>
                  {[5120, 10240, 20480, 30720, 51200].map((d) => (
                    <option key={d} value={d}>
                      {formatMb(d)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Версия Java" hint={recommended.data ? `Рекомендуется Java ${recommended.data} для ${version?.id}` : "Определяю…"}>
                <Select
                  value={java ?? ""}
                  onChange={(e) => {
                    setJava(Number(e.target.value));
                    setJavaTouched(true);
                  }}
                >
                  {cores.data?.java.map((j) => (
                    <option key={j} value={j}>
                      Java {j}
                      {j === recommended.data ? " (рекомендуется)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Порт" hint="Оставьте пустым, выберем свободный автоматически">
                <Input inputMode="numeric" placeholder="авто (25565–25665)" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            {!isAdmin && (
              <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" /> CPU и диск задаёт администратор. Ваш лимит памяти на все серверы: {formatMb(user?.maxRamMb ?? 0)}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Почти готово</CardTitle>
            <CardDescription>Проверьте параметры и дайте серверу название.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Название" hint="Видно только в панели">
              <Input placeholder={`${coreInfo?.name ?? ""} ${version?.id ?? ""}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus />
            </Field>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm sm:grid-cols-3">
              {[
                ["Ядро", coreInfo?.name],
                ["Версия", `${version?.id}${version?.build ? ` (${version.build})` : ""}`],
                ["Java", java],
                ["Память", formatMb(ramMb)],
                ["CPU", `${cpuLimit} ядра`],
                ["Диск", formatMb(diskMb)],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={eula} onChange={(e) => setEula(e.target.checked)} />
              <span>
                Я принимаю{" "}
                <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  Minecraft EULA
                </a>
                . Без этого сервер не запустится.
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex justify-between gap-2">
        <Button variant="outline" onClick={() => (step === 0 ? navigate("/") : setStep(step - 1))}>
          <ChevronLeft /> {step === 0 ? "Отмена" : "Назад"}
        </Button>
        {step < 3 ? (
          <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
            Далее <ChevronRight />
          </Button>
        ) : (
          <Button disabled={!canNext} loading={create.isPending} onClick={() => create.mutate()}>
            <Rocket /> Создать сервер
          </Button>
        )}
      </div>
    </div>
  );
}
