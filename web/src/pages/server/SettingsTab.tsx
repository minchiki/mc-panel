import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/auth";
import { del, errorText, get, patch, post } from "@/lib/api";
import { formatMb } from "@/lib/format";
import type { CoreInfo, VersionEntry } from "@/lib/types";
import { IconCard } from "./IconCard";
import { PropertiesCard } from "./PropertiesCard";
import { useServerContext } from "./ServerLayout";

const RAM_OPTIONS = [512, 1024, 1536, 2048, 3072, 4096, 5120, 6144, 8192, 12288, 16384];

function ResourcesCard() {
  const server = useServerContext();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [form, setForm] = useState({
    name: server.name,
    ramMb: server.ramMb,
    cpuLimit: server.cpuLimit,
    diskMb: server.diskMb,
    javaVersion: server.javaVersion,
    jvmFlags: server.jvmFlags,
    autoRestart: server.autoRestart,
  });
  useEffect(
    () =>
      setForm({
        name: server.name,
        ramMb: server.ramMb,
        cpuLimit: server.cpuLimit,
        diskMb: server.diskMb,
        javaVersion: server.javaVersion,
        jvmFlags: server.jvmFlags,
        autoRestart: server.autoRestart,
      }),
    [server.name, server.ramMb, server.cpuLimit, server.diskMb, server.javaVersion, server.jvmFlags, server.autoRestart],
  );

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: form.name, javaVersion: form.javaVersion, jvmFlags: form.jvmFlags, autoRestart: form.autoRestart };
      if (server.isOwner && form.ramMb !== server.ramMb) body.ramMb = form.ramMb;
      if (isAdmin && form.cpuLimit !== server.cpuLimit) body.cpuLimit = form.cpuLimit;
      if (isAdmin && form.diskMb !== server.diskMb) body.diskMb = form.diskMb;
      return patch<{ restartNeeded: boolean }>(`/api/servers/${server.id}`, body);
    },
    onSuccess: (res) => {
      toast.success("Сохранено", { description: res.restartNeeded ? "Новые лимиты и Java применятся после перезапуска" : undefined });
      void qc.invalidateQueries({ queryKey: ["server", server.id] });
      void qc.invalidateQueries({ queryKey: ["servers"] });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Ресурсы и запуск</CardTitle>
          <CardDescription>Память, процессор, диск, Java и флаги JVM</CardDescription>
        </div>
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          <Save /> Сохранить
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Название">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={48} />
          </Field>
          <Field label="Память" hint={server.isOwner ? undefined : "Меняет владелец сервера"}>
            <Select value={form.ramMb} disabled={!server.isOwner} onChange={(e) => setForm({ ...form, ramMb: Number(e.target.value) })}>
              {RAM_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {formatMb(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ядра CPU" hint={isAdmin ? undefined : "Меняет администратор"}>
            <Input type="number" step={0.25} min={0.25} max={16} disabled={!isAdmin} value={form.cpuLimit} onChange={(e) => setForm({ ...form, cpuLimit: Number(e.target.value) })} />
          </Field>
          <Field label="Лимит диска, МБ" hint={isAdmin ? undefined : "Меняет администратор"}>
            <Input type="number" step={1024} min={1024} disabled={!isAdmin} value={form.diskMb} onChange={(e) => setForm({ ...form, diskMb: Number(e.target.value) })} />
          </Field>
          <Field label="Java">
            <Select value={form.javaVersion} onChange={(e) => setForm({ ...form, javaVersion: Number(e.target.value) })}>
              {[8, 17, 21, 25].map((j) => (
                <option key={j} value={j}>
                  Java {j}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Авто-рестарт при падении</p>
              <p className="text-xs text-muted-foreground">Не больше 3 попыток за 10 минут, затем пауза и уведомление</p>
            </div>
            <Switch checked={form.autoRestart} onCheckedChange={(c) => setForm({ ...form, autoRestart: c })} />
          </div>
        </div>
        <Field label="Флаги JVM" hint="По умолчанию оптимизированные флаги Aikar. Память (-Xmx) панель подставляет сама.">
          <Textarea className="font-mono text-xs" rows={3} value={form.jvmFlags} onChange={(e) => setForm({ ...form, jvmFlags: e.target.value })} />
        </Field>
      </CardContent>
    </Card>
  );
}

function ReinstallCard() {
  const server = useServerContext();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [core, setCore] = useState(server.core);
  const [version, setVersion] = useState(server.mcVersion);
  const [backupFirst, setBackupFirst] = useState(true);
  const cores = useQuery({ queryKey: ["cores"], queryFn: () => get<{ cores: CoreInfo[]; java: number[] }>("/api/cores"), staleTime: Infinity });
  const versions = useQuery({
    queryKey: ["versions", core],
    queryFn: async () => (await get<{ versions: VersionEntry[] }>(`/api/cores/${core}/versions`)).versions.filter((v) => v.stable),
    staleTime: 600_000,
  });

  const run = async () => {
    const ok = await confirm({
      title: "Переустановить ядро?",
      description: (
        <>
          Сервер будет остановлен, файлы ядра ({core} {version}) скачаются заново. Мир, плагины и конфиги останутся.
          {!backupFirst && <strong className="mt-2 block text-destructive">Вы отключили бэкап: если что-то пойдёт не так, откатиться будет нельзя.</strong>}
        </>
      ),
      confirmText: "Переустановить",
      destructive: true,
    });
    if (!ok) return;
    try {
      const entry = versions.data?.find((v) => v.id === version);
      const java = (await get<{ java: number }>(`/api/cores/${core}/java?version=${encodeURIComponent(version)}`)).java;
      await post(`/api/servers/${server.id}/reinstall`, { core, mcVersion: version, build: entry?.build, java, backupFirst });
      toast.success("Переустановка началась, ход виден в консоли");
      void qc.invalidateQueries({ queryKey: ["server", server.id] });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (!server.isOwner) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ядро и версия</CardTitle>
        <CardDescription>Обновление версии или смена ядра (например, Vanilla → Paper) с сохранением мира.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ядро">
            <Select
              value={core}
              onChange={(e) => {
                setCore(e.target.value);
                setVersion("");
              }}
            >
              {cores.data?.cores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Версия">
            <Select value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="" disabled>
                {versions.isLoading ? "Загрузка…" : "Выберите версию"}
              </option>
              {versions.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                  {v.build ? ` (${v.build})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex items-start gap-3 rounded-lg bg-warning/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="space-y-2">
            <p>Понижать версию мира нельзя: мир, открытый новой версией, может сломаться на старой. Смена Paper ↔ Forge/Fabric несовместима по плагинам и модам.</p>
            <label className="flex items-center gap-2 font-medium">
              <Switch checked={backupFirst} onCheckedChange={setBackupFirst} /> Сделать бэкап перед переустановкой
            </label>
          </div>
        </div>
        <Button variant="warning" disabled={!version} onClick={() => void run()}>
          <RefreshCcw /> Переустановить
        </Button>
      </CardContent>
    </Card>
  );
}

function DangerCard() {
  const server = useServerContext();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  if (!server.isOwner) return null;
  const remove = async () => {
    const ok = await confirm({
      title: "Удалить сервер навсегда?",
      description: "Будут удалены мир, файлы, бэкапы и базы данных сервера. Отменить это нельзя.",
      confirmText: "Удалить навсегда",
      destructive: true,
      typeToConfirm: server.name,
    });
    if (!ok) return;
    try {
      await del(`/api/servers/${server.id}`, { confirm: server.name });
      toast.success("Сервер удалён");
      await qc.invalidateQueries({ queryKey: ["servers"] });
      navigate("/");
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Опасная зона</CardTitle>
        <CardDescription>Удаление сервера вместе со всеми данными и бэкапами.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => void remove()}>
          <Trash2 /> Удалить сервер
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsTab() {
  const server = useServerContext();
  return (
    <div className="space-y-6">
      <IconCard server={server} />
      <PropertiesCard server={server} />
      <ResourcesCard />
      <ReinstallCard />
      <DangerCard />
    </div>
  );
}
