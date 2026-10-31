import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader, useCrumbs } from "@/components/AppShell";
import { AuditList } from "@/components/AuditList";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/primitives";
import { get } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";

export default function AdminAudit() {
  useCrumbs([{ label: "Администрирование" }, { label: "Журнал действий" }]);
  const query = useInfiniteQuery({
    queryKey: ["admin-audit"],
    queryFn: async ({ pageParam }) => (await get<{ entries: AuditEntry[] }>(`/api/admin/audit${pageParam ? `?before=${pageParam}` : ""}`)).entries,
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1]!.id : undefined),
  });
  const entries = query.data?.pages.flat() ?? [];
  return (
    <>
      <PageHeader title="Журнал действий" description="Все действия пользователей во всей панели" />
      <Card>
        <CardContent className="pt-5">
          {query.isLoading ? <Spinner /> : <AuditList entries={entries} showServer />}
          {query.hasNextPage && (
            <Button variant="outline" className="mt-4 w-full" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Показать ещё
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}
