import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import type { LiveStats, Permission, Server } from "@/lib/types";
import { socket, type WsEvent } from "@/lib/ws";

export function useServers() {
  return useQuery({ queryKey: ["servers"], queryFn: async () => (await get<{ servers: Server[] }>("/api/servers")).servers });
}

export function useServer(id: string | undefined) {
  return useQuery({
    queryKey: ["server", id],
    queryFn: async () => (await get<{ server: Server }>(`/api/servers/${id}`)).server,
    enabled: Boolean(id),
    refetchInterval: 60_000,
  });
}

/** Patches cached server objects from WebSocket events so every view stays live. */
export function useLiveSync(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      socket.on((evt: WsEvent) => {
        if (evt.type !== "status" && evt.type !== "players" && evt.type !== "stats") return;
        const patch = (s: Server): Server => {
          if (s.id !== evt.serverId) return s;
          if (evt.type === "status") return { ...s, status: evt.status, ...(evt.status === "offline" || evt.status === "crashed" ? { stats: null, players: [] } : {}) };
          if (evt.type === "players") return { ...s, players: evt.players };
          return { ...s, stats: evt.stats };
        };
        qc.setQueryData<Server[]>(["servers"], (list) => list?.map(patch));
        qc.setQueryData<Server>(["server", evt.serverId], (s) => (s ? patch(s) : s));
        if (evt.type === "status" && (evt.status === "offline" || evt.status === "online")) {
          void qc.invalidateQueries({ queryKey: ["server", evt.serverId] });
        }
      }),
    [qc],
  );
}

/** Keeps a WebSocket subscription for the server while the component is mounted. */
export function useServerSubscription(id: string | undefined): void {
  useEffect(() => (id ? socket.subscribe(id) : undefined), [id]);
}

export function useConnected(): boolean {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => socket.onConnection(setConnected), []);
  return connected;
}

export function can(server: Server | undefined, perm: Permission): boolean {
  return Boolean(server?.permissions?.includes(perm));
}

/** Rolling history of live stats for sparkline charts. */
export function useLiveHistory(stats: LiveStats | null | undefined, max = 60): LiveStats[] {
  const [history, setHistory] = useState<LiveStats[]>([]);
  useEffect(() => {
    if (!stats) return;
    setHistory((h) => (h[h.length - 1]?.at === stats.at ? h : [...h.slice(-(max - 1)), stats]));
  }, [stats, max]);
  return history;
}
