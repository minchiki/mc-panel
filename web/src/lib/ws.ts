import type { LiveStats, ServerStatus } from "./types";

export type WsEvent =
  | { type: "console"; serverId: string; lines: string[]; replace?: boolean }
  | { type: "status"; serverId: string; status: ServerStatus }
  | { type: "stats"; serverId: string; stats: LiveStats }
  | { type: "players"; serverId: string; players: string[] }
  | { type: "error"; message: string };

type Listener = (evt: WsEvent) => void;

/**
 * Single shared WebSocket with auto-reconnect. Subscriptions are ref-counted
 * and replayed after reconnects, so components just call subscribe/unsubscribe.
 */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private subs = new Map<string, number>();
  private retry = 0;
  private timer: number | null = null;
  private stopped = true;
  connected = false;
  private connListeners = new Set<(c: boolean) => void>();

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      for (const id of this.subs.keys()) this.send({ type: "subscribe", serverId: id });
    };
    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(String(e.data)) as WsEvent;
        for (const l of this.listeners) l(evt);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = (e) => {
      this.setConnected(false);
      if (this.stopped || e.code === 4401) return;
      const delay = Math.min(15_000, 500 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.open(), delay);
    };
  }

  private setConnected(c: boolean): void {
    this.connected = c;
    for (const l of this.connListeners) l(c);
  }

  onConnection(fn: (c: boolean) => void): () => void {
    this.connListeners.add(fn);
    return () => this.connListeners.delete(fn);
  }

  send(msg: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribe(serverId: string): () => void {
    const n = this.subs.get(serverId) ?? 0;
    this.subs.set(serverId, n + 1);
    if (n === 0) this.send({ type: "subscribe", serverId });
    return () => {
      const left = (this.subs.get(serverId) ?? 1) - 1;
      if (left <= 0) {
        this.subs.delete(serverId);
        this.send({ type: "unsubscribe", serverId });
      } else this.subs.set(serverId, left);
    };
  }
}

export const socket = new Socket();
