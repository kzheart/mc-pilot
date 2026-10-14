#!/usr/bin/env node
// Bounded checks for a test-owned, in-world, ticking client. Input cases briefly
// hold sneak/modifiers and open an empty inventory drag; never use on production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values } = parseArgs({ options: Object.fromEntries([
  "ws-url", "output-dir", "cli-path", "client", "server-address", "game-dir", "java-command", "thread-dump-pid",
].map((name) => [name, { type: "string" }])) });
assert.ok(values["ws-url"] && values["output-dir"], "--ws-url and --output-dir required");
const report = { startedAt: new Date().toISOString(), url: values["ws-url"], cases: [], events: [] };
const peers = [];
let persistentSneak = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const event = (type, details = {}) => report.events.push({ at: new Date().toISOString(), type, ...details });
// Observe immediately even when another assertion fails before the eventual
// await. Preserve rejection on the original promise for normal test reporting.
const observed = (promise) => { promise.catch(() => {}); return promise; };

async function connect() {
  const socket = new WebSocket(values["ws-url"], { handshakeTimeout: 2_000 });
  const pending = new Map();
  const responses = [];
  socket.on("error", (error) => event("error", { message: error.message }));
  socket.on("message", (raw) => {
    let response;
    try { response = JSON.parse(raw.toString()); }
    catch {
      report.protocolError = "Malformed JSON response";
      event("invalid-response");
      socket.terminate();
      return;
    }
    event("response", { response });
    responses.push(response);
    const waiter = pending.get(response.id);
    if (waiter) { pending.delete(response.id); clearTimeout(waiter.timer); waiter.resolve(response); }
  });
  socket.on("close", (code, reason) => {
    event("close", { code, reason: reason.toString() });
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`Connection closed ${code}`)); }
    pending.clear();
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const peer = {
    socket, responses,
    request(action, params = {}, timeoutMs = 3000) {
      const request = { id: randomUUID(), action, params };
      if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(request.id); reject(new Error(`No response for ${request.id}`)); }, (timeoutMs ?? 3000) + 2000);
        pending.set(request.id, { resolve, reject, timer });
      });
      event("request", { request });
      socket.send(JSON.stringify(request));
      return observed(promise);
    },
    async close(abrupt = false, requireHandshake = false) {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.terminate();
          if (requireHandshake) reject(new Error("Graceful close handshake timed out")); else resolve();
        }, 1000);
        socket.once("close", () => { clearTimeout(timer); resolve(); });
        if (abrupt) socket.terminate(); else socket.close();
      });
    },
  };
  peers.push(peer);
  return peer;
}

async function check(name, run) {
  const started = performance.now();
  await run();
  report.cases.push({ name, passed: true, elapsedMs: performance.now() - started });
}

