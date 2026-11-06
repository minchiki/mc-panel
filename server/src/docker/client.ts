import Docker from "dockerode";
import { TarArchive, ZipArchive } from "archiver";
import { PassThrough, type Duplex } from "node:stream";

/**
 * The only module that talks to the Docker socket. Everything here is scoped
 * to containers/networks/images labelled as ours; nothing accepts raw user
 * input for image names, mounts or capabilities.
 */
export const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const LABEL = "mc-panel.server";
export const DB_NETWORK = "mcp-db";

export const containerName = (serverId: string) => `mcp-${serverId}`;
export const networkName = (serverId: string) => `mcp-net-${serverId}`;
export const javaImage = (java: number) => `eclipse-temurin:${java}-jre`;

export interface GameContainerSpec {
  serverId: string;
  image: string;
  uid: number;
  gid: number;
  dataDir: string;
  port: number;
  internalPort: number;
  memoryMb: number;
  cpus: number;
  command: string;
  joinDbNetwork: boolean;
}

export async function inspectContainer(name: string): Promise<Docker.ContainerInspectInfo | null> {
  try {
    return await docker.getContainer(name).inspect();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function removeContainer(name: string): Promise<void> {
  try {
    await docker.getContainer(name).remove({ force: true, v: true });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

export async function ensureNetwork(name: string, labels: Record<string, string> = {}): Promise<void> {
  const existing = await docker.listNetworks({ filters: { name: [name] } });
  if (existing.some((n) => n.Name === name)) return;
  await docker.createNetwork({ Name: name, Driver: "bridge", Labels: { "mc-panel": "1", ...labels } });
}

export async function removeNetwork(name: string): Promise<void> {
  try {
    await docker.getNetwork(name).remove();
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

export async function ensureImage(image: string, onProgress?: (line: string) => void): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  onProgress?.(`Скачиваю образ ${image}...`);
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve())));
  onProgress?.(`Образ ${image} готов`);
}

/** Hardened container for one Minecraft server. Data dir is the only mount. */
export async function createGameContainer(spec: GameContainerSpec): Promise<Docker.Container> {
  const name = containerName(spec.serverId);
  const net = networkName(spec.serverId);
  await removeContainer(name);
  await ensureNetwork(net, { [LABEL]: spec.serverId });
  const portKey = `${spec.internalPort}/tcp`;
  const udpKey = `${spec.internalPort}/udp`;
  const container = await docker.createContainer({
    name,
    Image: spec.image,
    Cmd: ["sh", "-c", `exec ${spec.command}`],
    WorkingDir: "/data",
    User: `${spec.uid}:${spec.gid}`,
    Env: ["HOME=/data", "TERM=xterm-256color", "TZ=Europe/Moscow"],
    Labels: { [LABEL]: spec.serverId },
    OpenStdin: true,
    StdinOnce: false,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    ExposedPorts: { [portKey]: {}, [udpKey]: {} },
    HostConfig: {
      Binds: [`${spec.dataDir}:/data`],
      PortBindings: { [portKey]: [{ HostPort: String(spec.port) }], [udpKey]: [{ HostPort: String(spec.port) }] },
      Memory: spec.memoryMb * 1024 * 1024,
      MemorySwap: spec.memoryMb * 1024 * 1024,
      NanoCpus: Math.round(spec.cpus * 1e9),
      PidsLimit: 1024,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,exec,nosuid,size=512m" },
      Init: true,
      RestartPolicy: { Name: "no" },
      NetworkMode: net,
      Ulimits: [{ Name: "nofile", Soft: 65536, Hard: 65536 }],
      LogConfig: { Type: "json-file", Config: { "max-size": "20m", "max-file": "2" } },
    },
  });
  if (spec.joinDbNetwork) {
    await ensureNetwork(DB_NETWORK);
    await docker.getNetwork(DB_NETWORK).connect({ Container: container.id });
  }
  return container;
}

/** Bidirectional stdin/stdout stream; stdout+stderr are demultiplexed into `output`. */
export async function attachContainer(name: string): Promise<{ input: Duplex; output: PassThrough }> {
  const container = docker.getContainer(name);
  const stream = (await container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true })) as Duplex;
  const output = new PassThrough();
  container.modem.demuxStream(stream, output, output);
  stream.on("end", () => output.end());
  return { input: stream, output };
}

export async function containerLogsTail(name: string, lines: number): Promise<string> {
  const buf = (await docker.getContainer(name).logs({ stdout: true, stderr: true, tail: lines, follow: false })) as unknown as Buffer;
  return demuxBuffer(buf);
}

/** Decode Docker's 8-byte-header multiplexed log format. */
export function demuxBuffer(buf: Buffer): string {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    parts.push(buf.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(parts).toString("utf8");
}

export async function containerIp(name: string, network: string): Promise<string | null> {
  const info = await inspectContainer(name);
  return info?.NetworkSettings.Networks[network]?.IPAddress || null;
}

/**
 * Runs a throw-away container (installers, BuildTools) with the same isolation
 * as game containers and streams its output. Resolves with the exit code.
 */
export async function runOneShot(opts: {
  image: string;
  cmd: string[];
  binds: string[];
  uid: number;
  gid: number;
  memoryMb: number;
  workingDir?: string;
  env?: string[];
  /** e.g. `container:<name>` to share a game container's network namespace. */
  networkMode?: string;
  onLine: (line: string) => void;
}): Promise<number> {
  const container = await docker.createContainer({
    Image: opts.image,
    Cmd: opts.cmd,
    WorkingDir: opts.workingDir ?? "/data",
    User: `${opts.uid}:${opts.gid}`,
    Env: opts.env ?? ["HOME=/data"],
    Labels: { "mc-panel": "oneshot" },
    Tty: false,
    HostConfig: {
      Binds: opts.binds,
      Memory: opts.memoryMb * 1024 * 1024,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: 1024,
      Tmpfs: { "/tmp": "rw,exec,nosuid,size=1g" },
      AutoRemove: false,
      ...(opts.networkMode ? { NetworkMode: opts.networkMode } : {}),
    },
  });
  try {
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    const out = new PassThrough();
    container.modem.demuxStream(stream, out, out);
    pipeLines(out, opts.onLine);
    await container.start();
    const result = (await container.wait()) as { StatusCode: number };
    return result.StatusCode;
  } finally {
    await container.remove({ force: true }).catch(() => undefined);
  }
}

/** Build a local image from an in-memory Dockerfile (used for the BuildTools image). */
export async function buildImage(tag: string, dockerfile: string, onLine: (line: string) => void): Promise<void> {
  const tar = new TarArchive();
  tar.append(dockerfile, { name: "Dockerfile" });
  void tar.finalize();
  const stream = await docker.buildImage(tar as unknown as NodeJS.ReadableStream, { t: tag, labels: { "mc-panel": "1" } });
  await new Promise<void>((resolve, reject) =>
    docker.modem.followProgress(
      stream,
      (err, res: Array<{ error?: string }>) => {
        const failed = res?.find((r) => r.error);
        if (err || failed) reject(err ?? new Error(failed?.error));
        else resolve();
      },
      (evt: { stream?: string }) => evt.stream?.trim() && onLine(evt.stream.trim()),
    ),
  );
}

export function pipeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let pending = "";
  stream.on("data", (chunk: Buffer | string) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (pending) onLine(pending);
    pending = "";
  });
}

export function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "statusCode" in err && (err as { statusCode: number }).statusCode === 404;
}
