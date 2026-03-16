import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

import type { Command } from "commander";
import { WebSocketServer } from "ws";

import { buildProgram } from "./index.js";

const execFileAsync = promisify(execFile);

interface RequestCase {
  leaf: string;
  argv: string[];
  action: string;
  params: Record<string, unknown>;
}

interface CliResult {
  success: boolean;
  data: unknown;
}

const NON_REQUEST_LEAF_COMMANDS = [
  "client launch",
  "client list",
  "client stop",
  "client wait-ready",
  "config-show",
  "server start",
  "server status",
  "server stop",
  "server wait-ready"
];

const REQUEST_CASES: RequestCase[] = [
  {
    leaf: "anvil",
    argv: ["anvil", "--input-slot", "2", "--rename", "Renamed"],
    action: "craft.anvil",
    params: { inputSlot: 2, rename: "Renamed" }
  },
  {
    leaf: "block break",
    argv: ["block", "break", "1", "64", "2"],
    action: "block.break",
    params: { x: 1, y: 64, z: 2 }
  },
  {
    leaf: "block get",
    argv: ["block", "get", "1", "64", "2"],
    action: "block.get",
    params: { x: 1, y: 64, z: 2 }
  },
  {
    leaf: "block interact",
    argv: ["block", "interact", "1", "64", "2"],
    action: "block.interact",
    params: { x: 1, y: 64, z: 2 }
  },
  {
    leaf: "block place",
    argv: ["block", "place", "1", "64", "2", "--face", "up"],
    action: "block.place",
    params: { x: 1, y: 64, z: 2, face: "up" }
  },
  {
    leaf: "book read",
    argv: ["book", "read"],
    action: "book.read",
    params: {}
  },
  {
    leaf: "book sign",
    argv: ["book", "sign", "--title", "Guide", "--author", "Bot"],
    action: "book.sign",
    params: { title: "Guide", author: "Bot" }
  },
  {
    leaf: "book write",
    argv: ["book", "write", "--pages", "Page1", "Page2"],
    action: "book.write",
    params: { pages: ["Page1", "Page2"] }
  },
  {
    leaf: "channel listen",
    argv: ["channel", "listen", "mct:test", "--timeout", "7"],
    action: "channel.listen",
    params: { channel: "mct:test", timeout: 7 }
  },
  {
    leaf: "channel send",
    argv: ["channel", "send", "mct:test", "--data", "{\"ok\":true,\"count\":2}"],
    action: "channel.send",
    params: { channel: "mct:test", data: { ok: true, count: 2 } }
  },
  {
    leaf: "chat command",
    argv: ["chat", "command", "/spawn"],
    action: "chat.command",
    params: { command: "/spawn" }
  },
  {
    leaf: "chat history",
    argv: ["chat", "history", "--last", "5"],
    action: "chat.history",
    params: { last: 5 }
  },
  {
    leaf: "chat last",
    argv: ["chat", "last"],
    action: "chat.last",
    params: {}
  },
  {
    leaf: "chat send",
    argv: ["chat", "send", "hello matrix"],
    action: "chat.send",
    params: { message: "hello matrix" }
  },
  {
    leaf: "chat wait",
    argv: ["chat", "wait", "--match", "Joined", "--timeout", "7"],
    action: "chat.wait",
    params: { match: "Joined", timeout: 7 }
  },
  {
    leaf: "craft",
    argv: ["craft", "--recipe", "{\"type\":\"minecraft:crafting_shapeless\"}"],
    action: "craft.craft",
    params: { recipe: { type: "minecraft:crafting_shapeless" } }
  },
  {
    leaf: "effects particles",
    argv: ["effects", "particles", "--last", "4"],
    action: "effects.particles",
    params: { last: 4 }
  },
  {
    leaf: "effects sounds",
    argv: ["effects", "sounds", "--last", "3"],
    action: "effects.sounds",
    params: { last: 3 }
  },
  {
    leaf: "enchant",
    argv: ["enchant", "--option", "1"],
    action: "craft.enchant",
    params: { option: 1 }
  },
  {
    leaf: "entity attack",
    argv: ["entity", "attack", "--type", "minecraft:zombie"],
    action: "entity.attack",
    params: { filter: { type: "minecraft:zombie" } }
  },
  {
    leaf: "entity dismount",
    argv: ["entity", "dismount"],
    action: "entity.dismount",
    params: {}
  },
  {
    leaf: "entity info",
    argv: ["entity", "info", "--id", "42"],
    action: "entity.info",
    params: { id: 42 }
  },
  {
    leaf: "entity interact",
    argv: ["entity", "interact", "--name", "Villager"],
    action: "entity.interact",
    params: { filter: { name: "Villager" } }
  },
  {
    leaf: "entity list",
    argv: ["entity", "list", "--radius", "16"],
    action: "entity.list",
    params: { radius: 16 }
  },
  {
    leaf: "entity mount",
    argv: ["entity", "mount", "--nearest", "--max-distance", "8"],
    action: "entity.mount",
    params: { filter: { nearest: true, maxDistance: 8 } }
  },
  {
    leaf: "entity steer",
    argv: ["entity", "steer", "--forward", "--left", "--jump", "--sneak"],
    action: "entity.steer",
    params: { forward: 1, sideways: 1, jump: true, sneak: true }
  },
  {
    leaf: "gui click",
    argv: ["gui", "click", "13", "--button", "right", "--key", "2"],
    action: "gui.click",
    params: { slot: 13, button: "right", key: 2 }
  },
  {
    leaf: "gui close",
    argv: ["gui", "close"],
    action: "gui.close",
    params: {}
  },
  {
    leaf: "gui drag",
    argv: ["gui", "drag", "--slots", "1,2,5", "--button", "left"],
    action: "gui.drag",
    params: { slots: [1, 2, 5], button: "left" }
  },
  {
    leaf: "gui info",
    argv: ["gui", "info"],
    action: "gui.info",
    params: {}
  },
  {
    leaf: "gui screenshot",
    argv: ["gui", "screenshot", "--output", "/tmp/gui.png"],
    action: "gui.screenshot",
    params: { output: "/tmp/gui.png" }
  },
  {
    leaf: "gui slot",
    argv: ["gui", "slot", "9"],
    action: "gui.slot",
    params: { slot: 9 }
  },
  {
    leaf: "gui snapshot",
    argv: ["gui", "snapshot"],
    action: "gui.snapshot",
    params: {}
  },
  {
    leaf: "gui wait-open",
    argv: ["gui", "wait-open", "--timeout", "6"],
    action: "gui.wait-open",
    params: { timeout: 6 }
  },
  {
    leaf: "gui wait-update",
    argv: ["gui", "wait-update", "--timeout", "6"],
    action: "gui.wait-update",
    params: { timeout: 6 }
  },
  {
    leaf: "hud actionbar",
    argv: ["hud", "actionbar"],
    action: "hud.actionbar",
    params: {}
  },
  {
    leaf: "hud bossbar",
    argv: ["hud", "bossbar"],
    action: "hud.bossbar",
    params: {}
  },
  {
    leaf: "hud nametag",
    argv: ["hud", "nametag", "--player", "Steve"],
    action: "hud.nametag",
    params: { player: "Steve" }
  },
  {
    leaf: "hud scoreboard",
    argv: ["hud", "scoreboard"],
    action: "hud.scoreboard",
    params: {}
  },
  {
    leaf: "hud tab",
    argv: ["hud", "tab"],
    action: "hud.tab",
    params: {}
  },
  {
    leaf: "hud title",
    argv: ["hud", "title"],
    action: "hud.title",
    params: {}
  },
  {
    leaf: "inventory drop",
    argv: ["inventory", "drop", "--all"],
    action: "inventory.drop",
    params: { all: true }
  },
  {
    leaf: "inventory get",
    argv: ["inventory", "get"],
    action: "inventory.get",
    params: {}
  },
  {
    leaf: "inventory held",
    argv: ["inventory", "held"],
    action: "inventory.held",
    params: {}
  },
  {
    leaf: "inventory hotbar",
    argv: ["inventory", "hotbar", "4"],
    action: "inventory.hotbar",
    params: { slot: 4 }
  },
  {
    leaf: "inventory slot",
    argv: ["inventory", "slot", "7"],
    action: "inventory.slot",
    params: { slot: 7 }
  },
  {
    leaf: "inventory swap-hands",
    argv: ["inventory", "swap-hands"],
    action: "inventory.swap-hands",
    params: {}
  },
  {
    leaf: "inventory use",
    argv: ["inventory", "use"],
    action: "inventory.use",
    params: {}
  },
  {
    leaf: "look at",
    argv: ["look", "at", "1", "65", "2"],
    action: "look.at",
    params: { x: 1, y: 65, z: 2 }
  },
  {
    leaf: "look entity",
    argv: ["look", "entity", "--id", "77"],
    action: "look.entity",
    params: { filter: { id: 77 } }
  },
  {
    leaf: "look set",
    argv: ["look", "set", "--yaw", "90", "--pitch", "-15"],
    action: "look.set",
    params: { yaw: 90, pitch: -15 }
  },
  {
    leaf: "move back",
    argv: ["move", "back", "2"],
    action: "move.direction",
    params: { direction: "back", blocks: 2 }
  },
  {
    leaf: "move forward",
    argv: ["move", "forward", "3"],
    action: "move.direction",
    params: { direction: "forward", blocks: 3 }
  },
  {
    leaf: "move jump",
    argv: ["move", "jump"],
    action: "move.jump",
    params: {}
  },
  {
    leaf: "move left",
    argv: ["move", "left", "1"],
    action: "move.direction",
    params: { direction: "left", blocks: 1 }
  },
  {
    leaf: "move right",
    argv: ["move", "right", "4"],
    action: "move.direction",
    params: { direction: "right", blocks: 4 }
  },
  {
    leaf: "move sneak",
    argv: ["move", "sneak", "on"],
    action: "move.sneak",
    params: { enabled: true }
  },
  {
    leaf: "move sprint",
    argv: ["move", "sprint", "off"],
    action: "move.sprint",
    params: { enabled: false }
  },
  {
    leaf: "move to",
    argv: ["move", "to", "1", "64", "2"],
    action: "move.to",
    params: { x: 1, y: 64, z: 2 }
  },
  {
    leaf: "position get",
    argv: ["position", "get"],
    action: "position.get",
    params: {}
  },
  {
    leaf: "resourcepack accept",
    argv: ["resourcepack", "accept"],
    action: "resourcepack.accept",
    params: {}
  },
  {
    leaf: "resourcepack reject",
    argv: ["resourcepack", "reject"],
    action: "resourcepack.reject",
    params: {}
  },
  {
    leaf: "resourcepack status",
    argv: ["resourcepack", "status"],
    action: "resourcepack.status",
    params: {}
  },
  {
    leaf: "rotation get",
    argv: ["rotation", "get"],
    action: "rotation.get",
    params: {}
  },
  {
    leaf: "screen size",
    argv: ["screen", "size"],
    action: "screen.size",
    params: {}
  },
  {
    leaf: "screenshot",
    argv: ["screenshot", "--output", "/tmp/full.png", "--region", "1,2,3,4", "--gui"],
    action: "capture.screenshot",
    params: { output: "/tmp/full.png", region: "1,2,3,4", gui: true }
  },
  {
    leaf: "sign edit",
    argv: ["sign", "edit", "1", "64", "2", "--lines", "a", "b", "c", "d"],
    action: "sign.edit",
    params: { x: 1, y: 64, z: 2, lines: ["a", "b", "c", "d"] }
  },
  {
    leaf: "sign read",
    argv: ["sign", "read", "1", "64", "2"],
    action: "sign.read",
    params: { x: 1, y: 64, z: 2 }
  },
  {
    leaf: "status all",
    argv: ["status", "all"],
    action: "status.all",
    params: {}
  },
  {
    leaf: "status effects",
    argv: ["status", "effects"],
    action: "status.effects",
    params: {}
  },
  {
    leaf: "status experience",
    argv: ["status", "experience"],
    action: "status.experience",
    params: {}
  },
  {
    leaf: "status gamemode",
    argv: ["status", "gamemode"],
    action: "status.gamemode",
    params: {}
  },
  {
    leaf: "status health",
    argv: ["status", "health"],
    action: "status.health",
    params: {}
  },
  {
    leaf: "status world",
    argv: ["status", "world"],
    action: "status.world",
    params: {}
  },
  {
    leaf: "trade",
    argv: ["trade", "--index", "3"],
    action: "craft.trade",
    params: { index: 3 }
  },
  {
    leaf: "wait",
    argv: [
      "wait",
      "2",
      "--ticks",
      "40",
      "--until-health-above",
      "18",
      "--until-gui-open",
      "--until-on-ground",
      "--timeout",
      "8"
    ],
    action: "wait.perform",
    params: {
      seconds: 2,
      ticks: 40,
      untilHealthAbove: 18,
      untilGuiOpen: true,
      untilOnGround: true,
      timeout: 8
    }
  }
];

