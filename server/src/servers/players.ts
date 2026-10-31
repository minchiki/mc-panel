import { all, run } from "../db/index.js";
import { stripColors } from "../lib/rcon.js";

const JOIN = /: ([A-Za-z0-9_.]{1,16}) joined the game/;
const LEAVE = /: ([A-Za-z0-9_.]{1,16}) left the game/;

export type PlayerEvent = { kind: "join" | "leave"; player: string } | null;

export function parsePlayerEvent(line: string): PlayerEvent {
  const clean = stripColors(line);
  const join = JOIN.exec(clean);
  if (join) return { kind: "join", player: join[1]! };
  const leave = LEAVE.exec(clean);
  if (leave) return { kind: "leave", player: leave[1]! };
  return null;
}

const LOGIN = /: ([A-Za-z0-9_.]{1,16})\[\/(.+):(\d{1,5})\] logged in with entity id/;

/** "Steve[/1.2.3.4:51234] logged in ..." -> remote address the game saw, to match against `ss` output. */
export function parsePlayerAddress(line: string): { player: string; address: string } | null {
  const m = LOGIN.exec(stripColors(line));
  return m ? { player: m[1]!, address: `${m[2]}:${m[3]}` } : null;
}

export function recordPlayerEvent(serverId: string, evt: NonNullable<PlayerEvent>): void {
  const now = Date.now();
  if (evt.kind === "join") {
    run("INSERT INTO player_sessions (server_id, player, joined_at) VALUES (?, ?, ?)", serverId, evt.player, now);
  } else {
    run(
      `UPDATE player_sessions SET left_at = ? WHERE id = (
         SELECT id FROM player_sessions WHERE server_id = ? AND player = ? AND left_at IS NULL ORDER BY joined_at DESC LIMIT 1)`,
      now,
      serverId,
      evt.player,
    );
  }
}

/** Called when the server stops: everyone still "online" left at that moment. */
export function closeOpenSessions(serverId: string): void {
  run("UPDATE player_sessions SET left_at = ? WHERE server_id = ? AND left_at IS NULL", Date.now(), serverId);
}

export function playerHistory(serverId: string, limit = 100) {
  return all<{ player: string; joined_at: number; left_at: number | null }>(
    "SELECT player, joined_at, left_at FROM player_sessions WHERE server_id = ? ORDER BY joined_at DESC LIMIT ?",
    serverId,
    limit,
  );
}

export function knownPlayers(serverId: string) {
  return all<{ player: string; last_seen: number; sessions: number; total_ms: number }>(
    `SELECT player, MAX(COALESCE(left_at, joined_at)) AS last_seen, COUNT(*) AS sessions,
            SUM(COALESCE(left_at, ?) - joined_at) AS total_ms
     FROM player_sessions WHERE server_id = ? GROUP BY player ORDER BY last_seen DESC LIMIT 500`,
    Date.now(),
    serverId,
  );
}
