import type { ReactNode } from "react";

const COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  a: "#55FF55",
  b: "#55FFFF",
  c: "#FF5555",
  d: "#FF55FF",
  e: "#FFFF55",
  f: "#FFFFFF",
};

export const MOTD_CODES = Object.entries(COLORS).map(([code, color]) => ({ code, color }));

interface Segment {
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/** Renders Minecraft § formatting the way the multiplayer list does. */
export function parseMotd(raw: string): Segment[][] {
  const lines = raw.replace(/\\n/g, "\n").split("\n").slice(0, 2);
  return lines.map((line) => {
    const out: Segment[] = [];
    let style: Omit<Segment, "text"> = { color: "#AAAAAA", bold: false, italic: false, underline: false, strike: false };
    let buf = "";
    const flush = () => {
      if (buf) out.push({ ...style, text: buf });
      buf = "";
    };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      const code = line[i + 1]?.toLowerCase();
      if ((ch === "§" || ch === "&") && code && /[0-9a-fk-or]/.test(code)) {
        flush();
        if (COLORS[code]) style = { color: COLORS[code]!, bold: false, italic: false, underline: false, strike: false };
        else if (code === "l") style = { ...style, bold: true };
        else if (code === "o") style = { ...style, italic: true };
        else if (code === "n") style = { ...style, underline: true };
        else if (code === "m") style = { ...style, strike: true };
        else if (code === "r") style = { color: "#AAAAAA", bold: false, italic: false, underline: false, strike: false };
        i++;
        continue;
      }
      buf += ch;
    }
    flush();
    return out;
  });
}

export function MotdPreview({ motd, name, players, max, icon }: { motd: string; name: string; players: number; max: number; icon?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg bg-[#1e1e1e] p-3 font-mono text-[13px] leading-snug" style={{ imageRendering: "pixelated" }}>
      {icon ?? <div className="flex size-14 shrink-0 items-center justify-center rounded bg-[#3a7a2a] text-2xl">⛏</div>}
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <span className="truncate text-white">{name}</span>
          <span className="shrink-0 text-[#AAAAAA]">
            {players}/{max}
          </span>
        </div>
        {parseMotd(motd).map((line, i) => (
          <div key={i} className="truncate">
            {line.map((s, j) => (
              <span
                key={j}
                style={{
                  color: s.color,
                  fontWeight: s.bold ? 700 : 400,
                  fontStyle: s.italic ? "italic" : undefined,
                  textDecoration: [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || undefined,
                }}
              >
                {s.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
