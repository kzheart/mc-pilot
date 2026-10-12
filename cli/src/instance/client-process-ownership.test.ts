import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test, { type TestContext } from "node:test";

import { ClientInstanceManager } from "./ClientInstanceManager.js";
import { platform } from "../platform/index.js";
import { MctError } from "../util/errors.js";
import { GlobalStateStore } from "../util/global-state.js";
import type { ClientRuntimeEntry } from "../util/instance-types.js";

const ROOT_PID = 91001;
const CHILD_PID = 91002;
const FOREIGN_PID = 92001;
const WS_PORT = 29991;

type KillCall = { pid: number; signal?: NodeJS.Signals };

async function fixture(t: TestContext) {
  const home = await mkdtemp(path.join(os.tmpdir(), "mct-process-owner-"));
  const previousHome = process.env.MCT_HOME;
  process.env.MCT_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.MCT_HOME;
    else process.env.MCT_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  const alive = new Set<number>();
  const listeners = new Set<number>();
  const children = new Set<number>([CHILD_PID]);
  const kills: KillCall[] = [];
  let afterKill: ((pid: number, signal?: NodeJS.Signals) => void) | undefined;
  t.mock.method(platform.processes, "getListeningPids", () => [...listeners]);
  t.mock.method(
    platform.processes,
    "isInProcessTree",
    (pid: number, rootPid: number) =>
      pid === rootPid ||
      (rootPid === ROOT_PID && alive.has(ROOT_PID) && children.has(pid)),
  );
  t.mock.method(
    platform.processes,
    "killProcessTree",
    (pid: number, signal?: NodeJS.Signals) => {
      kills.push({ pid, signal });
      // Even the red/characterization run cannot send a real process signal.
      if (pid === FOREIGN_PID)
        throw new Error("Attempted to kill unrelated fixture process");
      alive.delete(pid);
      listeners.delete(pid);
      afterKill?.(pid, signal);
    },
  );
  t.mock.method(
    process,
    "kill",
    (pid: number, signal?: number | NodeJS.Signals) => {
      assert.equal(
        signal,
        0,
        "Tests may probe synthetic PIDs but never signal real processes",
      );
      if (!alive.has(pid))
        throw Object.assign(new Error("No such fixture process"), {
          code: "ESRCH",
        });
      return true;
    },
  );

  const store = new GlobalStateStore();
  const manager = new ClientInstanceManager(store);
  await manager.create({
    name: "bot",
    version: "1.20.4",
    wsPort: WS_PORT,
    launchArgs: ["--fixture"],
  });
  const entry: ClientRuntimeEntry = {
    pid: ROOT_PID,
    name: "bot",
    wsPort: WS_PORT,
    startedAt: new Date().toISOString(),
    logPath: path.join(home, "bot.log"),
    instanceDir: path.join(home, "clients/bot"),
  };
  return {
    store,
    manager,
    entry,
    alive,
    listeners,
    kills,
    children,
    setAfterKill(callback: typeof afterKill) {
      afterKill = callback;
    },
    async track() {
      await store.writeClientState({
        defaultClient: "bot",
        clients: { bot: entry },
      });
    },
  };
}

function isPortConflict(error: unknown) {
  assert.ok(error instanceof MctError);
  assert.equal(error.code, "PORT_CONFLICT");
  const details = error.details as { wsPort: number; listeningPids: number[] };
  assert.equal(details.wsPort, WS_PORT);
  assert.ok(details.listeningPids.includes(FOREIGN_PID));
  return true;
}

test("launch refuses an unrelated listener without killing it, even with --force", async (t) => {
  const f = await fixture(t);
  f.alive.add(FOREIGN_PID);
  f.listeners.add(FOREIGN_PID);
  await assert.rejects(
    f.manager.launch("bot", { force: true }),
    isPortConflict,
  );
  assert.deepEqual(f.kills, []);
  assert.deepEqual((await f.store.readClientState()).clients, {});
});

test("stop rejects a foreign port owner before signalling the tracked client", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(ROOT_PID);
  f.alive.add(FOREIGN_PID);
  f.listeners.add(FOREIGN_PID);
  await assert.rejects(f.manager.stop("bot"), isPortConflict);
  assert.deepEqual(f.kills, []);
  assert.deepEqual((await f.store.readClientState()).clients.bot, f.entry);
});

test("stale tracked client does not authorize killing a replacement listener", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(FOREIGN_PID);
  f.listeners.add(FOREIGN_PID);
  await assert.rejects(f.manager.stop("bot"), isPortConflict);
  assert.deepEqual(f.kills, []);
  assert.deepEqual((await f.store.readClientState()).clients.bot, f.entry);
});

