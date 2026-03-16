import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { WebSocketServer } from "ws";

const execFileAsync = promisify(execFile);

test("CLI parses chat command and sends request to default client", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-cli-"));
  const stateDir = path.join(tempDir, "state");
  const configPath = path.join(tempDir, "mct.config.json");

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
    await mkdir(stateDir, { recursive: true });

    await writeFile(
      configPath,
      JSON.stringify(
        {
          clients: {
            bot: {
              wsPort: 25594,
              launchCommand: ["node", "--eval", "setInterval(() => {}, 1000)"]
            }
          }
        },
        null,
        2
      )
    );

    await writeFile(
      path.join(stateDir, "clients.json"),
      JSON.stringify(
        {
          defaultClient: "bot",
          clients: {
            bot: {
              name: "bot",
              wsPort: 25594,
              headless: false,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              logPath: path.join(stateDir, "bot.log")
            }
          }
        },
        null,
        2
      )
    );

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "dist/index.js"),
      "--config",
      configPath,
      "--state-dir",
      stateDir,
      "chat",
      "send",
      "hello"
    ]);

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