function collectLeafCommands(command: Command, parents: string[] = []): string[] {
  if (command.commands.length === 0) {
    return [parents.join(" ")];
  }

  return command.commands.flatMap((child) => collectLeafCommands(child, [...parents, child.name()]));
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function createRequestTestHarness(options?: { timeoutDefault?: number; responseDelayMs?: number }) {
  const cwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-matrix-"));
  const stateDir = path.join(tempDir, "state");
  const configPath = path.join(tempDir, "mct.config.json");
  const wsPort = await getFreePort();
  const responseDelayMs = options?.responseDelayMs ?? 0;
  const server = new WebSocketServer({ port: wsPort });

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as {
        id: string;
        action: string;
        params: Record<string, unknown>;
      };

      setTimeout(() => {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: true,
            data: {
              echoedAction: request.action,
              params: request.params
            }
          })
        );
      }, responseDelayMs);
    });
  });

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        clients: {
          bot: {
            wsPort,
            launchCommand: ["node", "--eval", "setInterval(() => {}, 1000)"]
          }
        },
        timeout: {
          serverReady: 5,
          clientReady: 5,
          default: options?.timeoutDefault ?? 5
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    path.join(stateDir, "clients.json"),
    JSON.stringify(
      {
        defaultClient: "bot",
        clients: {
          bot: {
            name: "bot",
            wsPort,
            headless: false,
            pid: process.pid,
            startedAt: new Date().toISOString(),
            logPath: path.join(stateDir, "bot.log")
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    async runCli(args: string[]) {
      const { stdout } = await execFileAsync(process.execPath, [
        path.join(cwd, "dist/index.js"),
        "--config",
        configPath,
        "--state-dir",
        stateDir,
        ...args
      ]);

      return JSON.parse(stdout) as CliResult;
    },
    async cleanup() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

test("CLI leaf commands are fully covered by automated tests", () => {
  const actualLeafCommands = collectLeafCommands(buildProgram()).sort();
  const coveredLeafCommands = [...NON_REQUEST_LEAF_COMMANDS, ...REQUEST_CASES.map((entry) => entry.leaf)].sort();

  assert.deepEqual(coveredLeafCommands, actualLeafCommands);
});

test("CLI request commands route every leaf command to the expected action and params", async (t) => {
  const harness = await createRequestTestHarness();

  try {
    for (const entry of REQUEST_CASES) {
      await t.test(entry.leaf, async () => {
        const result = await harness.runCli(entry.argv);
        assert.equal(result.success, true);
        assert.equal((result.data as { data: { echoedAction: string } }).data.echoedAction, entry.action);
        assert.deepEqual((result.data as { data: { params: Record<string, unknown> } }).data.params, entry.params);
      });
    }
  } finally {
    await harness.cleanup();
  }
});

test("CLI request commands honor explicit timeout overrides", async () => {
  const harness = await createRequestTestHarness({
    timeoutDefault: 1,
    responseDelayMs: 1500
  });

  try {
    const chatWait = await harness.runCli(["chat", "wait", "--match", "Joined", "--timeout", "2"]);
    assert.equal(chatWait.success, true);
    assert.equal((chatWait.data as { data: { echoedAction: string } }).data.echoedAction, "chat.wait");

    const waitResult = await harness.runCli(["wait", "2"]);
    assert.equal(waitResult.success, true);
    assert.equal((waitResult.data as { data: { echoedAction: string } }).data.echoedAction, "wait.perform");
  } finally {
    await harness.cleanup();
  }
});
