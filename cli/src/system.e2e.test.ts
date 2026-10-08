import { spawn, execFile } from "node:child_process";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { GlobalStateStore } from "./util/global-state.js";
import { ClientInstanceManager } from "./instance/ClientInstanceManager.js";
import { resolveClientInstanceDir } from "./util/paths.js";

const execFileAsync = promisify(execFile);
const CLI_ENTRY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "index.js",
);

// Minimal Paper stand-in: logs to logs/latest.log, listens on server-port,
// echoes `say` and exits on `stop`.
const FAKE_SERVER = `
import fs from "node:fs";
import net from "node:net";
import readline from "node:readline";

const props = fs.readFileSync("server.properties", "utf8");
const port = Number(props.match(/^server-port=(\\d+)/m)[1]);
fs.mkdirSync("logs", { recursive: true });
fs.writeFileSync("logs/latest.log", "");
const log = (message) => fs.appendFileSync("logs/latest.log", "[INFO]: " + message + "\\n");
net.createServer((socket) => socket.destroy()).listen(port, "127.0.0.1", () => log("Done (0.1s)!"));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "stop") process.exit(0);
  if (line.startsWith("say ")) log("[Server] " + line.slice(4));
});
`;

/** A `java` stand-in that runs `script` with node, forwarding all arguments. */
async function writeFakeJava(dir: string, script: string) {
  if (process.platform === "win32") {
    const shim = path.join(dir, "fake-java.cmd");
    await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
    return shim;
  }
  const shim = path.join(dir, "fake-java");
  await writeFile(
    shim,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    {
      mode: 0o755,
    },
  );
  return shim;
}

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
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function spawnDetachedNode(script: string, args: string[]) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, ...args],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  return child;
}

async function runCli(cwd: string, mctHome: string, args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [CLI_ENTRY, ...args],
    { cwd, env: { ...process.env, MCT_HOME: mctHome } },
  );
  return JSON.parse(stdout) as { success: boolean; data: any };
}

test("system e2e: project-local server plus client through up/exec/wait-log/down", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-system-e2e-"));
  const mctHome = path.join(tempDir, "mct-home");
  const projectDir = path.join(tempDir, "project");
  const serverDir = path.join(projectDir, "run", "paper-dev");
  const serverPort = await getFreePort();
  const wsPort = await getFreePort();
  const originalMctHome = process.env.MCT_HOME;
  const wsProbe = spawnDetachedNode(
    `
      import { WebSocketServer } from "ws";
      const server = new WebSocketServer({ port: Number(process.argv[1]) });
      server.on("connection", (socket) => {
        socket.on("message", (raw) => {
          const request = JSON.parse(raw.toString());
          const data = request.action === "position.get"
            ? { x: 0, y: 64, z: 0 }
            : { echoedAction: request.action, params: request.params ?? {} };
          socket.send(JSON.stringify({ id: request.id, success: true, data }));
        });
      });
      setInterval(() => {}, 1000);
    `,
    [String(wsPort)],
  );
  assert.ok(wsProbe.pid);

  try {
    await mkdir(projectDir, { recursive: true });
    process.env.MCT_HOME = mctHome;

    const init = await runCli(projectDir, mctHome, ["init", "--name", "demo"]);
    assert.equal(init.success, true);
    assert.deepEqual(init.data.gitignoreAdded, ["run/", ".mct/"]);
    await access(path.join(projectDir, "run"));

    await mkdir(serverDir, { recursive: true });
    await writeFile(path.join(serverDir, "paper-1.21.1.jar"), "");
    await writeFile(
      path.join(serverDir, "server.properties"),
      `online-mode=false\nserver-port=${serverPort}\n`,
    );
    await writeFile(path.join(tempDir, "fake-server.mjs"), FAKE_SERVER);
    const fakeJava = await writeFakeJava(
      tempDir,
      path.join(tempDir, "fake-server.mjs"),
    );

    const projectFilePath = path.join(projectDir, "mct.json");
    const projectFile = JSON.parse(await readFile(projectFilePath, "utf8"));
    projectFile.defaultProfile = "dev";
    projectFile.profiles = {
      dev: { server: "paper-dev", clients: ["fabric-dev"] },
    };
    projectFile.servers = { "paper-dev": { java: fakeJava } };
    projectFile.timeout = { serverReady: 10, clientReady: 5, default: 2 };
    await writeFile(projectFilePath, JSON.stringify(projectFile, null, 2));

    const globalState = new GlobalStateStore();
    await new ClientInstanceManager(globalState).create({
      name: "fabric-dev",
      version: "1.20.4",
      wsPort,
      launchArgs: ["--game-dir", "/tmp/game"],
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
          instanceDir: resolveClientInstanceDir("fabric-dev"),
        },
      },
    });

    const info = await runCli(projectDir, mctHome, ["info"]);
    assert.equal(info.data.project, "demo");
    assert.equal(
      info.data.projectConfigPath,
      path.join(await realpath(projectDir), "mct.json"),
    );

    const up = await runCli(projectDir, mctHome, ["up", "--eula"]);
    assert.equal(up.success, true, JSON.stringify(up));
    assert.equal(up.data.ready, true);
    assert.equal(up.data.serversReady[0].ready, true);

    const exec = await runCli(projectDir, mctHome, [
      "server",
      "exec",
      "say",
      "hello",
    ]);
    assert.equal(exec.success, true);
    assert.deepEqual(exec.data.output, ["[INFO]: [Server] hello"]);

    const waited = await runCli(projectDir, mctHome, [
      "wait-log",
      "--grep",
      "hello",
      "--after",
      String(exec.data.cursor),
      "--timeout",
      "2",
    ]);
    assert.equal(waited.data.line, "[INFO]: [Server] hello");

    const status = await runCli(projectDir, mctHome, ["server", "status"]);
    assert.equal(status.data.servers[0].name, "paper-dev");
    assert.equal(status.data.servers[0].running, true);

    const chat = await runCli(projectDir, mctHome, ["chat", "send", "hi"]);
    assert.equal(chat.data.data.echoedAction, "chat.send");

    const down = await runCli(projectDir, mctHome, ["down"]);
    assert.equal(down.success, true);
    assert.equal(down.data.allClean, true);
    assert.equal(down.data.servers[0].graceful, true);
    await assert.rejects(access(path.join(serverDir, ".mct-runtime.json")));
    assert.deepEqual((await globalState.readClientState()).clients, {});
  } finally {
    if (originalMctHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = originalMctHome;
    }
    try {
      process.kill(wsProbe.pid ?? 0, "SIGTERM");
    } catch {
      /* ignore */
    }
    await execFileAsync(
      process.execPath,
      [CLI_ENTRY, "server", "stop", serverDir],
      {
        env: { ...process.env, MCT_HOME: mctHome },
      },
    ).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
});
