import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Card, Select } from "@/components/ui/primitives";
import { get } from "@/lib/api";

const UNIT_NAMES: Record<string, string> = { "mc-panel": "Панель", docker: "Docker", nginx: "nginx", fail2ban: "fail2ban", ssh: "SSH" };

export default function AdminLogs() {
  useCrumbs([{ label: "Администрирование" }, { label: "Системные логи" }]);
  const [unit, setUnit] = useState("mc-panel");
  const [lines, setLines] = useState(200);
  const logs = useQuery({ queryKey: ["admin-logs", unit, lines], queryFn: () => get<{ text: string; units: string[] }>(`/api/admin/logs?unit=${unit}&lines=${lines}`) });
  return (
    <>
      <PageHeader
        title="Системные логи"
        description="journalctl сервисов VPS"
        actions={
          <>
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {Object.entries(UNIT_NAMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Select value={lines} onChange={(e) => setLines(Number(e.target.value))}>
              {[100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n} строк
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => void logs.refetch()} loading={logs.isFetching}>
              <RefreshCw /> Обновить
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden">
        {logs.isLoading ? (
          <Spinner />
        ) : (
          <pre className="max-h-[70vh] overflow-auto bg-console p-4 font-mono text-xs leading-relaxed text-zinc-200 scrollbar-thin">{logs.data?.text || "Пусто"}</pre>
        )}
      </Card>
    </>
  );
}
