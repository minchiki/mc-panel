/**
 * Minimal Java .properties handling for server.properties: keeps comments and
 * key order, so editing through the form does not reshuffle the user's file.
 */
export type PropLine = { kind: "comment"; text: string } | { kind: "entry"; key: string; value: string };

export function parseProperties(text: string): PropLine[] {
  return text.split(/\r?\n/).flatMap<PropLine>((raw) => {
    const line = raw.trimStart();
    if (line === "") return [];
    if (line.startsWith("#") || line.startsWith("!")) return [{ kind: "comment", text: raw }];
    const idx = line.search(/[=:]/);
    if (idx === -1) return [{ kind: "entry", key: unescape(line.trim()), value: "" }];
    return [{ kind: "entry", key: unescape(line.slice(0, idx).trim()), value: unescape(line.slice(idx + 1).trimStart()) }];
  });
}

export function toRecord(lines: PropLine[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) if (l.kind === "entry") out[l.key] = l.value;
  return out;
}

export function applyUpdates(lines: PropLine[], updates: Record<string, string>): PropLine[] {
  const pending = new Map(Object.entries(updates));
  const next = lines.map((l) => {
    if (l.kind !== "entry" || !pending.has(l.key)) return l;
    const value = pending.get(l.key)!;
    pending.delete(l.key);
    return { ...l, value };
  });
  for (const [key, value] of pending) next.push({ kind: "entry", key, value });
  return next;
}

export function serializeProperties(lines: PropLine[]): string {
  return lines.map((l) => (l.kind === "comment" ? l.text : `${escapeKey(l.key)}=${escapeValue(l.value)}`)).join("\n") + "\n";
}

function unescape(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, (_, c: string) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    return c;
  });
}

function escapeKey(s: string): string {
  return s.replace(/([\\=: ])/g, "\\$1");
}

function escapeValue(s: string): string {
  // Minecraft writes non-ASCII (e.g. Cyrillic MOTD, § codes) as \\uXXXX.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .replace(/^ /, "\\ ")
    .replace(/[=:]/g, (c) => `\\${c}`);
}
