import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("./index.js", import.meta.url));

test("record CLI works without a project/world, reports old mods and never retries an ambiguous mutation", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "mct-record-cli-")),
  );
  const home = path.join(root, "home");
  const instanceDir = path.join(home, "clients", "bot");
  const recordingsDir = path.join(instanceDir, "minecraft", "recordings");
  await mkdir(path.join(home, "state"), { recursive: true });
  await mkdir(recordingsDir, { recursive: true });
  const outputPath = path.join(recordingsDir, "demo.mp4");
  await writeFile(outputPath, "fake video");
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await writeFile(
    path.join(home, "state", "clients.json"),
    JSON.stringify({
      defaultClient: "bot",
      clients: {
        bot: {
          name: "bot",
          wsPort: address.port,
          pid: process.pid,
          instanceDir,
          logPath: path.join(root, "bot.log"),
          startedAt: new Date().toISOString(),
        },
      },
    }),
  );
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  let behavior = "success";
  const requests: Array<{
    action: string;
    params: Record<string, unknown>;
    timeoutMs: number;
  }> = [];
  server.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      requests.push(request);
      if (behavior === "disconnect") {
        socket.close();
        return;
      }
      if (behavior === "old") {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: false,
            error: "INVALID_ACTION",
          }),
        );
        return;
      }
      if (behavior === "mismatch") {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: false,
            error: "RECORDING_FRAMEBUFFER_MISMATCH",
            details: {
              phase: "execution",
              resultUnknown: false,
              message:
                "Requested 1920x1080 but native framebuffer is 1280x720; resize the game",
            },
          }),
        );
        return;
      }
      if (behavior === "failed") {
        socket.send(
          JSON.stringify({
            id: request.id,
            success: true,
            data: {
              state: "failed",
              finalized: false,
              error: "Encoder exited",
              outputPath,
            },
          }),
        );
        return;
      }
      const data =
        request.action === "recording.list"
          ? {
              recordings: [
                { name: "demo", outputPath, finalized: true, sizeBytes: 10 },
              ],
            }
          : { state: "recording", echoed: request.params, supported: true };
      socket.send(JSON.stringify({ id: request.id, success: true, data }));
    }),
  );
  const run = (args: string[]) =>
    execute(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, MCT_HOME: home },
    });
  const start = JSON.parse((await run(["record", "start"])).stdout);
  assert.equal(start.success, true);
  assert.deepEqual(start.data.data.echoed, {
    width: 1920,
    height: 1080,
    fps: 30,
    maxDurationSeconds: 1800,
  });
  assert.ok(requests.at(-1)!.timeoutMs >= 30_000);
  await run([
    "record",
    "start",
    "demo2",
    "--width",
    "1280",
    "--height",
    "720",
    "--fps",
    "60",
    "--max-duration",
    "10",
  ]);
  assert.deepEqual(requests.at(-1)!.params, {
    name: "demo2",
    width: 1280,
    height: 720,
    fps: 60,
    maxDurationSeconds: 10,
  });
  await run(["record", "stop"]);
  assert.ok(requests.at(-1)!.timeoutMs >= 60_000);
  const view = JSON.parse((await run(["record", "view", "demo"])).stdout);
  assert.equal(view.data.local, true);
  assert.equal(view.data.outputPath, outputPath);
  assert.match(view.data.url, /^file:/);
  behavior = "mismatch";
  await assert.rejects(
    run(["record", "start", "wrong-size"]),
    (error: unknown) => {
      const result = JSON.parse((error as { stderr: string }).stderr);
      assert.equal(result.error.code, "RECORDING_FRAMEBUFFER_MISMATCH");
      assert.match(result.error.message, /1920x1080.*1280x720/);
      assert.match(result.error.message, /resize/);
      return true;
    },
  );
  behavior = "failed";
  await assert.rejects(run(["record", "stop"]), (error: unknown) => {
    const result = JSON.parse((error as { stderr: string }).stderr);
    assert.equal(result.error.code, "RECORDING_FAILED");
    assert.equal(result.error.details.finalized, false);
    return true;
  });
  const failedStatus = JSON.parse((await run(["record", "status"])).stdout);
  assert.equal(failedStatus.data.data.state, "failed");
  const beforeDoctor = requests.length;
  const doctor = JSON.parse(
    (
      await run([
        "record",
        "doctor",
        "--ffmpeg",
        path.join(root, "missing-encoder"),
      ])
    ).stdout,
  );
  assert.equal(doctor.data.ready, false);
  assert.equal(doctor.data.downloaded, false);
  assert.equal(requests.length, beforeDoctor);
  behavior = "old";
  await assert.rejects(run(["record", "status"]), (error: unknown) => {
    const result = JSON.parse((error as { stderr: string }).stderr);
    assert.equal(result.error.code, "RECORDING_UNSUPPORTED");
    return true;
  });
  const before = requests.length;
  await assert.rejects(run(["record", "start", "../unsafe"]));
  assert.equal(requests.length, before, "validate before reaching the mod");
  behavior = "disconnect";
  await assert.rejects(
    run(["record", "start", "ambiguous"]),
    (error: unknown) => {
      const result = JSON.parse((error as { stderr: string }).stderr);
      assert.equal(result.error.code, "CONNECTION_FAILED");
      assert.equal(result.error.details.resultUnknown, true);
      return true;
    },
  );
  assert.equal(requests.length, before + 1, "never automatically retry start");
});
