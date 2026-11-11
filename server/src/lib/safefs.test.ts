import { mkdtemp, mkdir, readFile, readlink, readdir, rm, symlink, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirInside, readInside, writeInside } from "./safefs.js";

// Symlinks need a POSIX system (CI and the VPS); skip on Windows dev machines.
const posix = process.platform !== "win32";

describe.runIf(posix)("safefs", () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "safefs-"));
    root = join(base, "server");
    outside = join(base, "panel");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "panel.db"), "SECRET");
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("replaces a symlink at the destination instead of writing through it", async () => {
    await symlink(join(outside, "panel.db"), join(root, "x.toml"));
    await writeInside(root, join(root, "x.toml"), "pack data");
    expect(await readFile(join(outside, "panel.db"), "utf8")).toBe("SECRET");
    expect((await lstat(join(root, "x.toml"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(root, "x.toml"), "utf8")).toBe("pack data");
  });

  it("refuses a parent folder that is a symlink out of the server", async () => {
    await symlink(outside, join(root, "config"));
    await expect(writeInside(root, join(root, "config", "panel.db"), "pwned")).rejects.toThrow(/за пределы/);
    expect(await readFile(join(outside, "panel.db"), "utf8")).toBe("SECRET");
  });

  it("follows symlinked folders that stay inside the server", async () => {
    await mkdir(join(root, "real"));
    await symlink(join(root, "real"), join(root, "alias"));
    await writeInside(root, join(root, "alias", "a.txt"), "ok");
    expect(await readFile(join(root, "real", "a.txt"), "utf8")).toBe("ok");
  });

  it("creates nested folders and refuses a dangling link to outside", async () => {
    const dir = await mkdirInside(root, join(root, "a", "b", "c"));
    expect(dir.endsWith(join("a", "b", "c"))).toBe(true);
    await symlink(join(outside, "new"), join(root, "d"));
    await expect(mkdirInside(root, join(root, "d", "e"))).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["panel.db"]);
  });

  it("writes a stream", async () => {
    const n = await writeInside(root, join(root, "a", "data.bin"), Readable.from([Buffer.alloc(300), Buffer.alloc(200)]));
    expect(n).toBe(500);
    expect((await readFile(join(root, "a", "data.bin"))).length).toBe(500);
    expect(await readdir(join(root, "a"))).toEqual(["data.bin"]);
  });

  it("stops a stream at maxBytes and leaves nothing behind", async () => {
    const big = Readable.from([Buffer.alloc(1000), Buffer.alloc(1000)]);
    await expect(writeInside(root, join(root, "big.bin"), big, { maxBytes: 1500, tooBig: () => new Error("too big") })).rejects.toThrow("too big");
    expect(await readdir(root)).toEqual([]);
  });

  it("reads regular files only, never through links or from devices", async () => {
    await writeFile(join(root, "ok.json"), "[]");
    expect((await readInside(root, join(root, "ok.json"))).toString()).toBe("[]");
    await symlink(join(outside, "panel.db"), join(root, "leak.json"));
    await expect(readInside(root, join(root, "leak.json"))).rejects.toThrow();
    await symlink("/dev/zero", join(root, "zero.json"));
    await expect(readInside(root, join(root, "zero.json"))).rejects.toThrow();
    expect(await readlink(join(root, "zero.json"))).toBe("/dev/zero");
  });

  it("refuses to read a file outside the server even when given its real path", async () => {
    if (process.platform !== "linux") return;
    await expect(readInside(root, join(outside, "panel.db"))).rejects.toThrow(/за пределы/);
  });
});
