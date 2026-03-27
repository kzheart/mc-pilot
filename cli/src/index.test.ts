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

    await writeFile(
      path.join(projectDir, "mct.project.json"),
      JSON.stringify({ project: "test", profiles: {} }, null, 2)
    );

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