try {
  await check("other connection remains responsive during long commands", async () => {
    const a = await connect();
    let completed = 0;
    const wait = (peer) => observed(peer.request("wait.perform", { seconds: 2 }, 5000).then((response) => { completed++; assert.equal(response.success, true); }));
    const waits = [wait(a)];
    // Do not warm another socket/read buffer before the first callback runs.
    await sleep(100);
    const b = await connect();
    waits.push(wait(b));
    await sleep(100);
    const probe = await connect();
    const response = await probe.request("status.all");
    assert.equal(response.success, true);
    assert.equal(response.data.inWorld, true, "Dispatch diagnostic requires an in-world, ticking test client");
    assert.equal(completed, 0, "status waited for unrelated long commands");
    await Promise.all(waits);
    await Promise.all([a.close(), b.close(), probe.close()]);
  });

  await check("admission saturation rejects only unaccepted requests", async () => {
    const peer = await connect();
    const hold = peer.request("wait.perform", { seconds: 1 }, 5000);
    await sleep(50);
    const replies = await Promise.all(Array.from({ length: 32 }, () => peer.request("status.all", {}, 5000)));
    const busy = replies.filter((reply) => reply.error === "CLIENT_BUSY");
    assert.ok(busy.length > 0);
    for (const reply of busy) { assert.equal(reply.details.phase, "admission"); assert.equal(reply.details.resultUnknown, false); }
    for (const reply of replies.filter((reply) => reply.error !== "CLIENT_BUSY")) assert.equal(reply.success, true, JSON.stringify(reply));
    assert.equal((await hold).success, true);
    assert.equal((await peer.request("status.all")).success, true);
    report.busyRejections = busy.length;
    await peer.close();
  });

  await check("queue and active deadlines return one correlated terminal response", async () => {
    const peer = await connect();
    const active = peer.request("wait.perform", { seconds: 2 }, 500);
    await sleep(25);
    const queued = await peer.request("status.all", {}, 100);
    assert.equal(queued.error, "TIMEOUT");
    assert.equal(queued.details.phase, "queue");
    assert.equal(queued.details.resultUnknown, false);
    const running = await active;
    assert.equal(running.error, "TIMEOUT");
    assert.equal(running.details.phase, "execution");
    assert.equal(running.details.resultUnknown, true);
    assert.equal((await peer.request("status.all")).success, true);
    // Keep the socket open beyond the original two-second action duration so a
    // buggy late success cannot hide behind our own connection cleanup.
    await sleep(1700);
    assert.equal(peer.responses.filter((entry) => entry.id === queued.id).length, 1);
    assert.equal(peer.responses.filter((entry) => entry.id === running.id).length, 1);
    await peer.close();
  });

  for (const mode of ["graceful", "abrupt"]) await check(`${mode} close releases occupied command workers`, async () => {
    const blockers = await Promise.all(Array.from({ length: 4 }, () => connect()));
    const ignored = blockers.map((peer) => peer.request("wait.perform", { seconds: 5 }, 8000).catch(() => null));
    await sleep(100);
    const probe = await connect();
    const response = probe.request("status.all", {}, 2500);
    await sleep(50);
    await Promise.all(blockers.map((peer) => peer.close(mode === "abrupt", mode === "graceful")));
    assert.equal((await response).success, true);
    await Promise.all(ignored);
    await probe.close();
  });

  const keys = async (peer) => {
    const reply = await peer.request("input.keys-down");
    assert.equal(reply.success, true, JSON.stringify(reply));
    return reply.data.keys;
  };
  const waitKeys = async (peer, expected) => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const current = await keys(peer);
      if (expected(current)) return current;
      await sleep(25);
    }
    assert.fail(`Held-key state did not converge: ${JSON.stringify(await keys(peer))}`);
  };
  for (const mode of ["graceful", "abrupt", "deadline"]) await check(`${mode} cancellation releases temporary input`, async () => {
    const probe = await connect(), holder = await connect();
    assert.deepEqual(await keys(probe), [], "Input test requires no pre-existing synthetic holds");
    const hold = holder.request("input.key-hold", { key: "sneak", duration: 5000 }, mode === "deadline" ? 300 : 8000);
    await waitKeys(probe, (current) => current.includes("sneak"));
    if (mode === "deadline") {
      const reply = await hold;
      assert.equal(reply.error, "TIMEOUT");
      assert.equal(reply.details.resultUnknown, true);
    } else await holder.close(mode === "abrupt", mode === "graceful");
    await waitKeys(probe, (current) => current.length === 0);
    await Promise.all([probe.close(), holder.close()]);
  });
  await check("overlapping aliases and persistent input preserve ownership", async () => {
    const probe = await connect(), first = await connect(), second = await connect();
    assert.deepEqual(await keys(probe), []);
    first.request("input.key-hold", { key: "sneak", duration: 5000 }, 8000);
    await waitKeys(probe, (current) => current.length > 0);
    second.request("input.key-hold", { key: "shift", duration: 5000 }, 8000);
    await waitKeys(probe, (current) => current.includes("shift"));
    await first.close(true);
    assert.ok((await keys(probe)).length > 0, "Other temporary owner was released");
    const down = await probe.request("input.key-down", { key: "sneak" });
    assert.equal(down.success, true);
    persistentSneak = true;
    await second.close(false, true);
    assert.ok((await keys(probe)).length > 0, "Persistent hold was released");
    assert.equal((await probe.request("move.sneak", { enabled: false })).success, true);
    persistentSneak = false;
    await waitKeys(probe, (current) => current.length === 0);
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.equal((await probe.request("input.key-press", { key: "shift" })).success, true);
      assert.deepEqual(await keys(probe), [], "Normal key-press must release before returning");
    }
    const combo = await probe.request("input.key-combo", { keys: ["sneak", "ctrl", "alt"] }, 60);
    assert.equal(combo.error, "TIMEOUT");
    await waitKeys(probe, (current) => current.length === 0);
    await Promise.all([probe.close(), first.close(), second.close()]);
  });
  await check("cancelled GUI drag leaves input and GUI responsive", async () => {
    const peer = await connect();
    try {
      assert.equal((await peer.request("input.key-press", { key: "inventory" })).success, true);
      assert.equal((await peer.request("gui.wait-open", { timeout: 2 })).success, true);
      const drag = await peer.request("input.drag", { fromX: 4, fromY: 4, toX: 20, toY: 20, button: "left" }, 100);
      assert.equal(drag.error, "TIMEOUT");
      await waitKeys(peer, (current) => current.length === 0);
      assert.equal((await peer.request("gui.snapshot")).success, true);
      for (let repeat = 0; repeat < 2; repeat++) {
        assert.equal((await peer.request("input.click", { x: 4, y: 4, button: "left" })).success, true);
        assert.deepEqual(await keys(peer), [], "Normal click must release before returning");
      }
    } finally {
      await peer.request("gui.close").catch(() => null);
      await peer.close();
    }
  });

  assert.equal(report.protocolError, undefined);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  if (persistentSneak) {
    try { const cleanup = await connect(); await cleanup.request("move.sneak", { enabled: false }); }
    catch (error) { report.cleanupError = String(error); }
  }
  await Promise.all(peers.map((peer) => peer.close(true)));
  report.finishedAt = new Date().toISOString();
  const output = path.resolve(values["output-dir"], "websocket-dispatch-diagnostic.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, output }));
}
