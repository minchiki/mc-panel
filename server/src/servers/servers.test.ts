import { describe, expect, it } from "vitest";
import { sanitizeExcludes } from "../backups/service.js";
import { guessJava, pickJava } from "../cores/java.js";
import { compareVersions, neoforgeToMc } from "../cores/versions.js";
import { demuxBuffer } from "../docker/client.js";
import { buildCommand, heapMb, internalPort, isNoiseLine, isReadyLine, stopCommand, voiceChatUpdates } from "./prepare.js";
import { parseSsRtt } from "./ping.js";
import { parsePlayerAddress, parsePlayerEvent } from "./players.js";
import type { ServerRow } from "./repo.js";
import { computeStats } from "./stats.js";

describe("java selection", () => {
  it("maps Mojang requirements onto shipped runtimes", () => {
    expect(pickJava(8)).toBe(8);
    expect(pickJava(16)).toBe(17);
    expect(pickJava(21)).toBe(21);
    expect(pickJava(25)).toBe(25);
  });

  it("guesses by version when metadata is unavailable", () => {
    expect(guessJava("1.12.2")).toBe(8);
    expect(guessJava("1.18.2")).toBe(17);
    expect(guessJava("1.20.4")).toBe(17);
    expect(guessJava("1.20.6")).toBe(21);
    expect(guessJava("26.3")).toBe(25);
  });
});

describe("versions", () => {
  it("maps NeoForge versions to Minecraft versions", () => {
    expect(neoforgeToMc("21.1.77")).toBe("1.21.1");
    expect(neoforgeToMc("21.0.167")).toBe("1.21");
    expect(neoforgeToMc("20.4.237")).toBe("1.20.4");
    expect(neoforgeToMc("26.3.0.94")).toBe("26.3");
    expect(neoforgeToMc("26.1.2.5")).toBe("26.1.2");
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.21.10", "1.21.9")).toBeGreaterThan(0);
    expect(compareVersions("26.1", "1.21.4")).toBeGreaterThan(0);
    expect(compareVersions("1.20", "1.20.0")).toBe(0);
  });
});

describe("prepare", () => {
  const server = { core: "paper", ram_mb: 2048, startup: "java {{XMS}} {{XMX}} {{FLAGS}} -jar server.jar nogui", jvm_flags: "-XX:+UseG1GC" } as ServerRow;

  it("leaves headroom for non-heap memory", () => {
    expect(heapMb(2048)).toBe(1280);
    expect(heapMb(10240)).toBe(8192);
    expect(heapMb(8192)).toBe(8192 - 1638);
    expect(heapMb(512)).toBe(256);
  });

  it("builds the JVM command line", () => {
    expect(buildCommand(server)).toBe("java -Xms1280M -Xmx1280M -Djava.net.preferIPv4Stack=true -XX:+UseG1GC -jar server.jar nogui");
  });

  it("knows ports, stop commands and ready lines per core", () => {
    expect(internalPort("paper")).toBe(25565);
    expect(internalPort("velocity")).toBe(25577);
    expect(stopCommand("velocity")).toBe("shutdown");
    expect(stopCommand("bungeecord")).toBe("end");
    expect(isReadyLine("paper", '[12:00:01 INFO]: Done (3.512s)! For help, type "help"')).toBe(true);
    expect(isReadyLine("velocity", "[12:00:01 INFO]: Done (812ms)!")).toBe(true);
    expect(isReadyLine("bungeecord", "Listening on /0.0.0.0:25577")).toBe(true);
    expect(isReadyLine("paper", "Starting minecraft server")).toBe(false);
    expect(isNoiseLine("[05:58:18 INFO]: Thread RCON Client /172.18.0.1 shutting down")).toBe(true);
    expect(isNoiseLine("[05:58:18 INFO]: Steve joined the game")).toBe(false);
  });
});

describe("players", () => {
  it("parses join and leave lines", () => {
    expect(parsePlayerEvent("[12:00:00] [Server thread/INFO]: Steve joined the game")).toEqual({ kind: "join", player: "Steve" });
    expect(parsePlayerEvent("[12:00:00 INFO]: \x1b[33mAlex left the game\x1b[0m")).toEqual({ kind: "leave", player: "Alex" });
    expect(parsePlayerEvent("<Steve> I joined the game yesterday")).toBeNull();
  });
});

describe("player ping", () => {
  it("parses the remote address from the login line", () => {
    expect(parsePlayerAddress("[12:00:00 INFO]: Steve[/1.2.3.4:51234] logged in with entity id 42 at (0.5, 64.0, 0.5)")).toEqual({
      player: "Steve",
      address: "1.2.3.4:51234",
    });
    expect(parsePlayerAddress("[12:00:00 INFO]: Steve joined the game")).toBeNull();
  });

  it("maps ss output to peer address and rtt", () => {
    const out = [
      "ESTAB 0 0 172.18.0.2:25565 1.2.3.4:51234",
      "\t cubic wscale:7,7 rto:224 rtt:23.5/11.2 ato:40 mss:1448 cwnd:10",
      "ESTAB 0 0 172.18.0.2:25565 [::ffff:5.6.7.8]:40000",
      "\t cubic rto:204 rtt:3/1.5 mss:1448",
    ].join("\n");
    expect([...parseSsRtt("0 0 172.18.0.2:25565 80.251.224.57:3309\n\t bbr rto:203 rtt:2.154/1.329 ato:99")]).toEqual([["80.251.224.57:3309", 2]]);
    expect([...parseSsRtt(out)]).toEqual([
      ["1.2.3.4:51234", 24],
      ["5.6.7.8:40000", 3],
    ]);
  });
});

describe("backups", () => {
  it("makes excludes relative and drops traversal", () => {
    expect(sanitizeExcludes("logs\n/etc\n../x\n./cache\n\nworld/../../y\nplugins/dynmap/web")).toEqual(["logs", "etc", "cache", "plugins/dynmap/web"]);
  });
});

describe("docker helpers", () => {
  it("demultiplexes docker log frames", () => {
    const frame = (stream: number, text: string) => {
      const body = Buffer.from(text);
      const head = Buffer.alloc(8);
      head.writeUInt8(stream, 0);
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    expect(demuxBuffer(Buffer.concat([frame(1, "hello\n"), frame(2, "err\n")]))).toBe("hello\nerr\n");
  });

  it("computes CPU and memory from docker stats", () => {
    const s = computeStats(
      {
        cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 20_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
        memory_stats: { usage: 600 * 1024 * 1024, stats: { inactive_file: 100 * 1024 * 1024 } },
        networks: { eth0: { rx_bytes: 10, tx_bytes: 20 } },
      },
      2048,
    );
    expect(s.cpu).toBe(40);
    expect(s.memMb).toBe(500);
    expect(s.netRx).toBe(10);
  });
});

describe("simple voice chat", () => {
  const row = (port: number) => ({ core: "fabric", port }) as ServerRow;

  it("rides the game UDP port and advertises the host port", () => {
    expect(voiceChatUpdates(row(25565), "")).toEqual({ port: "25565", bind_address: "", voice_host: "" });
    expect(voiceChatUpdates(row(25567), "").voice_host).toBe("25567");
  });

  it("keeps an owner-set host but fixes its port", () => {
    expect(voiceChatUpdates(row(25570), "play.my.ru:24454").voice_host).toBe("play.my.ru:25570");
  });
});
