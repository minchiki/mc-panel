import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MOTD_CODES, MotdPreview } from "@/components/MotdPreview";
import { ServerIcon } from "@/components/ServerIcon";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Switch, Tooltip } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/primitives";
import { errorText, get, put } from "@/lib/api";
import type { Server } from "@/lib/types";
import { KNOWN_KEYS, PROPERTY_GROUPS, type PropField } from "./propertiesSchema";

function FieldControl({ field, value, onChange }: { field: PropField; value: string; onChange: (v: string) => void }) {
  if (field.type === "bool") {
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{field.label}</p>
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
        <Switch checked={value === "true"} onCheckedChange={(c) => onChange(c ? "true" : "false")} />
      </div>
    );
  }
  return (
    <Field label={field.label} hint={field.hint}>
      {field.type === "select" ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {!field.options.some((o) => o.value === value) && <option value={value}>{value || "по умолчанию"}</option>}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={field.type === "number" ? "number" : "text"}
          min={field.type === "number" ? field.min : undefined}
          max={field.type === "number" ? field.max : undefined}
          placeholder={field.type === "text" ? field.placeholder : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function PropertiesCard({ server }: { server: Server }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["properties", server.id],
    queryFn: () => get<{ supported: boolean; values: Record<string, string> }>(`/api/servers/${server.id}/properties`),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    if (query.data) setValues(query.data.values);
  }, [query.data]);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(query.data?.values ?? {}), [values, query.data]);
  const otherKeys = Object.keys(values).filter((k) => !KNOWN_KEYS.has(k)).sort();
  const set = (key: string) => (v: string) => setValues((s) => ({ ...s, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await put<{ restartNeeded: boolean }>(`/api/servers/${server.id}/properties`, { values });
      toast.success("Настройки сохранены", { description: res.restartNeeded ? "Перезапустите сервер, чтобы они применились" : undefined });
      await qc.invalidateQueries({ queryKey: ["properties", server.id] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  if (query.isLoading) return <Spinner />;
  if (!query.data?.supported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Настройки игры</CardTitle>
          <CardDescription>У прокси нет server.properties: настройте его конфиг во вкладке «Файлы» (velocity.toml или config.yml).</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const insertCode = (code: string) => set("motd")(`${values.motd ?? ""}§${code}`);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Настройки игры</CardTitle>
          <CardDescription>Файл server.properties в виде формы. Порт и RCON панель настраивает сама.</CardDescription>
        </div>
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          <Save /> Сохранить
        </Button>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-3">
          <h4 className="text-sm font-semibold">MOTD — описание в списке серверов</h4>
          <Input value={values.motd ?? ""} onChange={(e) => set("motd")(e.target.value)} placeholder="A Minecraft Server" />
          <div className="flex flex-wrap gap-1">
            {MOTD_CODES.map(({ code, color }) => (
              <Tooltip key={code} content={`§${code}`}>
                <button type="button" onClick={() => insertCode(code)} className="size-6 rounded border border-white/10" style={{ background: color }} aria-label={`Цвет ${code}`} />
              </Tooltip>
            ))}
            {[
              ["l", "Ж"],
              ["o", "К"],
              ["n", "П"],
              ["r", "⟲"],
            ].map(([code, label]) => (
              <Tooltip key={code} content={`§${code}`}>
                <button type="button" onClick={() => insertCode(code!)} className="h-6 rounded border px-2 text-xs font-semibold hover:bg-accent">
                  {label}
                </button>
              </Tooltip>
            ))}
            <span className="ml-2 self-center text-xs text-muted-foreground">\n — перенос на вторую строку</span>
          </div>
          <MotdPreview motd={values.motd ?? ""} name={server.name} players={server.players.length} max={Number(values["max-players"] ?? 20)} icon={<ServerIcon serverId={server.id} className="size-14 rounded" />} />
        </section>

        {PROPERTY_GROUPS.map((group) => (
          <section key={group.title} className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">{group.title}</h4>
              {group.description && <p className="text-xs text-muted-foreground">{group.description}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {group.fields.map((f) => (
                <FieldControl key={f.key} field={f} value={values[f.key] ?? ""} onChange={set(f.key)} />
              ))}
            </div>
          </section>
        ))}

        {otherKeys.length > 0 && (
          <section className="space-y-3">
            <button type="button" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setShowOther(!showOther)}>
              <ChevronDown className={showOther ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
              Другие параметры ({otherKeys.length})
            </button>
            {showOther && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {otherKeys.map((k) => (
                  <Field key={k} label={<span className="font-mono text-xs">{k}</span>}>
                    <Input value={values[k] ?? ""} onChange={(e) => set(k)(e.target.value)} />
                  </Field>
                ))}
              </div>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
