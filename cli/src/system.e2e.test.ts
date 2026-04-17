import { spawn, execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { GlobalStateStore } from "./util/global-state.js";
import { ClientInstanceManager } from "./instance/ClientInstanceManager.js";
import { ServerInstanceManager } from "./instance/ServerInstanceManager.js";
import { resolveClientInstanceDir, resolveServerInstanceDir } from "./util/paths.js";

const execFileAsync = promisify(execFile);
const CLI_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");

async function getFreePort() {
  const net = await import("node:net");
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve a test port"));
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

function spawnDetachedNode(script: string, args: string[]) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, ...args], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child;
}

async function runCli(cwd: string, mctHome: string, args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [
    CLI_ENTRY,
    ...args
  ], {
    cwd,
    env: {
      ...process.env,
      MCT_HOME: mctHome
    }
  });

  return JSON.parse(stdout) as { success: boolean; data: any };
}

test("system e2e: CLI orchestrates the current global instance workflow", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-system-e2e-"));
  const mctHome = path.join(tempDir, "mct-home");
  const projectDir = path.join(tempDir, "project");
  const serverPort = await getFreePort();
  const wsPort = await getFreePort();
  const originalMctHome = process.env.MCT_HOME;
  const serverProbe = spawnDetachedNode(
    `
      import net from "node:net";
      const port = Number(process.argv[1]);
      const server = net.createServer();
      server.listen(port, "127.0.0.1");
      setInterval(() => {}, 1000);
    `,
    [String(serverPort)]
  );
  const wsProbe = spawnDetachedNode(
    `
      import { WebSocketServer } from "ws";
      const port = Number(process.argv[1]);
      const server = new WebSocketServer({ port });
      server.on("connection", (socket) => {
        socket.on("message", (raw) => {
          const request = JSON.parse(raw.toString());
          if (request.action === "position.get") {
            socket.send(JSON.stringify({
              id: request.id,
              success: true,
              data: { x: 0, y: 64, z: 0 }
            }));
            return;
          }
          socket.send(JSON.stringify({
            id: request.id,
            success: true,
            data: {
              echoedAction: request.action,
              params: request.params ?? {}
            }
          }));
        });
      });
      setInterval(() => {}, 1000);
    `,
    [String(wsPort)]
  );
  assert.ok(serverProbe.pid);
  assert.ok(wsProbe.pid);

  try {
    await mkdir(projectDir, { recursive: true });
    process.env.MCT_HOME = mctHome;

    const initResult = await runCli(projectDir, mctHome, ["init", "--name", "test-project"]);
    assert.equal(initResult.success, true);

    const globalState = new GlobalStateStore();
    const serverManager = new ServerInstanceManager(globalState, "test-project");
    const clientManager = new ClientInstanceManager(globalState);

    await serverManager.create({
      name: "paper-dev",
      project: "test-project",
      type: "paper",
      version: "1.20.4",
      port: serverPort
    });
    await clientManager.create({
      name: "fabric-dev",
      version: "1.20.4",
      wsPort,
      launchArgs: ["--runtime-root", "/tmp/runtime", "--version-id", "1.20.4", "--game-dir", "/tmp/game"]
    });

    const projectFilePath = path.join(projectDir, "mct.project.json");
    await writeFile(projectFilePath, JSON.stringify({
      project: "test-project",
      defaultProfile: "dev",
      profiles: {
        dev: {
          server: "paper-dev",
          clients: ["fabric-dev"]
        }
      },
      screenshot: { outputDir: "./screenshots" },
      timeout: {
        serverReady: 5,
        clientReady: 5,
        default: 2
      }
    }, null, 2));

    await globalState.writeServerState({
      servers: {
        "test-project/paper-dev": {
          pid: serverProbe.pid,
          project: "test-project",
          name: "paper-dev",
          port: serverPort,
          startedAt: new Date().toISOString(),
          logPath: path.join(mctHome, "logs", "server.log"),
          instanceDir: resolveServerInstanceDir("test-project", "paper-dev")
        }
      }
    });
    await globalState.writeClientState({
      defaultClient: "fabric-dev",
      clients: {
        "fabric-dev": {
          pid: wsProbe.pid,
          name: "fabric-dev",
          wsPort,
          startedAt: new Date().toISOString(),
          logPath: path.join(mctHome, "logs", "client.log"),
          instanceDir: resolveClientInstanceDir("fabric-dev")
        }
      }
    });

    const infoResult = await runCli(projectDir, mctHome, ["info"]);
    assert.equal(infoResult.success, true);
    assert.equal(infoResult.data.project, "test-project");
    assert.equal(infoResult.data.activeProfile.server, "paper-dev");

    const serverReadyResult = await runCli(projectDir, mctHome, ["server", "wait-ready"]);
    assert.equal(serverReadyResult.success, true);

    const clientReadyResult = await runCli(projectDir, mctHome, ["client", "wait-ready"]);
    assert.equal(clientReadyResult.success, true);
    assert.equal(clientReadyResult.data.inWorld, true);

    const chatResult = await runCli(projectDir, mctHome, ["chat", "send", "hello system e2e"]);
    assert.equal(chatResult.success, true);
    assert.equal(chatResult.data.data.echoedAction, "chat.send");
    assert.equal(chatResult.data.data.params.message, "hello system e2e");

    const downResult = await runCli(projectDir, mctHome, ["down"]);
    assert.equal(downResult.success, true);
    assert.equal(downResult.data.allClean, true);

    const serverState = await globalState.readServerState();
    const clientState = await globalState.readClientState();
    assert.deepEqual(serverState.servers, {});
    assert.deepEqual(clientState.clients, {});

    const persistedProject = JSON.parse(await readFile(projectFilePath, "utf8"));
    assert.equal(persistedProject.defaultProfile, "dev");
  } finally {
    if (originalMctHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = originalMctHome;
    }

    try { process.kill(serverProbe.pid ?? 0, "SIGTERM"); } catch { /* ignore */ }
    try { process.kill(wsProbe.pid ?? 0, "SIGTERM"); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  }
});