test("stop terminates an owned listener child and the tracked launcher", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(ROOT_PID);
  f.alive.add(CHILD_PID);
  f.listeners.add(CHILD_PID);
  const result = await f.manager.stop("bot");
  assert.equal(result.stopped, true);
  assert.deepEqual(f.kills.map(({ pid }) => pid).sort(), [ROOT_PID, CHILD_PID]);
  assert.equal(f.listeners.size, 0);
  assert.deepEqual((await f.store.readClientState()).clients, {});
});

test("a foreign listener appearing during shutdown is never terminated", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(ROOT_PID);
  f.listeners.add(ROOT_PID);
  f.setAfterKill(() => {
    f.alive.add(FOREIGN_PID);
    f.listeners.add(FOREIGN_PID);
  });
  await assert.rejects(f.manager.stop("bot"), isPortConflict);
  assert.deepEqual(
    f.kills.map(({ pid }) => pid),
    [ROOT_PID],
  );
  assert.ok(f.alive.has(FOREIGN_PID));
});

test("mixed owned and unrelated listeners prevent all stop signals", async (t) => {
  const f = await fixture(t);
  await f.track();
  for (const pid of [ROOT_PID, CHILD_PID, FOREIGN_PID]) f.alive.add(pid);
  f.listeners.add(CHILD_PID);
  f.listeners.add(FOREIGN_PID);
  await assert.rejects(f.manager.stop("bot"), isPortConflict);
  assert.deepEqual(f.kills, []);
});

test("--force refuses a foreign listener on the tracked client's port", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(ROOT_PID);
  f.alive.add(FOREIGN_PID);
  f.listeners.add(FOREIGN_PID);
  await assert.rejects(
    f.manager.launch("bot", { force: true }),
    isPortConflict,
  );
  assert.deepEqual(f.kills, []);
});

test("stop can escalate a previously owned child after its launcher exits", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(ROOT_PID);
  f.alive.add(CHILD_PID);
  f.listeners.add(CHILD_PID);
  let clockReads = 0;
  f.setAfterKill((pid, signal) => {
    if (pid === ROOT_PID) {
      // Jump directly past the graceful shutdown interval without real waits.
      t.mock.method(Date, "now", () => (clockReads++ === 0 ? 0 : 20_000));
    }
    if (pid === CHILD_PID && signal !== "SIGKILL") {
      f.alive.add(CHILD_PID);
      f.listeners.add(CHILD_PID);
      assert.equal(
        platform.processes.isInProcessTree(CHILD_PID, ROOT_PID),
        false,
      );
    }
  });
  const result = await f.manager.stop("bot");
  assert.equal(result.stopped, true);
  assert.deepEqual(f.kills, [
    { pid: ROOT_PID, signal: "SIGTERM" },
    { pid: CHILD_PID, signal: "SIGTERM" },
    { pid: CHILD_PID, signal: "SIGKILL" },
  ]);
  assert.deepEqual((await f.store.readClientState()).clients, {});
});

test("escalation rechecks ownership instead of killing a new port owner", async (t) => {
  const f = await fixture(t);
  await f.track();
  f.alive.add(ROOT_PID);
  f.alive.add(CHILD_PID);
  f.listeners.add(CHILD_PID);
  let clockReads = 0;
  f.setAfterKill((pid, signal) => {
    if (pid === ROOT_PID) {
      t.mock.method(Date, "now", () => {
        if (clockReads++ === 0) return 0;
        f.alive.add(FOREIGN_PID);
        f.listeners.add(FOREIGN_PID);
        return 20_000;
      });
    }
    if (pid === CHILD_PID && signal !== "SIGKILL") {
      f.alive.add(CHILD_PID);
      f.listeners.add(CHILD_PID);
    }
  });
  await assert.rejects(f.manager.stop("bot"), isPortConflict);
  assert.deepEqual(
    f.kills.map(({ pid }) => pid),
    [ROOT_PID, CHILD_PID],
  );
  assert.ok(f.kills.every(({ signal }) => signal !== "SIGKILL"));
  assert.ok(f.alive.has(FOREIGN_PID));
});

test("stale state with no live processes or listener can be removed safely", async (t) => {
  const f = await fixture(t);
  await f.track();
  const result = await f.manager.stop("bot");
  assert.equal(result.stopped, true);
  assert.deepEqual(f.kills, []);
  assert.deepEqual((await f.store.readClientState()).clients, {});
});
