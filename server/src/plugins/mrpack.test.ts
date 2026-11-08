import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipArchive } from "archiver";
import { describe, expect, it } from "vitest";
import { allowedDownload, inspectFile, isServerFile, missingDependencies, packTarget, parseFabricModJson, parseIndex, safePackPath } from "./mrpack.js";

const sha = "a".repeat(128);
const index = (deps: Record<string, string>, files: unknown[] = []) =>
  JSON.stringify({ formatVersion: 1, game: "minecraft", versionId: "2.0.1", name: "Homestead", files, dependencies: deps });

describe("mrpack index", () => {
  it("reads the loader and version the pack needs", () => {
    expect(packTarget(parseIndex(index({ minecraft: "1.20.1", "fabric-loader": "0.19.5" })))).toEqual({ core: "fabric", mcVersion: "1.20.1", build: "0.19.5" });
    expect(packTarget(parseIndex(index({ minecraft: "1.20.1", forge: "47.2.0" })))).toEqual({ core: "forge", mcVersion: "1.20.1", build: "47.2.0" });
    expect(packTarget(parseIndex(index({ minecraft: "1.21.1", neoforge: "21.1.77" })))).toEqual({ core: "neoforge", mcVersion: "1.21.1", build: "21.1.77" });
  });

  it("refuses Quilt, missing loaders and non-Minecraft packs", () => {
    expect(() => packTarget(parseIndex(index({ minecraft: "1.20.1", "quilt-loader": "0.26" })))).toThrow(/Quilt/);
    expect(() => packTarget(parseIndex(index({ minecraft: "1.20.1" })))).toThrow(/загрузчик/);
    expect(() => parseIndex(JSON.stringify({ formatVersion: 1, game: "terraria", versionId: "1", name: "x", files: [], dependencies: {} }))).toThrow();
    expect(() => parseIndex("{not json")).toThrow(/повреждён/);
  });

  it("knows which files belong on the server", () => {
    const f = (server?: string) => ({ path: "mods/a.jar", hashes: { sha512: sha }, downloads: ["https://cdn.modrinth.com/a.jar"], fileSize: 1, env: server ? { client: "required", server } : undefined });
    expect(isServerFile(f("required"))).toBe(true);
    expect(isServerFile(f("optional"))).toBe(true);
    expect(isServerFile(f())).toBe(true);
    expect(isServerFile(f("unsupported"))).toBe(false);
  });
});

describe("mrpack safety", () => {
  it("keeps paths inside the server and away from the core install", () => {
    expect(safePackPath("mods/sodium.jar")).toBe("mods/sodium.jar");
    expect(safePackPath("config\\jei.toml")).toBe("config/jei.toml");
    expect(safePackPath("../etc/passwd")).toBeNull();
    expect(safePackPath("mods/../../x")).toBeNull();
    expect(safePackPath("/etc/passwd")).toBeNull();
    expect(safePackPath("C:/x")).toBeNull();
    expect(safePackPath("server.jar")).toBeNull();
    expect(safePackPath("libraries/net/x.jar")).toBeNull();
    expect(safePackPath("eula.txt")).toBeNull();
  });

  it("downloads only from the hosts the format allows", () => {
    expect(allowedDownload("https://cdn.modrinth.com/data/x/versions/y/a.jar")).toBe(true);
    expect(allowedDownload("https://github.com/o/r/releases/download/1/a.jar")).toBe(true);
    expect(allowedDownload("http://cdn.modrinth.com/a.jar")).toBe(false);
    expect(allowedDownload("https://evil.example/a.jar")).toBe(false);
    expect(allowedDownload("https://cdn.modrinth.com.evil.example/a.jar")).toBe(false);
  });
});

describe("fabric dependencies", () => {
  it("finds what server mods need but nothing provides", () => {
    const mods = [
      { ids: ["chipped"], depends: ["athena", "fabric-api", "minecraft", "fabricloader"], clientOnly: false },
      { ids: ["sodium"], depends: ["iris-lib"], clientOnly: true },
      { ids: ["jade", "jade-api"], depends: ["jade-api"], clientOnly: false },
    ];
    expect([...missingDependencies(mods).entries()]).toEqual([["athena", ["chipped"]]]);
  });

  it("parses fabric.mod.json written with raw newlines in strings", () => {
    expect(parseFabricModJson('{"id":"athena","description":"line1\nline2"}')?.id).toBe("athena");
    expect(parseFabricModJson("not json")).toBeNull();
  });
});

describe("inspectFile", () => {
  it("reads a real .mrpack zip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mrpack-"));
    const path = join(dir, "p.mrpack");
    const zip = new ZipArchive({ zlib: { level: 1 } });
    const done = new Promise((r) => createWriteStream(path).on("close", r).on("open", function (this: NodeJS.WritableStream) { zip.pipe(this); }));
    zip.append(
      index({ minecraft: "1.20.1", "fabric-loader": "0.19.5" }, [
        { path: "mods/a.jar", hashes: { sha512: sha }, downloads: ["https://cdn.modrinth.com/a.jar"], fileSize: 3 * 1048576, env: { client: "required", server: "required" } },
        { path: "mods/b.jar", hashes: { sha512: sha }, downloads: ["https://cdn.modrinth.com/b.jar"], fileSize: 1, env: { client: "required", server: "unsupported" } },
      ]),
      { name: "modrinth.index.json" },
    );
    zip.append("x=1", { name: "overrides/config/a.toml" });
    zip.append("y=1", { name: "server-overrides/config/b.toml" });
    await zip.finalize();
    await done;
    const info = await inspectFile(path);
    expect(info).toMatchObject({ name: "Homestead", version: "2.0.1", core: "fabric", mcVersion: "1.20.1", serverFiles: 1, clientOnlyFiles: 1, downloadMb: 3, overrideFiles: 2 });
  });
});
