import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { resolveProfileServerAddress } from "./commands/client.js";
import { ClientInstanceManager } from "./instance/ClientInstanceManager.js";
import { ensureServerPortProperty, ServerInstanceManager } from "./instance/ServerInstanceManager.js";
import { GlobalStateStore } from "./util/global-state.js";

test("resolveProfileServerAddress prefers explicit server and falls back to active profile metadata", async () => {
  const context = {
    projectId: "demo",
    activeProfile: {
      server: "paper",
      clients: ["bot"]
    },
    globalState: {} as GlobalStateStore
  };

  assert.equal(await resolveProfileServerAddress(context, "127.0.0.1:30000"), "127.0.0.1:30000");
  assert.equal(
    await resolveProfileServerAddress(context, undefined, async (projectId, serverName) => {
      assert.equal(projectId, "demo");
      assert.equal(serverName, "paper");
      return 25569;
    }),
    "127.0.0.1:25569"
  );
});

test("ServerInstanceManager.create writes server.properties with the assigned port", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-create-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const store = new GlobalStateStore();
    const manager = new ServerInstanceManager(store, "demo");
    const meta = await manager.create({
      name: "paper",
      project: "demo",
      type: "paper",
      version: "1.20.4",
      port: 25569
    });

    assert.equal(meta.port, 25569);

    const propertiesPath = path.join(process.env.MCT_HOME!, "projects", "demo", "paper", "server.properties");
    const content = await readFile(propertiesPath, "utf8");
    assert.match(content, /^server-port=25569$/m);
  } finally {
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureServerPortProperty repairs an existing server-port entry", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-props-"));

  try {
    await writeFile(path.join(tempDir, "server.properties"), "motd=Demo\nserver-port=25565\n", "utf8");
    await ensureServerPortProperty(tempDir, 25569);

    const content = await readFile(path.join(tempDir, "server.properties"), "utf8");
    assert.match(content, /^motd=Demo$/m);
    assert.match(content, /^server-port=25569$/m);
    assert.equal((content.match(/^server-port=/gm) ?? []).length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ServerInstanceManager.readLogs strips ANSI by default and preserves them with --raw-colors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-logs-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const logPath = path.join(process.env.MCT_HOME!, "logs", "server-demo-paper.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, "\u001b[38;2;85;85;85m[INFO]\u001b[0m Ready\n", "utf8");

    const stateDir = path.join(process.env.MCT_HOME!, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, "servers.json"),
      JSON.stringify(
        {
          servers: {
            "demo/paper": {
              pid: process.pid,
              project: "demo",
              name: "paper",
              port: 25569,
              startedAt: new Date().toISOString(),
              logPath,
              instanceDir: path.join(process.env.MCT_HOME!, "projects", "demo", "paper")
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const manager = new ServerInstanceManager(new GlobalStateStore(), "demo");
    const clean = await manager.readLogs("paper");
    const raw = await manager.readLogs("paper", { rawColors: true });

    assert.deepEqual(clean.lines, ["[INFO] Ready"]);
    assert.match(raw.lines[0]!, /\u001b\[38;2;85;85;85m/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ServerInstanceManager.waitReady reports startup phase and recent logs on timeout", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-wait-timeout-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const logPath = path.join(process.env.MCT_HOME!, "logs", "server-demo-paper.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, "Downloading mojang_1.20.4.jar\nApplying patches\n", "utf8");

    const stateDir = path.join(process.env.MCT_HOME!, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, "servers.json"),
      JSON.stringify(
        {
          servers: {
            "demo/paper": {
              pid: process.pid,
              project: "demo",
              name: "paper",
              port: 1,
              startedAt: new Date().toISOString(),
              logPath,
              instanceDir: path.join(process.env.MCT_HOME!, "projects", "demo", "paper")
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const manager = new ServerInstanceManager(new GlobalStateStore(), "demo");
    await assert.rejects(
      () => manager.waitReady("paper", 0.05),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, "TIMEOUT");
        const details = (error as { details?: { phase?: string; recentLines?: string[] } }).details;
        assert.equal(details?.phase, "downloading");
        assert.deepEqual(details?.recentLines, ["Downloading mojang_1.20.4.jar", "Applying patches"]);
        return true;
      }
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ServerInstanceManager.waitReady returns recent startup logs when the port becomes reachable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-wait-ready-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");
  const listener = net.createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => resolve());
    });
    const address = listener.address();
    assert.ok(address && typeof address !== "string");

    const logPath = path.join(process.env.MCT_HOME!, "logs", "server-demo-paper.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, "Preparing level \"world\"\nDone (3.531s)! For help, type \"help\"\n", "utf8");

    const stateDir = path.join(process.env.MCT_HOME!, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, "servers.json"),
      JSON.stringify(
        {
          servers: {
            "demo/paper": {
              pid: process.pid,
              project: "demo",
              name: "paper",
              port: address.port,
              startedAt: new Date().toISOString(),
              logPath,
              instanceDir: path.join(process.env.MCT_HOME!, "projects", "demo", "paper")
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const manager = new ServerInstanceManager(new GlobalStateStore(), "demo");
    const result = await manager.waitReady("paper", 0.5);
    assert.equal(result.phase, "ready");
    assert.equal(result.lastLine, "Done (3.531s)! For help, type \"help\"");
    assert.deepEqual(result.recentLines, ["Preparing level \"world\"", "Done (3.531s)! For help, type \"help\""]);
  } finally {
    listener.close();
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ServerInstanceManager.waitReady preserves the live startup phase when the port becomes reachable early", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-wait-phase-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");
  const listener = net.createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => resolve());
    });
    const address = listener.address();
    assert.ok(address && typeof address !== "string");

    const logPath = path.join(process.env.MCT_HOME!, "logs", "server-demo-paper.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, "Preparing level \"world\"\nPreparing start region for dimension minecraft:overworld\n", "utf8");

    const stateDir = path.join(process.env.MCT_HOME!, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, "servers.json"),
      JSON.stringify(
        {
          servers: {
            "demo/paper": {
              pid: process.pid,
              project: "demo",
              name: "paper",
              port: address.port,
              startedAt: new Date().toISOString(),
              logPath,
              instanceDir: path.join(process.env.MCT_HOME!, "projects", "demo", "paper")
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const manager = new ServerInstanceManager(new GlobalStateStore(), "demo");
    const result = await manager.waitReady("paper", 0.5);
    assert.equal(result.phase, "initializing-world");
    assert.equal(result.lastLine, "Preparing start region for dimension minecraft:overworld");
    assert.deepEqual(result.recentLines, [
      "Preparing level \"world\"",
      "Preparing start region for dimension minecraft:overworld"
    ]);
  } finally {
    listener.close();
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ClientInstanceManager.create assigns unique ws ports across concurrent callers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-create-race-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const createClient = (name: string) => {
      const manager = new ClientInstanceManager(new GlobalStateStore());
      return manager.create({
        name,
        version: "1.20.4"
      });
    };

    const clients = await Promise.all(
      Array.from({ length: 6 }, (_value, index) => createClient(`bot-${index}`))
    );

    assert.equal(new Set(clients.map((entry) => entry.wsPort)).size, clients.length);
  } finally {
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("GlobalStateStore.updateClientState serializes concurrent client state mutations", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-state-lock-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const alphaEntry = {
      pid: 101,
      name: "alpha",
      wsPort: 25580,
      startedAt: new Date().toISOString(),
      logPath: path.join(process.env.MCT_HOME!, "logs", "alpha.log"),
      instanceDir: path.join(process.env.MCT_HOME!, "clients", "alpha")
    };
    const bravoEntry = {
      pid: 102,
      name: "bravo",
      wsPort: 25581,
      startedAt: new Date().toISOString(),
      logPath: path.join(process.env.MCT_HOME!, "logs", "bravo.log"),
      instanceDir: path.join(process.env.MCT_HOME!, "clients", "bravo")
    };

    const slowStore = new GlobalStateStore();
    const fastStore = new GlobalStateStore();

    await Promise.all([
      slowStore.updateClientState(async (state) => {
        state.defaultClient = "alpha";
        state.clients.alpha = alphaEntry;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
      fastStore.updateClientState((state) => {
        state.clients.bravo = bravoEntry;
      })
    ]);

    const finalState = await new GlobalStateStore().readClientState();
    assert.equal(finalState.defaultClient, "alpha");
    assert.deepEqual(Object.keys(finalState.clients).sort(), ["alpha", "bravo"]);
  } finally {
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
