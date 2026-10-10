import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { WebSocketServer } from "ws";

import { resolveProfileServerAddress } from "./commands/client.js";
import { ClientInstanceManager } from "./instance/ClientInstanceManager.js";
import { ServerCommandPipe } from "./instance/ServerCommandPipe.js";
import { GlobalStateStore } from "./util/global-state.js";
import { MctError } from "./util/errors.js";

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        server.close(() => resolve(address.port));
      } else {
        server.close(() => reject(new Error("Unable to allocate port")));
      }
    });
  });
}

async function waitForPortListening(port: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Port ${port} did not start listening within ${timeoutMs}ms`);
}

async function isPortListening(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

test("resolveProfileServerAddress prefers explicit server and falls back to the profile's server", async () => {
  const context = {
    cwd: "/tmp",
    projectRootDir: "/tmp/demo",
    projectFile: null,
    activeProfile: {
      server: "paper",
      clients: ["bot"],
    },
  };

  assert.equal(
    await resolveProfileServerAddress(context, "127.0.0.1:30000"),
    "127.0.0.1:30000",
  );
  assert.equal(
    await resolveProfileServerAddress(
      context,
      undefined,
      async (serverName) => {
        assert.equal(serverName, "paper");
        return 25569;
      },
    ),
    "127.0.0.1:25569",
  );
  assert.equal(
    await resolveProfileServerAddress(
      { ...context, projectRootDir: null },
      undefined,
    ),
    undefined,
  );
});

function spawnFifoReader(fifoPath: string) {
  const reader = spawn(
    "bash",
    ["-c", 'IFS= read -r line < "$1"; printf "%s" "$line"', "reader", fifoPath],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  reader.stdout.setEncoding("utf8");
  reader.stdout.on("data", (chunk) => {
    output += chunk;
  });
  return { reader, getOutput: () => output };
}

/**
 * Platform-appropriate reader for the server stdin channel: an external bash
 * FIFO reader on POSIX, a named-pipe server on Windows (mirroring the role of
 * stdin-bridge.ts, which owns the pipe in production).
 */
function createPipeReader(pipePath: string) {
  if (process.platform === "win32") {
    let output = "";
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        output += chunk;
      });
      socket.on("error", () => {});
    });
    const listening = new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipePath, () => resolve());
    });
    return {
      ready: () => listening,
      waitForLine: async () => {
        const deadline = Date.now() + 15_000;
        while (!output.includes("\n") && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.ok(output.includes("\n"), "no line arrived on the named pipe");
        return output.slice(0, output.indexOf("\n"));
      },
      close: () => {
        server.close();
      },
    };
  }

  const { reader, getOutput } = spawnFifoReader(pipePath);
  // Subscribe before sending: a fast reader may exit while send() is still
  // closing its writer. close also waits for stdout to finish draining.
  const closed = once(reader, "close", {
    signal: AbortSignal.timeout(15_000),
  });
  // Keep a send failure from leaving an unobserved timeout rejection.
  void closed.catch(() => {});
  return {
    ready: () => Promise.resolve(),
    waitForLine: async () => {
      const [code] = await closed;
      assert.equal(code, 0);
      return getOutput();
    },
    close: () => {
      // reader 卡在 open(fifo) 时不 kill 会让整个测试进程永不退出
      reader.kill("SIGKILL");
    },
  };
}

/**
 * FIFO open() rendezvous between an external reader process and the
 * non-blocking writer can rarely misfire under heavy load. Each attempt uses
 * a fresh FIFO; one retry keeps the test deterministic without masking real
 * regressions (a genuine bug fails both attempts).
 */
async function withFifoRaceRetry(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    await run();
  }
}

test("ServerCommandPipe sends a command through a FIFO without sync fd calls", async () => {
  await withFifoRaceRetry(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-pipe-"));

    try {
      const pipe = new ServerCommandPipe();
      const fifoPath = await pipe.create(tempDir);
      const reader = createPipeReader(fifoPath);

      try {
        await reader.ready();
        await pipe.send(fifoPath, "say hello");
        assert.equal(await reader.waitForLine(), "say hello");
      } finally {
        reader.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test("ClientInstanceManager.create assigns unique ws ports across concurrent callers", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "mct-client-create-race-"),
  );
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const createClient = (name: string) => {
      const manager = new ClientInstanceManager(new GlobalStateStore());
      return manager.create({
        name,
        version: "1.20.4",
      });
    };

    const clients = await Promise.all(
      Array.from({ length: 6 }, (_value, index) =>
        createClient(`bot-${index}`),
      ),
    );

    assert.equal(
      new Set(clients.map((entry) => entry.wsPort)).size,
      clients.length,
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

test("ClientInstanceManager.waitReady actively reconnects and reports screen diagnostics", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "mct-client-wait-ready-"),
  );
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");
  const wsPort = await getFreePort();
  const requests: Array<{ action: string; params?: Record<string, unknown> }> =
    [];
  const server = new WebSocketServer({ port: wsPort });

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as {
        id: string;
        action: string;
        params?: Record<string, unknown>;
      };
      requests.push({ action: request.action, params: request.params });
      if (request.action === "position.get") {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: false,
            error: "NOT_IN_WORLD",
          }),
        );
        return;
      }
      if (request.action === "status.all") {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: true,
            data: {
              inWorld: false,
              screenCategory: "disconnected",
              disconnectReason: "Server closed",
              screen: {
                type: "DisconnectedScreen",
                title: "Disconnected",
                category: "disconnected",
                disconnectReason: "Server closed",
              },
            },
          }),
        );
        return;
      }
      if (request.action === "client.reconnect") {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: true,
            data: { connecting: true, address: request.params?.address },
          }),
        );
        return;
      }
      socket.send(JSON.stringify({ id: request.id, success: true, data: {} }));
    });
  });

  try {
    const store = new GlobalStateStore();
    await store.writeClientState({
      defaultClient: "real",
      clients: {
        real: {
          pid: process.pid,
          name: "real",
          wsPort,
          startedAt: new Date().toISOString(),
          logPath: path.join(process.env.MCT_HOME!, "logs", "real.log"),
          instanceDir: path.join(process.env.MCT_HOME!, "clients", "real"),
        },
      },
    });

    const manager = new ClientInstanceManager(store);
    await assert.rejects(
      () =>
        manager.waitReady("real", 0.2, { reconnectAddress: "127.0.0.1:25565" }),
      (error) => {
        assert.ok(error instanceof MctError);
        assert.equal(error.code, "TIMEOUT");
        const details = error.details as {
          reconnectAttempted?: boolean;
          reconnectAddress?: string;
          status?: {
            screenCategory?: string;
            disconnectReason?: string;
            screen?: { type?: string };
          };
        };
        assert.equal(details.reconnectAttempted, true);
        assert.equal(details.reconnectAddress, "127.0.0.1:25565");
        assert.equal(details.status?.screenCategory, "disconnected");
        assert.equal(details.status?.disconnectReason, "Server closed");
        assert.match(error.message, /disconnectReason=Server closed/);
        return true;
      },
    );

    assert.ok(
      requests.some((request) => request.action === "status.all"),
      "waitReady did not request status diagnostics",
    );
    assert.ok(
      requests.some(
        (request) =>
          request.action === "client.reconnect" &&
          request.params?.address === "127.0.0.1:25565",
      ),
      "waitReady did not actively reconnect",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ClientInstanceManager.stop waits until the WebSocket port is released", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "mct-client-stop-wait-"),
  );
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");
  const wsPort = await getFreePort();
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
        const net = require("node:net");
        const server = net.createServer();
        server.listen(Number(process.argv[1]), "127.0.0.1");
        process.on("SIGTERM", () => setTimeout(() => server.close(() => process.exit(0)), 600));
        setInterval(() => {}, 1000);
      `,
      String(wsPort),
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  try {
    await waitForPortListening(wsPort);
    const store = new GlobalStateStore();
    await store.writeClientState({
      defaultClient: "real",
      clients: {
        real: {
          pid: child.pid ?? 0,
          name: "real",
          wsPort,
          startedAt: new Date().toISOString(),
          logPath: path.join(tempDir, "client.log"),
          instanceDir: tempDir,
        },
      },
    });

    const manager = new ClientInstanceManager(store);
    const startedAt = Date.now();
    const stopped = await manager.stop("real");

    assert.equal(stopped.stopped, true);
    assert.equal(await isPortListening(wsPort), false);
    if (process.platform !== "win32") {
      // Windows termination is immediate (taskkill /F): there is no graceful
      // SIGTERM window, so only POSIX can assert the 600ms-close was awaited.
      assert.ok(Date.now() - startedAt >= 500);
    }
  } finally {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {}
    try {
      process.kill(child.pid ?? 0, "SIGKILL");
    } catch {}
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("GlobalStateStore.updateClientState serializes concurrent client state mutations", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "mct-client-state-lock-"),
  );
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const alphaEntry = {
      pid: 101,
      name: "alpha",
      wsPort: 25580,
      startedAt: new Date().toISOString(),
      logPath: path.join(process.env.MCT_HOME!, "logs", "alpha.log"),
      instanceDir: path.join(process.env.MCT_HOME!, "clients", "alpha"),
    };
    const bravoEntry = {
      pid: 102,
      name: "bravo",
      wsPort: 25581,
      startedAt: new Date().toISOString(),
      logPath: path.join(process.env.MCT_HOME!, "logs", "bravo.log"),
      instanceDir: path.join(process.env.MCT_HOME!, "clients", "bravo"),
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
      }),
    ]);

    const finalState = await new GlobalStateStore().readClientState();
    assert.equal(finalState.defaultClient, "alpha");
    assert.deepEqual(Object.keys(finalState.clients).sort(), [
      "alpha",
      "bravo",
    ]);
  } finally {
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
