import { EventEmitter } from "node:events";

export type ServerStatus = "offline" | "installing" | "starting" | "online" | "stopping" | "crashed";

export interface LiveStats {
  cpu: number;
  memMb: number;
  memLimitMb: number;
  netRx: number;
  netTx: number;
  at: number;
}

export type ServerEvent =
  | { type: "console"; serverId: string; lines: string[] }
  | { type: "status"; serverId: string; status: ServerStatus }
  | { type: "stats"; serverId: string; stats: LiveStats }
  | { type: "players"; serverId: string; players: string[] };

class Bus extends EventEmitter {
  emitServer(evt: ServerEvent): void {
    this.emit("server", evt);
  }
  onServer(fn: (evt: ServerEvent) => void): () => void {
    this.on("server", fn);
    return () => this.off("server", fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(0);
