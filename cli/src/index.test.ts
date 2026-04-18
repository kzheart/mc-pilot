import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { WebSocketServer } from "ws";
import { createDefaultProjectFile } from "./util/project.js";

const execFileAsync = promisify(execFile);

async function writeProjectConfig(
  mctHome: string,
  projectDir: string,
  overrides: Record<string, unknown>
) {
  const base = createDefaultProjectFile(projectDir, String(overrides.project ?? "test"));
  const projectFile = {
    ...base,
    ...overrides,
    screenshot: overrides.screenshot ? { ...base.screenshot, ...(overrides.screenshot as object) } : base.screenshot,
    timeout: overrides.timeout ? { ...base.timeout, ...(overrides.timeout as object) } : base.timeout
  };
  const projectFilePath = path.join(mctHome, "projects", base.projectId, "project.json");
  await mkdir(path.dirname(projectFilePath), { recursive: true });
  await writeFile(projectFilePath, JSON.stringify(projectFile, null, 2), "utf8");
  return { projectId: base.projectId, projectFilePath };
}

async function getFreePort() {
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

test("CLI parses chat command and sends request to default client", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-"));
  const mctHome = path.join(tempDir, "mct-home");
  const globalStateDir = path.join(mctHome, "state");
  const projectDir = path.join(tempDir, "project");

  const server = new WebSocketServer({ port: 25594 });

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
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
    });
  });

  try {
    await mkdir(globalStateDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    await writeFile(
      path.join(globalStateDir, "clients.json"),
      JSON.stringify(
        {
          defaultClient: "bot",
          clients: {
            bot: {
              name: "bot",
              wsPort: 25594,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              logPath: path.join(globalStateDir, "bot.log"),
              instanceDir: path.join(mctHome, "clients", "bot")
            }
          }
        },
        null,
        2
      )
    );

    await writeProjectConfig(mctHome, projectDir, { project: "test", profiles: {} });

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "chat",
      "send",
      "hello"
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        MCT_HOME: mctHome
      }
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.success, true);
    assert.equal(parsed.data.data.echoedAction, "chat.send");
    assert.deepEqual(parsed.data.data.params, { message: "hello" });
  } finally {
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
});

test("CLI request commands prefer the active profile client over the global default client", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-profile-client-"));
  const mctHome = path.join(tempDir, "mct-home");
  const globalStateDir = path.join(mctHome, "state");
  const projectDir = path.join(tempDir, "project");
  const defaultPort = await getFreePort();
  const profilePort = await getFreePort();

  const defaultServer = new WebSocketServer({ port: defaultPort });
  const profileServer = new WebSocketServer({ port: profilePort });
  await Promise.all([
    new Promise<void>((resolve) => defaultServer.once("listening", () => resolve())),
    new Promise<void>((resolve) => profileServer.once("listening", () => resolve()))
  ]);

  defaultServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ id: request.id, success: true, data: { source: "global", echoedAction: request.action } }));
    });
  });

  profileServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ id: request.id, success: true, data: { source: "profile", echoedAction: request.action } }));
    });
  });

  try {
    await mkdir(globalStateDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    await writeFile(
      path.join(globalStateDir, "clients.json"),
      JSON.stringify(
        {
          defaultClient: "global-bot",
          clients: {
            "global-bot": {
              name: "global-bot",
              wsPort: defaultPort,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              logPath: path.join(globalStateDir, "global-bot.log"),
              instanceDir: path.join(mctHome, "clients", "global-bot")
            },
            "profile-bot": {
              name: "profile-bot",
              wsPort: profilePort,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              logPath: path.join(globalStateDir, "profile-bot.log"),
              instanceDir: path.join(mctHome, "clients", "profile-bot")
            }
          }
        },
        null,
        2
      )
    );

    await writeProjectConfig(mctHome, projectDir, {
      project: "test",
      defaultProfile: "dev",
      profiles: {
        dev: {
          server: "paper",
          clients: ["profile-bot"]
        }
      }
    });

    const info = JSON.parse((await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "info"
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        MCT_HOME: mctHome
      }
    })).stdout);
    assert.equal(info.success, true);
    assert.equal(info.data.activeProfile.clients[0], "profile-bot");

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "chat",
      "send",
      "hello"
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        MCT_HOME: mctHome
      }
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.data.source, "profile");
    assert.equal(parsed.data.data.echoedAction, "chat.send");
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => defaultServer.close((error) => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => profileServer.close((error) => error ? reject(error) : resolve()))
    ]);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI routes slash-prefixed chat send and default chat command through the client command packet", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-chat-route-"));
  const mctHome = path.join(tempDir, "mct-home");
  const globalStateDir = path.join(mctHome, "state");
  const projectDir = path.join(tempDir, "project");
  const wsPort = await getFreePort();

  const server = new WebSocketServer({ port: wsPort });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
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
    });
  });

  try {
    await mkdir(globalStateDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    await writeFile(
      path.join(globalStateDir, "clients.json"),
      JSON.stringify(
        {
          defaultClient: "bot",
          clients: {
            bot: {
              name: "bot",
              wsPort,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              logPath: path.join(globalStateDir, "bot.log"),
              instanceDir: path.join(mctHome, "clients", "bot")
            }
          }
        },
        null,
        2
      )
    );

    await writeProjectConfig(mctHome, projectDir, {
      project: "test",
      defaultProfile: "dev",
      profiles: {
        dev: {
          server: "paper",
          clients: ["bot"]
        }
      }
    });

    const slashSend = JSON.parse((await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "chat",
      "send",
      "/baoshi add"
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        MCT_HOME: mctHome
      }
    })).stdout);

    assert.equal(slashSend.success, true);
    assert.equal(slashSend.data.data.echoedAction, "chat.command");
    assert.deepEqual(slashSend.data.data.params, { command: "/baoshi add" });

    const autoCommand = JSON.parse((await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "chat",
      "command",
      "/spawn"
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        MCT_HOME: mctHome
      }
    })).stdout);

    assert.equal(autoCommand.success, true);
    assert.equal(autoCommand.data.data.echoedAction, "chat.command");
    assert.deepEqual(autoCommand.data.data.params, { command: "/spawn" });
  } finally {
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
});

