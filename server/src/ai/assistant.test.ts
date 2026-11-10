import { describe, expect, it } from "vitest";
import type { ServerRow } from "../servers/repo.js";
import { runTool, type Ctx } from "./assistant.js";

const server = { id: "abc12345", name: "Test", core: "fabric", mc_version: "1.21.1" } as unknown as ServerRow;
const ctx = (permissions: string[], isOwner = false): Ctx => ({ server, access: { isOwner, permissions: permissions as never }, actions: [] });

describe("assistant tools", () => {
  it("need a server page and the matching permission", async () => {
    expect(await runTool("read_console", {}, { server: null, access: null, actions: [] })).toMatch(/не на странице сервера/);
    expect(await runTool("read_console", {}, ctx(["plugins"]))).toMatch(/нет права «console»/);
    expect(await runTool("nope", {}, ctx([], true))).toBe("Нет такого инструмента.");
  });

  it("only propose actions the user may do, with validated arguments", async () => {
    const c = ctx(["plugins"]);
    expect(await runTool("propose_action", { kind: "power", title: "x", action: "restart" }, c)).toMatch(/нет прав/);
    expect(await runTool("propose_action", { kind: "install_addon", title: "Sodium", source: "evil", id: "x" }, c)).toMatch(/source и id/);
    await runTool("propose_action", { kind: "install_addon", title: "Sodium", source: "modrinth", id: "AANobbMI" }, c);
    expect(c.actions).toEqual([{ kind: "install_addon", title: "Sodium", source: "modrinth", id: "AANobbMI" }]);

    const owner = ctx([], true);
    await runTool("propose_action", { kind: "command", title: "op", command: "/op Steve" }, owner);
    expect(owner.actions[0]).toMatchObject({ kind: "command", command: "op Steve" });
    expect(await runTool("propose_action", { kind: "rm_rf", title: "x" }, owner)).toBe("Неизвестное действие.");
  });
});
