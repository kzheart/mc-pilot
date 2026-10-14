#!/usr/bin/env node
// Observable input-effects checks for the test-owned resource-pack fixture only.
// Requires the flat safe platform, default key bindings and a given diamond.
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
  const probe = await connect();
  const data = async (peer, action, params = {}) => {
    const response = await peer.request(action, params);
    assert.equal(response.success, true, JSON.stringify(response));
    return response.data;
  };
  await check("fixture has settled in-world with no GUI", async () => {
    const deadline = performance.now() + 75000;
    let lastStatus, lastScreen;
    do {
      lastStatus = await probe.request("status.all", {}, 5000);
      lastScreen = await probe.request("gui.info", {}, 5000);
      if (lastStatus.success && lastStatus.data.inWorld && lastScreen.success && lastScreen.data.open === false) {
        report.initialReady = { status: lastStatus.data, screen: lastScreen.data };
        return;
      }
      await sleep(250);
    } while (performance.now() < deadline);
    assert.fail(`Fixture did not settle without forcing a GUI close: ${JSON.stringify({ lastStatus, lastScreen })}`);
  });
  const position = () => data(probe, "position.get");
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  report.movements = [];
  for (const [mode, key] of [["graceful", "w"], ["abrupt", "s"]]) {
    await check(`${mode} cancellation stops observable player movement`, async () => {
      assert.deepEqual((await data(probe, "input.keys-down")).keys, []);
      assert.equal((await data(probe, "gui.info")).open, false);
      const start = await position();
      const holder = await connect();
      holder.request("input.key-hold", { key, duration: 5000 }, 7000);
      let moved = start;
      try {
        const until = performance.now() + 700;
        while (distance(start, moved) <= 0.1 && performance.now() < until) {
          await sleep(50);
          moved = await position();
        }
        assert.ok(distance(start, moved) > 0.1, "Hold never caused observable movement");
      } finally { await holder.close(mode === "abrupt", mode === "graceful"); }
      // No key-up/reset is sent. The production cancellation path must stop it.
      await sleep(750);
      const settled = await position();
      await sleep(500);
      const later = await position();
      const observation = { mode, key, start, moved, settled, later, drift: distance(settled, later) };
      report.movements.push(observation);
      assert.ok(distance(start, moved) < 2, "Movement exceeded the safe fixture window");
      assert.ok(observation.drift < 0.06, JSON.stringify(observation));
      assert.ok(Math.abs(later.y - start.y) < 0.05, "Fixture player left the safe platform");
      assert.deepEqual((await data(probe, "input.keys-down")).keys, []);
    });
  }
  await check("four separate key presses toggle the actual inventory screen", async () => {
    report.screenToggles = [];
    assert.equal((await data(probe, "gui.info")).open, false);
    for (const expected of [true, false, true, false]) {
      await data(probe, "input.key-press", { key: "e" });
      const until = performance.now() + 1000;
      let screen = await data(probe, "gui.info");
      while (screen.open !== expected && performance.now() < until) {
        await sleep(30); screen = await data(probe, "gui.info");
      }
      assert.equal(screen.open, expected, JSON.stringify(screen));
      report.screenToggles.push(screen);
    }
  });
  await check("two separate clicks pick up and restore the actual cursor stack", async () => {
    try {
      await data(probe, "input.key-press", { key: "e" });
      await data(probe, "gui.wait-open", { timeout: 2 });
      const before = await data(probe, "gui.snapshot");
      assert.equal(before.cursorItem.empty, true);
      const slot = before.slots.filter((entry) => entry.item?.type === "minecraft:diamond" && entry.hasStack && Number.isFinite(entry.centerX))
        .sort((a, b) => b.centerY - a.centerY)[0];
      assert.ok(slot, "Fixture diamond must be visible in a player hotbar slot");
      const click = { x: slot.centerX, y: slot.centerY, button: "left" };
      report.clickEffects = { slot, before: before.cursorItem, separateClickDelayMs: 350 };
      await data(probe, "input.click", click);
      const pickedUp = await data(probe, "gui.snapshot");
      report.clickEffects.pickedUp = pickedUp.cursorItem;
      report.clickEffects.pickedUpSlot = pickedUp.slots.find((entry) => entry.slot === slot.slot);
      assert.equal(pickedUp.cursorItem.type, "minecraft:diamond", JSON.stringify(pickedUp.cursorItem));
      assert.ok(pickedUp.cursorItem.count > 0);
      // GuiContainer 1.12 treats same-slot/button clicks within 250 ms as
      // PICKUP_ALL. Exercise two independent clicks, not native double-click.
      await sleep(350);
      await data(probe, "input.click", click);
      const restored = await data(probe, "gui.snapshot");
      report.clickEffects.restored = restored.cursorItem;
      report.clickEffects.restoredSlot = restored.slots.find((entry) => entry.slot === slot.slot);
      assert.equal(restored.cursorItem.empty, true, JSON.stringify(restored.cursorItem));
      assert.equal(restored.slots.find((entry) => entry.slot === slot.slot).item.type, "minecraft:diamond");
    } catch (error) {
      await mkdir(values["output-dir"], { recursive: true });
      report.clickFailureScreenshot = await probe.request("capture.screenshot", {
        output: path.resolve(values["output-dir"], "input-click-failure.png"),
      }, 5000).catch((captureError) => ({ error: String(captureError) }));
      throw error;
    } finally { await probe.request("gui.close").catch(() => null); }
  });
  await probe.close();
  assert.equal(report.protocolError, undefined);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await Promise.all(peers.map((peer) => peer.close(true)));
  report.finishedAt = new Date().toISOString();
  const output = path.resolve(values["output-dir"], "websocket-input-effects-diagnostic.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, output }));
}