test("CLI schema command outputs machine-readable command and protocol metadata without project context", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-schema-"));

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "schema"
    ], {
      cwd: tempDir,
      env: process.env
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.schemaVersion, 1);
    assert.equal(parsed.data.cli.name, "mct");
    assert.match(parsed.data.cli.description, /mct init --name my-plugin/);
    assert.ok(Array.isArray(parsed.data.cli.globalOptions));
    assert.ok(parsed.data.cli.globalOptions.some((option: { flags: string }) => option.flags === "--client <name>"));
    assert.ok(parsed.data.cli.leafCommands.includes("schema"));
    assert.ok(parsed.data.cli.leafCommands.includes("server create"));
    assert.ok(parsed.data.cli.leafCommands.includes("chat send"));
    assert.ok(Array.isArray(parsed.data.protocol.actions));
    assert.ok(Array.isArray(parsed.data.protocol.queries));
    assert.ok(Array.isArray(parsed.data.protocol.errors));
    assert.ok(parsed.data.protocol.actions.some((entry: { name?: string }) => entry.name === "chat.send"));
    assert.ok(parsed.data.protocol.queries.some((entry: { name?: string }) => entry.name === "status.all"));
    assert.ok(parsed.data.protocol.errors.some((entry: { code?: string }) => entry.code === "TIMEOUT"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI events wait returns the first matching event from the log file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-events-wait-"));
  const eventsFile = path.join(tempDir, "events.jsonl");

  try {
    setTimeout(() => {
      void appendFile(
        eventsFile,
        `${JSON.stringify({
          t: Date.now(),
          iso: new Date().toISOString(),
          type: "chat.received",
          payload: { content: "purchase ok" }
        })}\n`,
        "utf8"
      );
    }, 150);

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "events",
      "wait",
      "--file",
      eventsFile,
      "--type",
      "chat.received",
      "--match",
      "purchase",
      "--since",
      "5s",
      "--timeout",
      "2"
    ], {
      cwd: tempDir,
      env: process.env
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.matched, true);
    assert.equal(parsed.data.event.type, "chat.received");
    assert.equal(parsed.data.event.payload.content, "purchase ok");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI events wait exits with TIMEOUT when no matching event arrives", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-events-timeout-"));
  const eventsFile = path.join(tempDir, "events.jsonl");

  try {
    await writeFile(eventsFile, "", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(process.cwd(), "dist/index.js"),
        "events",
        "wait",
        "--file",
        eventsFile,
        "--type",
        "player.died",
        "--timeout",
        "1"
      ], {
        cwd: tempDir,
        env: process.env
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        const parsed = JSON.parse(String(error.stderr ?? "{}"));
        assert.equal(parsed.success, false);
        assert.equal(parsed.error.code, "TIMEOUT");
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI server status without project context shows all running servers", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-server-status-"));
  const mctHome = path.join(tempDir, "mct-home");
  const globalStateDir = path.join(mctHome, "state");

  try {
    await mkdir(globalStateDir, { recursive: true });
    await writeFile(
      path.join(globalStateDir, "servers.json"),
      JSON.stringify(
        {
          servers: {
            "demo/paper": {
              pid: process.pid,
              project: "demo",
              name: "paper",
              port: 25569,
              startedAt: new Date().toISOString(),
              logPath: path.join(mctHome, "logs", "server-demo-paper.log"),
              instanceDir: path.join(mctHome, "projects", "demo", "paper")
            }
          }
        },
        null,
        2
      )
    );

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "server",
      "status"
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        MCT_HOME: mctHome
      }
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.success, true);
    assert.equal(Array.isArray(parsed.data), true);
    assert.equal(parsed.data.length, 1);
    assert.equal(parsed.data[0].project, "demo");
    assert.equal(parsed.data[0].running, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
