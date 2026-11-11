import { ZipArchive } from "archiver";
import { createWriteStream, mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../auth/users.js";
import { openDb } from "../db/index.js";
import { dataDirOf, insertServer } from "../servers/repo.js";
import { readText, saveUpload, unzip, writeText, zipPaths } from "./service.js";

const posix = process.platform !== "win32";
const ID = "filetest";
let root: string;
let outside: string;

async function makeZip(path: string, entries: Record<string, string>): Promise<void> {
  const archive = new ZipArchive();
  const done = pipeline(archive, createWriteStream(path));
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  await archive.finalize();
  await done;
}

describe.runIf(posix)("file manager", () => {
  beforeAll(async () => {
    openDb(mkdtempSync(join(tmpdir(), "mcp-files-")));
    const owner = await createUser({ username: "alex", password: "long-password-1", role: "user" });
    insertServer({
      id: ID, owner_id: owner.id, name: "Test", core: "paper", mc_version: "1.21.4", core_build: null, java_version: 21,
      ram_mb: 1024, cpu_limit: 1, disk_mb: 1, port: 25599, startup: "", jvm_flags: "", domain: null,
      desired_state: "stopped", install_state: "installed", auto_restart: 0, rcon_password: "x",
    });
  });
  beforeEach(async () => {
    root = dataDirOf(ID);
    outside = mkdtempSync(join(tmpdir(), "mcp-outside-"));
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(join(outside, "panel.db"), "SECRET");
  });
  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  it("zips and unzips a folder", async () => {
    await mkdir(join(root, "world"));
    await writeFile(join(root, "world", "level.dat"), "level");
    const zip = await zipPaths(ID, ["world"], "w");
    expect(zip).toBe("w.zip");
    await mkdir(join(root, "copy"));
    expect(await unzip(ID, "w.zip", "copy")).toBe(1);
    expect(await readFile(join(root, "copy", "world", "level.dat"), "utf8")).toBe("level");
  });

  it("does not create an archive in a folder that links outside", async () => {
    await symlink(outside, join(root, "link"));
    await expect(zipPaths(ID, ["link/panel.db"], "x")).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["panel.db"]);
  });

  it("does not unzip through a planted folder link", async () => {
    await symlink(outside, join(root, "config"));
    await makeZip(join(root, "pack.zip"), { "config/panel.db": "pwned" });
    await expect(unzip(ID, "pack.zip")).rejects.toThrow();
    expect(await readFile(join(outside, "panel.db"), "utf8")).toBe("SECRET");
  });

  it("stops an upload at the disk limit and keeps nothing", async () => {
    const twoMb = Readable.from([Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024)]);
    await expect(saveUpload(ID, "", "big.bin", twoMb)).rejects.toThrow(/Недостаточно места/);
    expect(await readdir(root)).toEqual([]);
  });

  it("edits text files but never reads through a link to outside", async () => {
    await writeText(ID, "ops.json", "[]");
    expect((await readText(ID, "ops.json")).content).toBe("[]");
    await symlink(join(outside, "panel.db"), join(root, "leak.txt"));
    await expect(readText(ID, "leak.txt")).rejects.toThrow();
  });
});
