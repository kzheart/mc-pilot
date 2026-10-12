#!/usr/bin/env node
// Run only against the test-owned real client in the resource-pack harness.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values } = parseArgs({ options: {
  "ws-url": { type: "string" }, "cli-path": { type: "string" },
  client: { type: "string" }, "server-address": { type: "string" },
  "output-dir": { type: "string" }, "game-dir": { type: "string" },
  "java-command": { type: "string" }, "thread-dump-pid": { type: "string" },
  rounds: { type: "string", default: "6" },
} });
for (const key of ["ws-url", "server-address", "output-dir"]) assert.ok(values[key], `--${key} required`);
if (values["thread-dump-pid"]) {
  const pid = Number(values["thread-dump-pid"]);
  assert.ok(Number.isSafeInteger(pid) && pid > 1, "thread-dump PID must be a verified positive JVM PID");
}
const report = { startedAt: new Date().toISOString(), url: values["ws-url"], events: [], rounds: [] };
const output = path.resolve(values["output-dir"], "websocket-diagnostic.json");
await mkdir(path.dirname(output), { recursive: true });
let dumpRequested = false;
function event(type, details = {}) {
  const entry = { at: new Date().toISOString(), type, ...details };
  report.events.push(entry);
  if (type.includes("timeout")) {
    console.error(JSON.stringify(entry));
    if (values["thread-dump-pid"] && !dumpRequested) {
      // The harness must supply its verified, still-running test JVM PID.
      dumpRequested = true;
      process.kill(Number(values["thread-dump-pid"]), "SIGQUIT");
    }
  }
}

async function batch(action, paramsList, sharedSocket = false) {
  const requests = paramsList.map((params) => ({ id: randomUUID(), action, params }));
  const sockets = Array.from({ length: sharedSocket ? 1 : requests.length }, () => new WebSocket(values["ws-url"]));
  const results = new Map();
  try {
    await Promise.all(sockets.map((socket, index) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { event("connect_timeout", { index }); reject(new Error("connect timeout")); }, 10000);
      socket.on("error", (error) => { event("socket_error", { index, message: error.message }); clearTimeout(timer); reject(error); });
      socket.on("close", (code, reason) => event("socket_close", { index, code, reason: reason.toString() }));
      socket.once("open", () => { clearTimeout(timer); event("socket_open", { index }); resolve(); });
    })));
    const pending = requests.map((request, index) => new Promise((resolve, reject) => {
      const socket = sockets[sharedSocket ? 0 : index];
      const started = performance.now();
      const timer = setTimeout(() => {
        event("response_timeout", { id: request.id, action, index, elapsedMs: performance.now() - started });
        reject(new Error(`response timeout ${request.id}`));
      }, 10000);
      const onMessage = (raw) => {
        const response = JSON.parse(raw.toString());
        event("response", { index, expectedId: request.id, response, elapsedMs: performance.now() - started });
        if (response.id !== request.id) return;
        clearTimeout(timer);
        socket.off("message", onMessage);
        results.set(request.id, response);
        resolve(response);
      };
      socket.on("message", onMessage);
      socket.once("close", (code) => { clearTimeout(timer); reject(new Error(`closed ${code} before response ${request.id}`)); });
    }));
    requests.forEach((request, index) => {
      event("request_sent", { index, request });
      sockets[sharedSocket ? 0 : index].send(JSON.stringify(request));
    });
    const settled = await Promise.allSettled(pending);
    for (const result of settled) if (result.status === "rejected") throw result.reason;
    return requests.map((request) => results.get(request.id));
  } finally {
    sockets.forEach((socket) => socket.terminate());
  }
}

async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const [response] = await batch("status.all", [{}]);
    if (response.success && response.data?.inWorld) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("client did not rejoin within 60 seconds");
}

async function cliReconnect() {
  const argv = [values["cli-path"], "--client", values.client, "client", "reconnect", "--address", values["server-address"], "--resource-pack", "accept"];
  event("cli_start", { argv });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    const timer = setTimeout(() => { event("cli_timeout", { pid: child.pid }); child.kill("SIGTERM"); }, 15000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const result = { code, signal, stdout, stderr };
      event("cli_exit", result);
      resolve(result);
    });
  });
}

try {
  const statuses = await batch("status.all", Array.from({ length: 16 }, () => ({})));
  statuses.forEach((response) => assert.equal(response.success, true));
  report.parallelStatuses = statuses.length;
  const params = { address: values["server-address"], resourcePackPolicy: "accept" };
  for (let round = 0; round < Number(values.rounds); round++) {
    await ready();
    const responses = await batch("client.reconnect", [params, params]);
    responses.forEach((response) => assert.equal(response.success, true, JSON.stringify(response)));
    report.rounds.push({ round, responses });
  }
  await ready();
  report.sharedSocket = await batch("client.reconnect", [params, params], true);
  report.sharedSocket.forEach((response) => assert.equal(response.success, true));
  await ready();
  if (values["cli-path"] && values.client) {
    report.cli = await Promise.all([cliReconnect(), cliReconnect()]);
    report.cli.forEach((result) => assert.equal(result.code, 0, JSON.stringify(result)));
    await ready();
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, output }));
}
