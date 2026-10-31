import { containerName, docker, pipeLines } from "../docker/client.js";
import type { LiveStats } from "./events.js";

const EMIT_EVERY_MS = 2000;

export interface StatsHandle {
  stop(): void;
}

interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; stats?: { inactive_file?: number; total_inactive_file?: number } };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

export function computeStats(s: DockerStats, memLimitMb: number): LiveStats {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats.online_cpus ?? 1;
  const cpu = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
  const cacheBytes = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.total_inactive_file ?? 0;
  const memBytes = Math.max(0, (s.memory_stats.usage ?? 0) - cacheBytes);
  let netRx = 0;
  let netTx = 0;
  for (const n of Object.values(s.networks ?? {})) {
    netRx += n.rx_bytes;
    netTx += n.tx_bytes;
  }
  return {
    cpu: Math.round(cpu * 10) / 10,
    memMb: Math.round(memBytes / 1024 / 1024),
    memLimitMb,
    netRx,
    netTx,
    at: Date.now(),
  };
}

/** Streams `docker stats` for a server and calls `onStats` at most every 2 s. */
export function startStats(serverId: string, memLimitMb: number, onStats: (s: LiveStats) => void): StatsHandle {
  let stream: NodeJS.ReadableStream & { destroy?: () => void } | null = null;
  let stopped = false;
  let lastEmit = 0;
  docker
    .getContainer(containerName(serverId))
    .stats({ stream: true })
    .then((s) => {
      stream = s as typeof stream;
      if (stopped) return stream?.destroy?.();
      pipeLines(s, (line) => {
        if (!line.trim()) return;
        const now = Date.now();
        if (now - lastEmit < EMIT_EVERY_MS) return;
        lastEmit = now;
        try {
          onStats(computeStats(JSON.parse(line) as DockerStats, memLimitMb));
        } catch {
          // partial/garbled frame, skip
        }
      });
    })
    .catch(() => undefined);
  return {
    stop() {
      stopped = true;
      stream?.destroy?.();
    },
  };
}
