import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomId, safeEqual } from "./crypto.js";
import { assertFileName, isWithin, resolveExisting, resolveInside, writeNoFollow } from "./paths.js";
import { applyUpdates, parseProperties, serializeProperties, toRecord } from "./properties.js";
import { explainNetworkError } from "./http.js";
import { telegramRequest } from "./notify.js";
import { parseCompare } from "./updateCheck.js";
import { parseListResponse, parseTpsResponse, stripColors } from "./rcon.js";

describe("resolveInside", () => {
  const root = resolve("/srv/minecraft/servers/abc");

  it("resolves nested relative paths inside the root", () => {
    expect(resolveInside(root, "plugins/a.jar")).toBe(join(root, "plugins", "a.jar"));
    expect(resolveInside(root, "/plugins")).toBe(join(root, "plugins"));
    expect(resolveInside(root, "")).toBe(root);
  });

  it("rejects traversal and NUL bytes", () => {
    expect(() => resolveInside(root, "../other")).toThrow();
    expect(() => resolveInside(root, "plugins/../../x")).toThrow();
    expect(() => resolveInside(root, "..\\..\\etc")).toThrow();
    expect(() => resolveInside(root, "a\0b")).toThrow();
  });

  it("does not treat a sibling with a common prefix as inside", () => {
    expect(isWithin("/srv/a", "/srv/ab")).toBe(false);
    expect(isWithin("/srv/a", "/srv/a/b")).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("symlink handling", () => {
  it("resolveExisting rejects a symlink pointing outside the root", async () => {
    const base = mkdtempSync(join(tmpdir(), "mcp-"));
    const root = join(base, "srv");
    mkdirSync(root);
    writeFileSync(join(base, "secret"), "x");
    symlinkSync(join(base, "secret"), join(root, "link"));
    await expect(resolveExisting(root, "link")).rejects.toThrow();
  });

  it("writeNoFollow replaces a planted symlink instead of writing through it", async () => {
    const base = mkdtempSync(join(tmpdir(), "mcp-"));
    writeFileSync(join(base, "target"), "original");
    symlinkSync(join(base, "target"), join(base, "server.properties"));
    await writeNoFollow(join(base, "server.properties"), "new");
    expect(readFileSync(join(base, "target"), "utf8")).toBe("original");
    expect(readFileSync(join(base, "server.properties"), "utf8")).toBe("new");
  });
});

describe("assertFileName", () => {
  it("accepts normal names and rejects separators/dots", () => {
    expect(() => assertFileName("LuckPerms-5.4.jar")).not.toThrow();
    for (const bad of ["", ".", "..", "a/b", "a\\b", "x\0"]) expect(() => assertFileName(bad)).toThrow();
  });
});

describe("properties", () => {
  const sample = "#Minecraft server properties\n#Sat Oct 24\nmotd=A Minecraft Server\nmax-players=20\nlevel-seed=\n";

  it("parses entries and keeps comments", () => {
    const lines = parseProperties(sample);
    expect(toRecord(lines)).toEqual({ motd: "A Minecraft Server", "max-players": "20", "level-seed": "" });
    expect(lines.filter((l) => l.kind === "comment")).toHaveLength(2);
  });

  it("updates in place and appends new keys", () => {
    const out = serializeProperties(applyUpdates(parseProperties(sample), { "max-players": "50", pvp: "false" }));
    expect(out).toContain("max-players=50\n");
    expect(out.indexOf("max-players")).toBeLessThan(out.indexOf("pvp"));
    expect(out.startsWith("#Minecraft server properties")).toBe(true);
  });

  it("round-trips Cyrillic and colour codes via \\u escapes", () => {
    const out = serializeProperties(applyUpdates([], { motd: "§aПривет: мир" }));
    expect(out).toContain("\\u00a7a\\u041f");
    expect(toRecord(parseProperties(out)).motd).toBe("§aПривет: мир");
  });
});

describe("rcon parsers", () => {
  it("parses vanilla list output", () => {
    expect(parseListResponse("There are 2 of a max of 20 players online: Alex, Steve")).toEqual({ online: 2, max: 20, players: ["Alex", "Steve"] });
    expect(parseListResponse("There are 0 of a max of 20 players online: ")).toEqual({ online: 0, max: 20, players: [] });
    expect(parseListResponse("Unknown command")).toBeNull();
  });

  it("parses Paper TPS with colour codes", () => {
    expect(parseTpsResponse("§6TPS from last 1m, 5m, 15m: §a19.98, §a20.0, §a20.0")).toBe(19.98);
    expect(parseTpsResponse("§6TPS from last 1m, 5m, 15m: §a*20.0, §a*20.0, §a*20.0")).toBe(20);
    expect(stripColors("\x1b[32mhi§r")).toBe("hi");
  });
});

describe("crypto", () => {
  const key = "a".repeat(64);
  it("encrypts and decrypts, and detects tampering", () => {
    const enc = encrypt("secret", key);
    expect(decrypt(enc, key)).toBe("secret");
    const [iv, tag, data] = enc.split(".");
    const flipped = (data!.startsWith("A") ? "B" : "A") + data!.slice(1);
    expect(() => decrypt([iv, tag, flipped].join("."), key)).toThrow();
  });

  it("generates ids from the allowed alphabet", () => {
    expect(randomId(12)).toMatch(/^[a-z0-9]{12}$/);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});

describe("pngSize", () => {
  it("reads IHDR dimensions and rejects non-PNG data", async () => {
    const { pngSize } = await import("./png.js");
    const head = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write("IHDR", 12, "ascii");
    head.writeUInt32BE(64, 16);
    head.writeUInt32BE(64, 20);
    expect(pngSize(head)).toEqual({ width: 64, height: 64 });
    expect(pngSize(Buffer.from("GIF89a-not-a-png-at-all!"))).toBeNull();
    expect(pngSize(Buffer.alloc(4))).toBeNull();
  });
});

describe("parseModList", () => {
  it("splits lines, commas and bullets, dedupes case-insensitively", async () => {
    const { parseModList } = await import("../plugins/modlist.js");
    expect(parseModList("1. Create\n- JEI, jei\n• Sodium;  Iron Chests\n\nx")).toEqual(["Create", "JEI", "Sodium", "Iron Chests"]);
  });
});

describe("explainNetworkError", () => {
  it("translates known codes", () => {
    expect(explainNetworkError("UND_ERR_CONNECT_TIMEOUT")).toContain("не удалось подключиться");
    expect(explainNetworkError("ENOTFOUND")).toContain("DNS");
  });
  it("falls back to the raw code", () => {
    expect(explainNetworkError("WEIRD")).toBe("WEIRD");
    expect(explainNetworkError(undefined)).toContain("неизвестная");
  });
});

describe("parseCompare", () => {
  it("reports an update when main is ahead of the installed commit", () => {
    const info = parseCompare("abc1234", { status: "ahead", ahead_by: 2, commits: [{ sha: "1111111aaaa", commit: { message: "one" } }, { sha: "2222222bbbb", commit: { message: "feat: new thing\n\nbody" } }] });
    expect(info).toEqual({ current: "abc1234", available: true, behindBy: 2, latest: "2222222", message: "feat: new thing" });
  });

  it("stays silent when identical, behind or diverged", () => {
    for (const status of ["identical", "behind", "diverged"]) expect(parseCompare("abc1234", { status, ahead_by: 3 }).available).toBe(false);
  });
});

describe("notify gating", () => {
  it("telegramRequest uses relay headers only when a relay key is set", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return new Response("{}");
    }) as typeof fetch;
    try {
      await telegramRequest({ telegramBotToken: "1:abc", telegramApiBase: "", telegramRelayKey: "" }, "hi", "42");
      await telegramRequest({ telegramBotToken: "1:abc", telegramApiBase: "https://relay.example/tg/", telegramRelayKey: "k" }, "hi", "42");
    } finally {
      globalThis.fetch = real;
    }
    expect(calls[0]?.url).toBe("https://api.telegram.org/bot1:abc/sendMessage");
    expect(calls[0]?.headers["x-relay-key"]).toBeUndefined();
    expect(calls[1]?.url).toBe("https://relay.example/tg/sendMessage");
    expect(calls[1]?.headers).toMatchObject({ "x-relay-key": "k", "x-bot-token": "1:abc" });
  });
});
