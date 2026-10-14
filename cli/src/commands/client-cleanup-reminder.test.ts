import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { buildProgram } from "../index.js";
import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { ServerManager } from "../instance/ServerManager.js";
import { MctError } from "../util/errors.js";
import { createDefaultProjectFile } from "../util/project.js";

async function fixture(t: TestContext) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "mct-cleanup-reminder-")),
  );
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(root, "home");
  t.after(async () => {
    if (previousHome === undefined) delete process.env.MCT_HOME;
    else process.env.MCT_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "run", "paper"), { recursive: true });
  await writeFile(
    path.join(root, "mct.json"),
    JSON.stringify({
      ...createDefaultProjectFile("reminder-test"),
      defaultProfile: "dev",
      profiles: {
        dev: { servers: ["paper"], clients: ["bot"] },
        compat: { servers: ["paper"], clients: ["bot", "observer"] },
        empty: { servers: ["paper"], clients: [] },
      },
    }),
  );

  // Exercise real command parsing/output without starting any game processes.
  t.mock.method(ServerManager.prototype, "start", async () => ({
    started: true,
  }));
  t.mock.method(ServerManager.prototype, "waitReady", async () => ({
    ready: true,
  }));
  t.mock.method(ServerManager.prototype, "readOnlineMode", async () => false);
  t.mock.method(ServerManager.prototype, "readPort", async () => 25565);
  t.mock.method(
    ClientInstanceManager.prototype,
    "isAlreadyRunning",
    async () => false,
  );
  t.mock.method(
    ClientInstanceManager.prototype,
    "launch",
    async (name: string) => ({ name, pid: 12345 }),
  );
  t.mock.method(ClientInstanceManager.prototype, "waitReady", async () => ({
    ready: true,
  }));
  const stop = t.mock.method(
    ClientInstanceManager.prototype,
    "stop",
    async () => ({ stopped: true }),
  );

  return {
    root,
    stop,
    async run(args: string[]) {
      let stdout = "";
      let stderr = "";
      const previousExitCode = process.exitCode;
      const out = t.mock.method(process.stdout, "write", (data: string) => {
        stdout += data;
        return true;
      });
      const err = t.mock.method(process.stderr, "write", (data: string) => {
        stderr += data;
        return true;
      });
      try {
        process.exitCode = undefined;
        await buildProgram().parseAsync(["--project", root, ...args], {
          from: "user",
        });
        return { stdout, stderr, exitCode: process.exitCode ?? 0 };
      } finally {
        out.mock.restore();
        err.mock.restore();
        process.exitCode = previousExitCode;
      }
    },
  };
}

test("client launch emits a cleanup reminder in JSON and human output without stopping the client", async (t) => {
  const f = await fixture(t);
  const json = await f.run(["client", "launch", "bot", "--no-server"]);
  const result = JSON.parse(json.stdout);
  assert.equal(result.success, true);
  assert.equal(result.data.pid, 12345);
  assert.deepEqual(result.data.cleanupReminder.stopCommands, [
    "mct client stop bot",
  ]);
  assert.match(result.data.cleanupReminder.message, /测试结束或失败后/);
  const human = await f.run([
    "--human",
    "client",
    "launch",
    "bot",
    "--no-server",
  ]);
  assert.match(human.stdout, /及时关闭/);
  assert.match(human.stdout, /mct client stop bot/);
  assert.equal(f.stop.mock.callCount(), 0);
});

test("up reminds for reused clients and pins shutdown to the requested project and profile", async (t) => {
  const f = await fixture(t);
  t.mock.method(
    ClientInstanceManager.prototype,
    "isAlreadyRunning",
    async () => true,
  );
  t.mock.method(ClientInstanceManager.prototype, "reconnect", async () => ({
    reconnected: true,
  }));
  const result = JSON.parse(
    (await f.run(["--profile", "compat", "up", "--skip-client-ready"])).stdout,
  );
  assert.equal(result.data.profile, "compat");
  assert.equal(result.data.ready, true);
  assert.deepEqual(result.data.cleanupReminder.stopCommands, [
    "mct client stop bot",
    "mct client stop observer",
  ]);
  const shutdown = result.data.cleanupReminder.profileStopCommand;
  assert.ok(shutdown.startsWith("mct --project "));
  assert.ok(shutdown.includes(f.root));
  assert.ok(shutdown.endsWith(" --profile compat down"));
  assert.equal(f.stop.mock.callCount(), 0);
});

test("up readiness failures retain their error details and add cleanup commands", async (t) => {
  const f = await fixture(t);
  t.mock.method(ClientInstanceManager.prototype, "waitReady", async () => {
    throw new MctError(
      {
        code: "TEST_TIMEOUT",
        message: "Not ready",
        details: { disconnectReason: "fixture" },
      },
      3,
    );
  });
  const response = await f.run(["up"]);
  const result = JSON.parse(response.stderr);
  assert.equal(response.stdout, "");
  assert.equal(response.exitCode, 3);
  assert.equal(result.error.code, "TEST_TIMEOUT");
  assert.equal(result.error.details.disconnectReason, "fixture");
  assert.deepEqual(result.error.details.cleanupReminder.stopCommands, [
    "mct client stop bot",
  ]);
  assert.equal(f.stop.mock.callCount(), 0);
});

test("up partial launch failures remind for clients already used", async (t) => {
  const f = await fixture(t);
  t.mock.method(
    ClientInstanceManager.prototype,
    "launch",
    async (name: string) => {
      if (name === "observer") throw new Error("fixture launch failed");
      return { name, pid: 12345 };
    },
  );
  const response = await f.run(["--profile", "compat", "up"]);
  const result = JSON.parse(response.stderr);
  assert.match(result.error.message, /fixture launch failed/);
  assert.ok(
    result.error.details.cleanupReminder.stopCommands.includes(
      "mct client stop bot",
    ),
  );
});

test("up has no client reminder when clients are skipped or the profile has none", async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["up", "--server-only-ok"],
    ["--profile", "empty", "up"],
  ]) {
    const result = JSON.parse((await f.run(args)).stdout);
    assert.equal(result.success, true);
    assert.equal(result.data.cleanupReminder, undefined);
  }
});

test("client list reminds only for running clients and disappears when none remain", async (t) => {
  const f = await fixture(t);
  const clients = [
    { name: "bot", running: true },
    { name: "idle", running: false },
  ];
  t.mock.method(ClientInstanceManager.prototype, "list", async () => ({
    clients,
  }));
  const result = JSON.parse((await f.run(["client", "list"])).stdout);
  assert.deepEqual(result.data.cleanupReminder.stopCommands, [
    "mct client stop bot",
  ]);
  clients[0].running = false;
  const stopped = JSON.parse((await f.run(["client", "list"])).stdout);
  assert.equal(stopped.data.cleanupReminder, undefined);
});
