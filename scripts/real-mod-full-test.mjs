#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildProgram } from "../cli/dist/index.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT_DIR, "tmp/real-e2e/mct.real.config.json");
const STATE_DIR = path.join(ROOT_DIR, "tmp/real-e2e/state");
const REPORT_DIR = path.join(ROOT_DIR, "tmp/real-e2e/reports");
const SCREENSHOT_DIR = path.join(ROOT_DIR, "tmp/real-e2e/screenshots");
const CLIENT_LOG_PATH = path.join(STATE_DIR, "logs", "client-real.log");
const SERVER_LOG_PATH = path.join(ROOT_DIR, "tmp/real-e2e/server/logs/latest.log");
const SERVER_PLUGIN_PATH = path.join(ROOT_DIR, "tmp/real-e2e/server/plugins/mct-paper-fixture-0.1.0.jar");
const BUILT_PLUGIN_PATH = path.join(ROOT_DIR, "paper-fixture/build/libs/mct-paper-fixture-0.1.0.jar");
const RESOURCEPACK_PATH = path.join(ROOT_DIR, "tmp/real-e2e/resourcepack/test-pack.zip");
const RESOURCEPACK_PORT = 18080;
const RESOURCEPACK_URL = `http://127.0.0.1:${RESOURCEPACK_PORT}/test-pack.zip`;
const REAL_CLIENT_INSTANCE_ID = "mct-real-1.20.4-fabric";
const REAL_CLIENT_WS_PORT = 25560;
const REAL_CLIENT_INSTANCE_PATH_FRAGMENT = path.join("PrismLauncher", "instances", REAL_CLIENT_INSTANCE_ID);

const NON_REQUEST_LEAF_COMMANDS = [
  "client launch",
  "client list",
  "client stop",
  "client wait-ready",
  "config-show",
  "server start",
  "server status",
  "server stop",
  "server wait-ready"
];

const FIXTURE = {
  chest: { x: 10, y: 80, z: 34 },
  craft: { x: 12, y: 80, z: 34 },
  anvil: { x: 14, y: 80, z: 34 },
  breakBlock: { x: 15, y: 80, z: 35 },
  placeBlock: { x: 14, y: 80, z: 36 },
  sign: { x: 16, y: 80, z: 36 },
  enchant: { x: 16, y: 80, z: 40 },
  reset: { x: 18, y: 80, z: 37 },
  teleport: { x: 12.5, y: 80, z: 37.5 }
};

function collectLeafCommands(command, parents = []) {
  if (command.commands.length === 0) {
    return [parents.join(" ")];
  }

  return command.commands.flatMap((child) => collectLeafCommands(child, [...parents, child.name()]));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function approx(value, expected, epsilon = 0.75) {
  return Math.abs(Number(value) - expected) <= epsilon;
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function expect(condition, message) {
  assert.equal(Boolean(condition), true, message);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function sha1Hex(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

function countOccurrences(text, fragment) {
  if (!text || !fragment) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const nextIndex = text.indexOf(fragment, cursor);
    if (nextIndex === -1) {
      break;
    }
    count += 1;
    cursor = nextIndex + fragment.length;
  }
  return count;
}

async function ensureFileExists(filePath) {
  await stat(filePath);
}

async function runCommand(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: ROOT_DIR,
      maxBuffer: 16 * 1024 * 1024
    });

    return {
      ok: true,
      command,
      args,
      startedAt,
      durationMs: Date.now() - started,
      exitCode: 0,
      stdout,
      stderr,
      json: parseJsonMaybe(stdout)
    };
  } catch (error) {
    const failure = error;
    const result = {
      ok: false,
      command,
      args,
      startedAt,
      durationMs: Date.now() - started,
      exitCode: Number(failure.code ?? 1),
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
      json: parseJsonMaybe(String(failure.stdout ?? "")) ?? parseJsonMaybe(String(failure.stderr ?? ""))
    };

    if (options.allowFailure) {
      return result;
    }

    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stderr || result.stdout || JSON.stringify(result.json)
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function runCli(args, options = {}) {
  return runCommand(
    process.execPath,
    [path.join(ROOT_DIR, "cli/dist/index.js"), "--config", CONFIG_PATH, "--state-dir", STATE_DIR, ...args],
    options
  );
}

function unwrapCliSuccess(result) {
  assert.equal(result.ok, true, `CLI process failed: ${result.stderr || result.stdout}`);
  assert.equal(result.json?.success, true, `CLI returned failure: ${result.stderr || result.stdout}`);
  return result.json.data;
}

function unwrapRequestSuccess(result) {
  const data = unwrapCliSuccess(result);
  assert.equal(data.success, true, `Client request failed: ${JSON.stringify(data)}`);
  return data.data;
}

function isTeleportPosition(position) {
  return (
    approx(position.x, FIXTURE.teleport.x, 0.1) &&
    approx(position.y, FIXTURE.teleport.y, 0.1) &&
    approx(position.z, FIXTURE.teleport.z, 0.1) &&
    position.onGround === true
  );
}

function chestSlotPoint(screen, slot) {
  const left = (Number(screen.width) - 176) / 2;
  const top = (Number(screen.height) - 166) / 2;
  return {
    x: Math.round(left + 8 + (slot % 9) * 18 + 8),
    y: Math.round(top + 18 + Math.floor(slot / 9) * 18 + 8)
  };
}

function pointNear(actual, expected, epsilon = 6) {
  return approx(actual.x, expected.x, epsilon) && approx(actual.y, expected.y, epsilon);
}

async function waitForLogEntry(text, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(SERVER_LOG_PATH, "utf8");
      if (content.includes(text)) {
        return true;
      }
    } catch {}
    await sleep(500);
  }

  throw new Error(`Did not find log entry within ${timeoutSeconds}s: ${text}`);
}

async function waitForInWorld(timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastFailure = null;

  while (Date.now() < deadline) {
    const result = await runCli(["--client", "real", "position", "get"], { allowFailure: true });
    if (result.ok && result.json?.success === true && result.json.data?.success === true) {
      return {
        cli: result,
        position: result.json.data.data
      };
    }

    lastFailure = result.stderr || result.stdout || JSON.stringify(result.json);
    await sleep(2000);
  }

  throw new Error(`Client did not enter world within ${timeoutSeconds}s: ${lastFailure ?? "unknown error"}`);
}

async function waitForResourcePackPending(timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatus = null;
  let lastGui = null;

  while (Date.now() < deadline) {
    const statusResult = await runCli(["--client", "real", "resourcepack", "status"], { allowFailure: true });
    if (statusResult.ok && statusResult.json?.success === true && statusResult.json.data?.success === true) {
      lastStatus = statusResult.json.data.data;
      if (lastStatus.acceptanceStatus === "pending") {
        return {
          cli: statusResult,
          status: lastStatus
        };
      }
    }

    const guiResult = await runCli(["--client", "real", "gui", "info"], { allowFailure: true });
    if (guiResult.ok && guiResult.json?.success === true && guiResult.json.data?.success === true) {
      lastGui = guiResult.json.data.data;
    }

    await sleep(500);
  }

  throw new Error(
    `Resource pack status did not become pending within ${timeoutSeconds}s: ${JSON.stringify({
      lastStatus,
      lastGui
    })}`
  );
}

async function waitForTeleport(timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latestPosition = null;

  while (Date.now() < deadline) {
    const result = await runCli(["--client", "real", "position", "get"], { allowFailure: true });
    if (result.ok && result.json?.success === true && result.json.data?.success === true) {
      latestPosition = result.json.data.data;
      if (isTeleportPosition(latestPosition)) {
        return {
          cli: result,
          position: latestPosition
        };
      }
    }

    await sleep(500);
  }

  throw new Error(`Teleport position was not reached within ${timeoutSeconds}s: ${JSON.stringify(latestPosition)}`);
}

async function takeDesktopScreenshot(name) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputPath = path.join(SCREENSHOT_DIR, `${timestamp}-${name}.png`);
  const result = await runCommand("/usr/sbin/screencapture", ["-x", outputPath], { allowFailure: true });

  if (!result.ok) {
    return {
      ok: false,
      path: outputPath,
      error: result.stderr || result.stdout
    };
  }

  return {
    ok: true,
    path: outputPath
  };
}

async function syncBuiltFixturePlugin() {
  await access(BUILT_PLUGIN_PATH);
  await mkdir(path.dirname(SERVER_PLUGIN_PATH), { recursive: true });
  await copyFile(BUILT_PLUGIN_PATH, SERVER_PLUGIN_PATH);
}

async function updateServerProperties(resourcePackUrl = null, resourcePackSha1 = null) {
  const filePath = path.join(ROOT_DIR, "tmp/real-e2e/server/server.properties");
  let content = "";

  try {
    content = await readFile(filePath, "utf8");
  } catch {}

  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const values = new Map();

  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator < 0) {
      continue;
    }
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }

  if (resourcePackUrl && resourcePackSha1) {
    values.set("resource-pack", resourcePackUrl);
    values.set("resource-pack-sha1", resourcePackSha1);
    values.set("require-resource-pack", "false");
  } else {
    values.delete("resource-pack");
    values.delete("resource-pack-sha1");
    values.delete("require-resource-pack");
    values.delete("resource-pack-prompt");
  }

  const nextContent = `${[...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
  await writeFile(filePath, nextContent, "utf8");
}

async function startResourcePackServer() {
  const zip = await readFile(RESOURCEPACK_PATH);
  const sha1 = sha1Hex(zip);
  const server = createServer((request, response) => {
    if (request.url !== "/test-pack.zip") {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": zip.length
    });
    response.end(zip);
  });

  await new Promise((resolve) => server.listen(RESOURCEPACK_PORT, "127.0.0.1", resolve));

  return {
    url: RESOURCEPACK_URL,
    sha1,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

async function stopEnvironment() {
  const clientStop = await runCli(["client", "stop", "real"], { allowFailure: true });
  const serverStop = await runCli(["server", "stop"], { allowFailure: true });
  return {
    clientStop,
    serverStop
  };
}

async function findPidsWithLsof(port) {
  const result = await runCommand("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { allowFailure: true });
  if (!result.ok || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function findPidsWithPgrep(fragment) {
  const result = await runCommand("pgrep", ["-f", fragment], { allowFailure: true });
  if (!result.ok || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
}

async function terminatePid(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForPortRelease(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await findPidsWithLsof(port)).length === 0) {
      return;
    }
    await sleep(250);
  }

  throw new Error(`Client WebSocket port ${port} did not become free within ${timeoutMs}ms`);
}

async function collectClientResidue() {
  const listeningPids = await findPidsWithLsof(REAL_CLIENT_WS_PORT);
  const instancePids = await findPidsWithPgrep(REAL_CLIENT_INSTANCE_ID);
  const launcherPids = await findPidsWithPgrep("launch-real-fabric-client.mjs");
  const pids = [...new Set([...listeningPids, ...instancePids, ...launcherPids])].sort((left, right) => left - right);

  return {
    listeningPids,
    instancePids,
    launcherPids,
    pids
  };
}

async function waitForClientResidueClear(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latestResidue = await collectClientResidue();

  while (Date.now() < deadline) {
    latestResidue = await collectClientResidue();
    if (latestResidue.pids.length === 0) {
      await waitForPortRelease(REAL_CLIENT_WS_PORT, 1000);
      return latestResidue;
    }
    await sleep(250);
  }

  throw new Error(`Client residue did not clear within ${timeoutMs}ms: ${JSON.stringify(latestResidue)}`);
}

async function readClientLogText() {
  try {
    return await readFile(CLIENT_LOG_PATH, "utf8");
  } catch {
    return "";
  }
}

async function getBindConflictCount() {
  return countOccurrences(await readClientLogText(), "java.net.BindException: Address already in use");
}

async function waitForClientLogCountIncrease(fragment, baselineCount, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (countOccurrences(await readClientLogText(), fragment) > baselineCount) {
      return true;
    }
    await sleep(500);
  }

  throw new Error(`Did not observe client log entry within ${timeoutSeconds}s: ${fragment}`);
}

async function forceKillClientResidueByPattern() {
  const patterns = [
    REAL_CLIENT_INSTANCE_ID,
    REAL_CLIENT_INSTANCE_PATH_FRAGMENT,
    "launch-real-fabric-client.mjs"
  ];

  for (const signal of ["-TERM", "-KILL"]) {
    for (const pattern of patterns) {
      await runCommand("pkill", [signal, "-f", pattern], { allowFailure: true });
    }
    await sleep(1000);
  }
}

async function cleanupClientResidue(recordStep, label = "cleanup-client-residue") {
  let latestResidue = await collectClientResidue();

  if (latestResidue.pids.length === 0) {
    await forceKillClientResidueByPattern();
    await waitForPortRelease(REAL_CLIENT_WS_PORT, 1000);
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const terminatedPids = [];
    const forceKilledPids = [];

    for (const pid of latestResidue.pids) {
      if (await terminatePid(pid, "SIGTERM")) {
        terminatedPids.push(pid);
      }
    }

    await sleep(1000);

    const remainingResidue = await collectClientResidue();
    for (const pid of remainingResidue.pids) {
      if (await terminatePid(pid, "SIGKILL")) {
        forceKilledPids.push(pid);
      }
    }

    await forceKillClientResidueByPattern();

    recordStep(
      label,
      {
        ok: true,
        exitCode: 0,
        durationMs: 0,
        args: [],
        stdout: "",
        stderr: "",
        json: null
      },
      {
        kind: "cleanup",
        attempt,
        initialResidue: latestResidue,
        terminatedPids,
        forceKilledPids
      }
    );

    try {
      await waitForClientResidueClear(15000);
      await waitForPortRelease(REAL_CLIENT_WS_PORT, 3000);
      return;
    } catch (error) {
      latestResidue = await collectClientResidue();
      if (attempt === 3) {
        throw new Error(
          `${label} failed after ${attempt} attempts: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      await sleep(1000);
    }
  }
}

function buildSupportMatrix() {
  const leafCommands = collectLeafCommands(buildProgram()).sort();
  const requestLeafCommands = leafCommands.filter((entry) => !NON_REQUEST_LEAF_COMMANDS.includes(entry));
  return {
    leafCommands,
    requestLeafCommands
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await ensureFileExists(RESOURCEPACK_PATH);
  await syncBuiltFixturePlugin();

  const summary = {
    startedAt: new Date().toISOString(),
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    serverLogPath: SERVER_LOG_PATH,
    clientLogPath: CLIENT_LOG_PATH,
    screenshots: [],
    supportMatrix: null,
    steps: [],
    cleanup: null
  };

  const supportMatrix = buildSupportMatrix();
  const coveredRequestLeafCommands = new Set();
  const coveredNonRequestLeafCommands = new Set();
  const resourcePackServer = await startResourcePackServer();
  await updateServerProperties();
  let cachedEntityIds = {};

  summary.supportMatrix = {
    requestLeafCommands: supportMatrix.requestLeafCommands,
    requestLeafCount: supportMatrix.requestLeafCommands.length,
    nonRequestLeafCommands: NON_REQUEST_LEAF_COMMANDS
  };

  const recordStep = (name, result, extra = {}) => {
    summary.steps.push({
      name,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      args: result.args,
      data: result.json?.data ?? result.json ?? null,
      stderr: result.stderr || undefined,
      stdout: result.stdout || undefined,
      ...extra
    });
  };

  async function captureClientDiagnostics(label) {
    const slug = slugify(label || "failure");
    const timestamp = new Date().toISOString().replaceAll(":", "-");

    const desktopShot = await takeDesktopScreenshot(`${slug}-desktop`);
    summary.screenshots.push({ source: "desktop.failure", label, ...desktopShot });

    const clientShotPath = path.join(SCREENSHOT_DIR, `${timestamp}-${slug}-client.png`);
    const clientShot = await runCli(
      ["--client", "real", "screenshot", "--output", clientShotPath, "--gui"],
      { allowFailure: true }
    );
    recordStep(`${label} diagnostic screenshot`, clientShot, {
      kind: "diagnostic",
      label,
      outputPath: clientShotPath
    });
    if (clientShot.ok && clientShot.json?.success === true && clientShot.json.data?.success === true) {
      summary.screenshots.push({ ok: true, path: clientShotPath, source: "capture.screenshot.failure", label });
    }

    const position = await runCli(["--client", "real", "position", "get"], { allowFailure: true });
    recordStep(`${label} diagnostic position`, position, { kind: "diagnostic", label });

    const rotation = await runCli(["--client", "real", "rotation", "get"], { allowFailure: true });
    recordStep(`${label} diagnostic rotation`, rotation, { kind: "diagnostic", label });

    const guiInfo = await runCli(["--client", "real", "gui", "info"], { allowFailure: true });
    recordStep(`${label} diagnostic gui`, guiInfo, { kind: "diagnostic", label });
  }

  async function runNonRequestLeaf(leaf, args, verify) {
    const result = await runCli(args);
    const data = unwrapCliSuccess(result);
    if (verify) {
      await verify(data, result);
    }
    coveredNonRequestLeafCommands.add(leaf);
    recordStep(leaf, result, { leaf, kind: "non_request", verifiedData: data });
    return data;
  }

  async function runClientLeaf(leaf, args, verify) {
    try {
      const result = await runCli(["--client", "real", ...args]);
      const data = unwrapRequestSuccess(result);
      if (verify) {
        await verify(data, result);
      }
      coveredRequestLeafCommands.add(leaf);
      recordStep(leaf, result, { leaf, kind: "request", verifiedData: data });
      return data;
    } catch (error) {
      await captureClientDiagnostics(`runClientLeaf-${leaf}`);
      throw error;
    }
  }

  async function runSetup(name, args, verify) {
    try {
      const result = await runCli(["--client", "real", ...args]);
      const data = unwrapRequestSuccess(result);
      if (verify) {
        await verify(data, result);
      }
      recordStep(name, result, { kind: "setup", verifiedData: data });
      return data;
    } catch (error) {
      await captureClientDiagnostics(`runSetup-${name}`);
      throw error;
    }
  }

  async function pollClientRequest(name, args, predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let lastData = null;

    while (Date.now() < deadline) {
      const result = await runCli(["--client", "real", ...args], { allowFailure: true });
      if (result.ok && result.json?.success === true && result.json.data?.success === true) {
        const data = result.json.data.data;
        lastData = data;
        if (predicate(data)) {
          recordStep(name, result, { kind: "setup", verifiedData: data });
          return data;
        }
      }
      await sleep(200);
    }

    throw new Error(`${name} timed out: ${JSON.stringify(lastData)}`);
  }

  function scheduleClientCommand(args, delayMs) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        runCli(["--client", "real", ...args])
          .then((result) => resolve(result))
          .catch(reject);
      }, delayMs);
    });
  }

  async function resetFixture(name = "setup fixture reset") {
    await runSetup(`${name} move`, ["move", "to", String(FIXTURE.reset.x), String(FIXTURE.reset.y), String(FIXTURE.reset.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "failed to approach reset trigger");
    });
    await runSetup(`${name} trigger`, ["block", "interact", String(FIXTURE.reset.x), String(FIXTURE.reset.y), String(FIXTURE.reset.z)], (data) => {
      expect(data.success === true, "failed to trigger fixture reset");
    });
    const teleported = await waitForTeleport(30);
    recordStep(name, teleported.cli, { kind: "setup", position: teleported.position });
  }

  async function applyHudSetup() {
    await sleep(1200);
  }

  async function waitForClientReadyWithConflictDetection(label, baselineBindConflicts) {
    const deadline = Date.now() + 180_000;
    let lastFailure = "unknown failure";

    while (Date.now() < deadline) {
      const waitReady = await runCli(["client", "wait-ready", "real", "--timeout", "5"], { allowFailure: true });
      if (waitReady.ok && waitReady.json?.success === true) {
        const waitReadyData = unwrapCliSuccess(waitReady);
        expect(waitReadyData.connected === true, `${label} client did not become ready`);
        recordStep(`${label} client wait-ready`, waitReady, { kind: "setup" });
        return {
          ready: true
        };
      }

      lastFailure = waitReady.stderr || waitReady.stdout || JSON.stringify(waitReady.json);
      if ((await getBindConflictCount()) > baselineBindConflicts) {
        recordStep(`${label} client wait-ready bind-conflict`, waitReady, {
          kind: "setup",
          bindConflict: true
        });
        return {
          ready: false,
          bindConflict: true,
          lastFailure
        };
      }
    }

    return {
      ready: false,
      bindConflict: false,
      lastFailure
    };
  }

  async function launchRealClientAndWaitReady(label) {
    let lastFailure = "unknown failure";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await cleanupClientResidue(recordStep, `${label} cleanup before launch`);
      const baselineBindConflicts = await getBindConflictCount();

      const launch = await runCli(["client", "launch", "real"], { allowFailure: true });
      recordStep(`${label} client launch`, launch, { kind: "setup", attempt });
      if (!launch.ok || launch.json?.success !== true) {
        lastFailure = launch.stderr || launch.stdout || JSON.stringify(launch.json);
      } else {
        const launchData = unwrapCliSuccess(launch);
        expect(launchData.name === "real", `${label} returned unexpected client name`);

        const readyState = await waitForClientReadyWithConflictDetection(label, baselineBindConflicts);
        if (readyState.ready) {
          return;
        }
        lastFailure = readyState.lastFailure ?? lastFailure;
        if (!readyState.bindConflict && attempt === 2) {
          throw new Error(`${label} failed: ${lastFailure}`);
        }
      }

      const bindConflict = (await getBindConflictCount()) > baselineBindConflicts;
      if (!bindConflict || attempt === 2) {
        throw new Error(`${label} failed: ${lastFailure}`);
      }

      const stopped = await runCli(["client", "stop", "real"], { allowFailure: true });
      recordStep(`${label} client stop after bind conflict`, stopped, {
        kind: "setup",
        attempt,
        bindConflict: true
      });
      await cleanupClientResidue(recordStep, `${label} cleanup after bind conflict`);
      await sleep(2000);
    }
  }

  async function relaunchClient(label) {
    const stopped = await runCli(["client", "stop", "real"], { allowFailure: true });
    recordStep(`${label} client stop`, stopped, { kind: "setup" });
    await cleanupClientResidue(recordStep);
    await launchRealClientAndWaitReady(label);

    await sleep(5000);
    const inWorld = await waitForInWorld(180);
    recordStep(`${label} position get`, inWorld.cli, { kind: "setup", position: inWorld.position });
    await resetFixture(`${label} fixture reset`);
  }

  async function restartEnvironmentWithResourcePack(label) {
    const serverStop = await runCli(["server", "stop"], { allowFailure: true });
    recordStep(`${label} server stop`, serverStop, { kind: "setup" });
    await updateServerProperties(resourcePackServer.url, resourcePackServer.sha1);

    await runNonRequestLeaf(`${label} server start`, ["server", "start", "--eula"], (data) => {
      expect(data.running === true, "server did not restart with resource pack enabled");
    });
    await runNonRequestLeaf(`${label} server wait-ready`, ["server", "wait-ready", "--timeout", "120"], (data) => {
      expect(data.reachable === true, "resource pack server was not reachable");
    });

    const existingClient = await runCli(["client", "wait-ready", "real", "--timeout", "20"], { allowFailure: true });
    if (existingClient.ok && existingClient.json?.success === true) {
      const clientReadyData = unwrapCliSuccess(existingClient);
      expect(clientReadyData.connected === true, "resource pack client reuse did not stay ready");
      recordStep(`${label} client reuse wait-ready`, existingClient, {
        kind: "setup",
        reusedClient: true
      });
      await runClientLeaf(`${label} client reconnect`, ["client", "reconnect"], (data) => {
        expect(data.connecting === true, "resource pack client reconnect did not start");
      });
    } else {
      await cleanupClientResidue(recordStep, `${label} cleanup before fallback launch`);
      await launchRealClientAndWaitReady(label);
    }

    const pendingPack = await waitForResourcePackPending(60);
    recordStep(`${label} resourcepack pending`, pendingPack.cli, {
      kind: "setup",
      verifiedData: pendingPack.status
    });
    const promptShot = await takeDesktopScreenshot(`${slugify(label)}-resourcepack-pending`);
    summary.screenshots.push({ source: "desktop.resourcepack.pending", label, ...promptShot });
  }

  async function openChestSetup(name = "setup open chest") {
    await runSetup(name, ["block", "interact", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.success === true, "chest did not open");
    });
    await runSetup(`${name} wait-open`, ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "GUI did not open after chest interact");
    });
  }

  async function closeGuiSetup(name = "setup close gui") {
    const result = await runCli(["--client", "real", "gui", "close"], { allowFailure: true });
    if (result.ok && result.json?.success === true && result.json.data?.success === true) {
      recordStep(name, result, { kind: "setup", verifiedData: result.json.data.data });
      return;
    }
    recordStep(name, result, { kind: "setup", ignoredFailure: true });
  }

  async function prepareEnchantSetup() {
    await runSetup(
      "setup open enchanting table",
      ["block", "interact", String(FIXTURE.enchant.x), String(FIXTURE.enchant.y), String(FIXTURE.enchant.z)],
      (data) => {
        expect(data.success === true, "enchant table did not open");
      }
    );
    await runSetup("setup wait enchant gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "enchant gui did not open");
    });

    const snapshot = await runSetup("setup enchant snapshot", ["gui", "snapshot"], (data) => {
      expect(Array.isArray(data.slots), "enchant snapshot slots missing");
    });

    const swordSlot = snapshot.slots.find((slot) => slot.item?.type === "minecraft:diamond_sword")?.slot;
    const lapisSlot = snapshot.slots.find((slot) => slot.item?.type === "minecraft:lapis_lazuli")?.slot;
    expect(Number.isInteger(swordSlot), "diamond sword slot not found in enchant gui");
    expect(Number.isInteger(lapisSlot), "lapis slot not found in enchant gui");

    await runSetup("setup put sword into enchant slot", ["gui", "click", String(swordSlot), "--button", "left"]);
    await runSetup("setup confirm sword slot", ["gui", "click", "0", "--button", "left"]);
    await runSetup("setup put lapis into enchant slot", ["gui", "click", String(lapisSlot), "--button", "left"]);
    await runSetup("setup confirm lapis slot", ["gui", "click", "1", "--button", "left"]);
    await sleep(600);
  }

  try {
    const initialCleanup = await stopEnvironment();
    recordStep("cleanup-before-client-stop", initialCleanup.clientStop);
    recordStep("cleanup-before-server-stop", initialCleanup.serverStop);
    await cleanupClientResidue(recordStep);

    await runNonRequestLeaf("config-show", ["config-show"], (data) => {
      expect(data.stateDir === STATE_DIR, "config-show returned unexpected state dir");
    });

    await runNonRequestLeaf("server start", ["server", "start", "--eula"], (data) => {
      expect(data.running === true, "server did not start");
    });

    await runNonRequestLeaf("server status", ["server", "status"], (data) => {
      expect(data.running === true, "server status did not report running");
    });

    await runNonRequestLeaf("server wait-ready", ["server", "wait-ready", "--timeout", "120"], (data) => {
      expect(data.reachable === true, "server was not reachable");
    });

    await runNonRequestLeaf("client launch", ["client", "launch", "real"], (data) => {
      expect(data.name === "real", "client launch returned unexpected name");
    });

    await runNonRequestLeaf("client list", ["client", "list"], (data) => {
      expect(Array.isArray(data.clients), "client list did not return clients");
      expect(data.clients.some((client) => client.name === "real"), "client list missing real client");
    });

    await runNonRequestLeaf("client wait-ready", ["client", "wait-ready", "real", "--timeout", "180"], (data) => {
      expect(data.connected === true, "client did not become ready");
    });

    await sleep(5000);

    const inWorld = await waitForInWorld(180);
    coveredRequestLeafCommands.add("position get");
    recordStep("position get", inWorld.cli, {
      leaf: "position get",
      kind: "request",
      position: inWorld.position
    });

    const readyDesktopShot = await takeDesktopScreenshot("client-in-world");
    summary.screenshots.push(readyDesktopShot);

    await resetFixture("setup initial fixture reset");

    await runClientLeaf("status health", ["status", "health"], (data) => {
      expect(approx(data.health, 20, 0.5), "unexpected health value");
      expect(data.food === 20, "unexpected food value");
    });

    await runClientLeaf("status effects", ["status", "effects"], (data) => {
      expect(Array.isArray(data.effects), "status effects did not return an array");
    });

    await runClientLeaf("status experience", ["status", "experience"], (data) => {
      expect(data.level === 30, "unexpected experience level");
    });

    await runClientLeaf("status gamemode", ["status", "gamemode"], (data) => {
      expect(data.gameMode === "survival", "unexpected game mode");
    });

    await runClientLeaf("status world", ["status", "world"], (data) => {
      expect(String(data.dimension).includes("overworld"), "unexpected world dimension");
    });

    await runClientLeaf("status all", ["status", "all"], (data) => {
      expect(data.health?.food === 20, "status all missing health");
      expect(data.position?.onGround === true, "status all missing position");
    });

    const screenSize = await runClientLeaf("screen size", ["screen", "size"], (data) => {
      expect(Number(data.width) > 0, "screen width was not positive");
      expect(Number(data.height) > 0, "screen height was not positive");
    });

    await resetFixture("setup reset before raw keyboard input");

    await runClientLeaf("input key down", ["input", "key", "down", "shift"], (data) => {
      expect(data.down === true, "input key down did not report success");
      expect(Array.isArray(data.keys) && data.keys.includes("shift"), "input key down did not retain shift");
    });

    await runClientLeaf("input keys-down", ["input", "keys-down"], (data) => {
      expect(Array.isArray(data.keys), "input keys-down did not return an array");
      expect(data.keys.includes("shift"), "input keys-down did not include shift");
    });

    await runClientLeaf("input key up", ["input", "key", "up", "shift"], (data) => {
      expect(data.up === true, "input key up did not report success");
      expect(Array.isArray(data.keys) && !data.keys.includes("shift"), "input key up did not release shift");
    });

    await runClientLeaf("input key press", ["input", "key", "press", "inventory"], (data) => {
      expect(data.pressed === true, "input key press did not report success");
    });
    await runSetup("setup wait inventory screen for raw key press", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "raw input key press did not open inventory");
    });
    await pollClientRequest(
      "setup inspect inventory after raw key press",
      ["gui", "info"],
      (data) => data.open === true && Number(data.size) > 0
    );
    await closeGuiSetup("setup close inventory after raw key press");

    await runSetup("setup select first hotbar slot before raw scroll", ["inventory", "hotbar", "0"], (data) => {
      expect(data.item?.type === "minecraft:dirt", "failed to reset hotbar before raw scroll");
    });

    await runClientLeaf(
      "input scroll",
      ["input", "scroll", String(Math.round(screenSize.width / 2)), String(Math.round(screenSize.height / 2)), "--delta", "1"],
      async (data) => {
        expect(data.scrolled === true, "input scroll did not report success");
        const held = unwrapRequestSuccess(await runCli(["--client", "real", "inventory", "held"]));
        expect(held.item?.type !== "minecraft:dirt", "input scroll did not change the selected hotbar slot");
      }
    );

    await resetFixture("setup reset before input key hold");

    await runClientLeaf("input key hold", ["input", "key", "hold", "w", "--duration", "800"], async (data) => {
      expect(data.held === true, "input key hold did not report success");
      expect(Number(data.actualDuration) >= 700, "input key hold returned an unexpectedly short duration");
      const position = unwrapRequestSuccess(await runCli(["--client", "real", "position", "get"]));
      const moved = Math.hypot(position.x - FIXTURE.teleport.x, position.z - FIXTURE.teleport.z);
      expect(moved > 0.5, "input key hold did not move the player");
    });

    await resetFixture("setup reset before movement");

    await runClientLeaf("look set", ["look", "set", "--yaw", "90", "--pitch", "-15"], (data) => {
      expect(approx(data.yaw, 90, 0.1), "look set yaw mismatch");
      expect(approx(data.pitch, -15, 0.1), "look set pitch mismatch");
    });

    await runClientLeaf("rotation get", ["rotation", "get"], (data) => {
      expect(approx(data.yaw, 90, 0.25), "rotation yaw mismatch");
      expect(approx(data.pitch, -15, 0.25), "rotation pitch mismatch");
    });

    await runClientLeaf("look at", ["look", "at", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(typeof data.yaw === "number", "look at yaw missing");
      expect(typeof data.pitch === "number", "look at pitch missing");
    });

    await runClientLeaf("look entity", ["look", "entity", "--name", "MCT Trader"], (data) => {
      expect(typeof data.entityId === "number", "look entity did not return entity id");
    });

    await runClientLeaf("move jump", ["move", "jump"], (data) => {
      expect(data.success === true, "move jump failed");
    });

    await runClientLeaf("move sneak", ["move", "sneak", "on"], (data) => {
      expect(data.sneaking === true, "move sneak did not enable sneaking");
    });

    await runClientLeaf("move sprint", ["move", "sprint", "on"], (data) => {
      expect(data.sprinting === true, "move sprint did not enable sprint");
    });

    await runClientLeaf("move forward", ["move", "forward", "2"], (data) => {
      const dx = Number(data.newPos?.x) - FIXTURE.teleport.x;
      const dz = Number(data.newPos?.z) - FIXTURE.teleport.z;
      expect(Math.hypot(dx, dz) > 0.5, "move forward did not change position");
    });

    await runClientLeaf("move back", ["move", "back", "1"], (data) => {
      expect(typeof data.newPos?.x === "number", "move back did not return position");
    });

    await runClientLeaf("move left", ["move", "left", "1"], (data) => {
      expect(typeof data.newPos?.x === "number", "move left did not return position");
    });

    await runClientLeaf("move right", ["move", "right", "1"], (data) => {
      expect(typeof data.newPos?.x === "number", "move right did not return position");
    });

    await runClientLeaf("move to", ["move", "to", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "move to did not arrive near target");
    });

    await resetFixture("setup reset before inventory");

    await runClientLeaf("inventory get", ["inventory", "get"], (data) => {
      expect(Array.isArray(data.slots), "inventory get slots missing");
      expect(data.slots.length > 0, "inventory get returned no slots");
    });

    await runClientLeaf("inventory slot", ["inventory", "slot", "0"], (data) => {
      expect(data.item?.type === "minecraft:dirt", "inventory slot 0 was not dirt");
    });

    await runClientLeaf("inventory held", ["inventory", "held"], (data) => {
      expect(data.item?.type === "minecraft:dirt", "inventory held was not dirt");
    });

    await runClientLeaf("inventory hotbar", ["inventory", "hotbar", "3"], (data) => {
      expect(data.selectedSlot === 3, "inventory hotbar did not switch to slot 3");
      expect(data.item?.type === "minecraft:writable_book", "inventory hotbar slot 3 was not writable book");
    });

    await runClientLeaf("inventory use", ["inventory", "use"], (data) => {
      expect(data.success === true, "inventory use did not succeed");
    });
    await closeGuiSetup("setup close book screen after inventory use");

    await resetFixture("setup reset before swap hands");
    await runSetup("setup select sword", ["inventory", "hotbar", "5"], (data) => {
      expect(data.selectedSlot === 5, "failed to select sword hotbar slot");
    });

    await runClientLeaf("inventory swap-hands", ["inventory", "swap-hands"], (data) => {
      expect(data.offHand?.type === "minecraft:diamond_sword", "swap hands did not move sword to offhand");
    });

    await resetFixture("setup reset before drop");
    await runSetup("setup select bread", ["inventory", "hotbar", "4"], (data) => {
      expect(data.item?.type === "minecraft:bread", "failed to select bread");
    });

    await runClientLeaf("inventory drop", ["inventory", "drop", "--all"], (data) => {
      expect(data.dropped === true, "inventory drop did not report success");
    });

    await resetFixture("setup reset before book commands");
    await runSetup("setup select writable book", ["inventory", "hotbar", "3"], (data) => {
      expect(data.item?.type === "minecraft:writable_book", "failed to select writable book");
    });

    const bookPages = ["Real Page 1", "Real Page 2"];
    await runClientLeaf("book write", ["book", "write", "--pages", ...bookPages], (data) => {
      expect(data.written === true, "book write failed");
      expect(Array.isArray(data.pages) && data.pages.length === 2, "book write pages missing");
    });

    await runClientLeaf("book read", ["book", "read"], (data) => {
      expect(Array.isArray(data.pages), "book read did not return pages");
      expect(data.pages.some((page) => page.includes("Real Page 1")), "book read missing written page");
    });

    await runClientLeaf("book sign", ["book", "sign", "--title", "Guide", "--author", "Bot"], (data) => {
      expect(data.signed === true, "book sign failed");
      expect(data.title === "Guide", "book sign title mismatch");
    });

    await resetFixture("setup reset before block and gui");

    await runClientLeaf(
      "block get",
      ["block", "get", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)],
      (data) => {
        expect(data.type === "minecraft:chest", "block get did not return chest fixture");
      }
    );

    await runClientLeaf(
      "block place",
      ["block", "place", String(FIXTURE.placeBlock.x), String(FIXTURE.placeBlock.y), String(FIXTURE.placeBlock.z), "--face", "up"],
      (data) => {
        expect(data.success === true, "block place failed");
        expect(data.placedType === "minecraft:dirt", "block place did not place dirt");
      }
    );

    await resetFixture("setup reset before block break");
    await runSetup("setup select pickaxe", ["inventory", "hotbar", "1"], (data) => {
      expect(data.item?.type === "minecraft:diamond_pickaxe", "failed to select pickaxe");
    });

    await runClientLeaf(
      "block break",
      ["block", "break", String(FIXTURE.breakBlock.x), String(FIXTURE.breakBlock.y), String(FIXTURE.breakBlock.z)],
      (data) => {
        expect(data.success === true, "block break failed");
        expect(data.blockType === "minecraft:air", "block break did not clear the target block");
      }
    );

    await resetFixture("setup reset before sign");

    await runClientLeaf("sign read", ["sign", "read", String(FIXTURE.sign.x), String(FIXTURE.sign.y), String(FIXTURE.sign.z)], (data) => {
      expect(Array.isArray(data.front), "sign read front text missing");
      expect(data.front[0] === "MCT Line 1", "sign read returned unexpected content");
    });

    await runClientLeaf(
      "sign edit",
      ["sign", "edit", String(FIXTURE.sign.x), String(FIXTURE.sign.y), String(FIXTURE.sign.z), "--lines", "A", "B", "C", "D"],
      (data) => {
        expect(data.front[0] === "A", "sign edit did not update the first line");
        expect(data.front[3] === "D", "sign edit did not update the fourth line");
      }
    );

    const scheduledOpenChest = scheduleClientCommand(
      ["block", "interact", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)],
      1000
    );
    await runClientLeaf("gui wait-open", ["gui", "wait-open", "--timeout", "6"], async (data) => {
      expect(data.opened === true, "gui wait-open did not detect chest");
      unwrapRequestSuccess(await scheduledOpenChest);
    });

    const chestGui = await runClientLeaf("gui info", ["gui", "info"], (data) => {
      expect(data.open === true, "gui info did not report an open screen");
      expect(typeof data.title === "string" && data.title.length > 0, "gui info title missing");
    });

    await runClientLeaf("gui snapshot", ["gui", "snapshot"], (data) => {
      expect(Array.isArray(data.slots), "gui snapshot slots missing");
      expect(data.slots.length > 20, "gui snapshot returned too few slots");
    });

    await runClientLeaf("gui slot", ["gui", "slot", "13"], (data) => {
      expect(data.item?.type === "minecraft:diamond", "gui slot 13 did not contain the fixture diamonds");
    });

    const slot0Point = chestSlotPoint(chestGui, 0);
    const slot3Point = chestSlotPoint(chestGui, 3);
    const slot5Point = chestSlotPoint(chestGui, 5);
    const slot13Point = chestSlotPoint(chestGui, 13);

    await runClientLeaf("input mouse-move", ["input", "mouse-move", String(slot13Point.x), String(slot13Point.y)], (data) => {
      expect(data.moved === true, "input mouse-move did not report success");
      expect(pointNear(data, slot13Point), "input mouse-move did not move near the target slot");
    });

    await runClientLeaf("input mouse-pos", ["input", "mouse-pos"], (data) => {
      expect(typeof data.x === "number" && typeof data.y === "number", "input mouse-pos did not return coordinates");
      expect(pointNear(data, slot13Point), "input mouse-pos did not reflect the latest mouse location");
    });

    await runClientLeaf("input click", ["input", "click", String(slot13Point.x), String(slot13Point.y)], async (data) => {
      expect(data.clicked === true, "input click did not report success");
      const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
      expect(snapshot.cursorItem?.type === "minecraft:diamond", "input click did not pick up the diamond stack");
    });

    await runSetup("setup return diamonds after raw click", ["gui", "click", "13", "--button", "left"], (data) => {
      expect(data.success === true, "failed to return diamonds after raw click");
    });

    await runClientLeaf(
      "input double-click",
      ["input", "double-click", String(slot13Point.x), String(slot13Point.y)],
      (data) => {
        expect(data.clicked === true, "input double-click did not report success");
        expect(data.count === 2, "input double-click did not report double click count");
      }
    );

    await runSetup("setup pick cobblestone for raw drag", ["gui", "click", "0", "--button", "left"], (data) => {
      expect(data.success === true, "failed to pick cobblestone before raw drag");
    });

    await runClientLeaf(
      "input drag",
      ["input", "drag", String(slot3Point.x), String(slot3Point.y), String(slot5Point.x), String(slot5Point.y), "--button", "left"],
      async (data) => {
        expect(data.dragged === true, "input drag did not report success");
        const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
        for (const slot of [3, 4, 5]) {
          const item = snapshot.slots.find((entry) => entry.slot === slot)?.item;
          expect(item?.type === "minecraft:cobblestone", `input drag did not distribute cobblestone to slot ${slot}`);
        }
      }
    );

    const capturePath = path.join(SCREENSHOT_DIR, "real-capture-gui.png");
    await runClientLeaf("screenshot", ["screenshot", "--output", capturePath, "--region", "0,0,200,200", "--gui"], async (data) => {
      await ensureFileExists(capturePath);
      expect(String(data.path).endsWith("real-capture-gui.png"), "screenshot did not return the expected output path");
      summary.screenshots.push({ ok: true, path: capturePath, source: "capture.screenshot" });
    });

    const guiShotPath = path.join(SCREENSHOT_DIR, "real-gui-screenshot.png");
    await runClientLeaf("gui screenshot", ["gui", "screenshot", "--output", guiShotPath], async (data) => {
      await ensureFileExists(guiShotPath);
      expect(String(data.path).endsWith("real-gui-screenshot.png"), "gui screenshot did not return the expected output path");
      summary.screenshots.push({ ok: true, path: guiShotPath, source: "gui.screenshot" });
    });

    await runClientLeaf(
      "wait",
      ["wait", "1", "--ticks", "20", "--until-health-above", "18", "--until-gui-open", "--until-on-ground", "--timeout", "5"],
      (data) => {
        expect(Number(data.waitedSeconds) >= 1.9, "wait completed too quickly");
        expect(data.guiOpen === true, "wait did not observe an open GUI");
        expect(data.onGround === true, "wait did not report onGround");
      }
    );

    await runClientLeaf("gui close", ["gui", "close"], (data) => {
      expect(data.success === true, "gui close failed");
    });

    await openChestSetup("setup reopen chest for gui click");
    await runClientLeaf("gui click", ["gui", "click", "13", "--button", "right"], (data) => {
      expect(data.success === true, "gui click failed");
    });
    await closeGuiSetup("setup close chest after gui click");

    await openChestSetup("setup reopen chest for gui drag");
    await runSetup("setup pick chest slot 0", ["gui", "click", "0", "--button", "left"], (data) => {
      expect(data.success === true, "failed to pick up chest item");
    });
    await runClientLeaf("gui drag", ["gui", "drag", "--slots", "1,2,3", "--button", "left"], (data) => {
      expect(data.success === true, "gui drag failed");
    });
    await closeGuiSetup("setup close chest after gui drag");

    await openChestSetup("setup reopen chest for gui wait-update");
    const scheduledGuiUpdate = scheduleClientCommand(["gui", "click", "22", "--button", "left"], 1000);
    await runClientLeaf("gui wait-update", ["gui", "wait-update", "--timeout", "6"], async (data) => {
      expect(data.updated === true, "gui wait-update did not detect a change");
      unwrapRequestSuccess(await scheduledGuiUpdate);
    });
    await closeGuiSetup("setup close chest after gui wait-update");

    await resetFixture("setup reset before block interact");
    await runClientLeaf(
      "block interact",
      ["block", "interact", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)],
      (data) => {
        expect(data.success === true, "block interact failed");
      }
    );
    await closeGuiSetup("setup close chest after block interact");

    await resetFixture("setup reset before hud");
    await applyHudSetup();

    await runClientLeaf("hud scoreboard", ["hud", "scoreboard"], (data) => {
      expect(data.title === "MCT Sidebar", "hud scoreboard title mismatch");
      expect(Array.isArray(data.entries) && data.entries.length >= 3, "hud scoreboard entries missing");
    });

    await runClientLeaf("hud tab", ["hud", "tab"], (data) => {
      expect(data.header === "MCT Header", "hud tab header mismatch");
      expect(Array.isArray(data.players) && data.players.length >= 1, "hud tab players missing");
    });

    await runClientLeaf("hud bossbar", ["hud", "bossbar"], (data) => {
      expect(Array.isArray(data.bossBars) && data.bossBars.length >= 1, "hud bossbar missing");
    });

    await runClientLeaf("hud actionbar", ["hud", "actionbar"], (data) => {
      expect(String(data.text).includes("MCT Actionbar"), "hud actionbar mismatch");
    });

    await runClientLeaf("hud title", ["hud", "title"], (data) => {
      expect(data.title === "MCT Title", "hud title mismatch");
      expect(data.subtitle === "MCT Subtitle", "hud subtitle mismatch");
    });

    await runClientLeaf("hud nametag", ["hud", "nametag", "--player", "TEST1"], (data) => {
      expect(data.prefix === "MCT[", "hud nametag prefix mismatch");
      expect(data.suffix === "]", "hud nametag suffix mismatch");
    });

    await resetFixture("setup reset before entity");

    await runClientLeaf("entity list", ["entity", "list", "--radius", "16"], (data) => {
      expect(Array.isArray(data.entities), "entity list missing entities");
      expect(data.entities.length >= 3, "entity list returned too few entities");
      cachedEntityIds = Object.fromEntries(data.entities.map((entity) => [entity.name, entity.id]));
      expect(cachedEntityIds["MCT Trader"], "entity list missing MCT Trader");
      expect(cachedEntityIds["MCT Mount"], "entity list missing MCT Mount");
      expect(cachedEntityIds["MCT Target"], "entity list missing MCT Target");
    });

    await runClientLeaf("entity info", ["entity", "info", "--id", String(cachedEntityIds["MCT Trader"])], (data) => {
      expect(data.name === "MCT Trader", "entity info returned the wrong entity");
      expect(data.type === "minecraft:villager", "entity info type mismatch");
    });

    await runClientLeaf("entity attack", ["entity", "attack", "--name", "MCT Target"], (data) => {
      expect(data.success === true, "entity attack failed");
      expect(data.entityType === "minecraft:zombie", "entity attack hit the wrong entity");
    });

    await runClientLeaf("entity interact", ["entity", "interact", "--name", "MCT Trader"], (data) => {
      expect(data.success === true, "entity interact failed");
      expect(data.entityType === "minecraft:villager", "entity interact hit the wrong entity");
    });
    await closeGuiSetup("setup close villager gui after entity interact");

    await resetFixture("setup reset before combat kill");
    await runSetup("setup select sword for combat kill", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat kill");
    });
    await runClientLeaf("combat kill", ["combat", "kill", "--nearest", "--type", "zombie", "--timeout", "20"], (data) => {
      expect(data.killed === true, "combat kill did not report a kill");
      expect(Number(data.hits) >= 1, "combat kill did not register any hits");
    });

    await resetFixture("setup reset before combat engage");
    await runSetup("setup select sword for combat engage", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat engage");
    });
    await runSetup("setup move away before combat engage", ["move", "to", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "failed to move away before combat engage");
    });
    await runClientLeaf("combat engage", ["combat", "engage", "--name", "MCT Target", "--timeout", "25"], (data) => {
      expect(data.killed === true, "combat engage did not report a kill");
      expect(Number(data.hits) >= 1, "combat engage did not register any hits");
    });

    await resetFixture("setup reset before combat chase");
    await runSetup("setup select sword for combat chase", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat chase");
    });
    await runSetup("setup move away before combat chase", ["move", "to", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "failed to move away before combat chase");
    });
    await runClientLeaf("combat chase", ["combat", "chase", "--name", "MCT Target", "--timeout", "25"], (data) => {
      expect(data.killed === true, "combat chase did not report a kill");
      expect(Number(data.hits) >= 1, "combat chase did not register any hits");
    });

    await resetFixture("setup reset before combat clear");
    await runSetup("setup select sword for combat clear", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat clear");
    });
    await runClientLeaf("combat clear", ["combat", "clear", "--type", "zombie", "--radius", "16", "--timeout", "25"], (data) => {
      expect(Number(data.killed) >= 1, "combat clear did not kill any zombie");
      expect(Number(data.remaining) === 0, "combat clear left zombies alive");
    });

    await resetFixture("setup reset before combat pickup");
    await runSetup("setup drop bread for combat pickup", ["inventory", "hotbar", "4"], (data) => {
      expect(data.item?.type === "minecraft:bread", "failed to select bread before combat pickup");
    });
    await runSetup("setup create pickup drops", ["inventory", "drop", "--all"], (data) => {
      expect(data.dropped === true, "failed to create dropped items for combat pickup");
    });
    await runClientLeaf("combat pickup", ["combat", "pickup", "--radius", "5", "--timeout", "10"], (data) => {
      expect(Array.isArray(data.picked), "combat pickup did not return picked items");
      expect(data.picked.some((item) => item.type === "minecraft:bread"), "combat pickup did not collect the dropped bread");
    });

    await resetFixture("setup reset before mount");
    await runClientLeaf("entity mount", ["entity", "mount", "--name", "MCT Mount"], (data) => {
      expect(data.success === true, "entity mount failed");
      expect(typeof data.vehicleId === "number", "entity mount did not return vehicle id");
    });

    await runClientLeaf("entity steer", ["entity", "steer", "--forward", "--jump"], (data) => {
      expect(typeof data.newPos?.x === "number", "entity steer did not return position");
    });

    await runClientLeaf("entity dismount", ["entity", "dismount"], (data) => {
      expect(data.success === true, "entity dismount failed");
    });

    await resetFixture("setup reset before trade");
    await runSetup("setup open villager trade", ["entity", "interact", "--name", "MCT Trader"], (data) => {
      expect(data.success === true, "failed to open villager trade");
    });

    await runClientLeaf("trade", ["trade", "--index", "0"], (data) => {
      expect(data.success === true, "trade failed");
      expect(data.result?.type === "minecraft:diamond", "trade result was not a diamond");
    });
    await closeGuiSetup("setup close trade gui");

    await resetFixture("setup reset before craft");
    await runSetup(
      "setup open crafting table",
      ["block", "interact", String(FIXTURE.craft.x), String(FIXTURE.craft.y), String(FIXTURE.craft.z)],
      (data) => {
        expect(data.success === true, "failed to open crafting table");
      }
    );
    await runSetup("setup wait craft gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "craft gui did not open");
    });

    await runClientLeaf(
      "craft",
      ["craft", "--recipe", '[[null,"diamond",null],[null,"stick",null],[null,"stick",null]]'],
      (data) => {
        expect(data.crafted === true, "craft command failed");
        expect(data.result?.type === "minecraft:diamond_shovel", "craft result was not a diamond shovel");
      }
    );
    await closeGuiSetup("setup close craft gui");

    await resetFixture("setup reset before anvil");
    await runSetup(
      "setup open anvil",
      ["block", "interact", String(FIXTURE.anvil.x), String(FIXTURE.anvil.y), String(FIXTURE.anvil.z)],
      (data) => {
        expect(data.success === true, "failed to open anvil");
      }
    );
    await runSetup("setup wait anvil gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "anvil gui did not open");
    });

    const anvilSnapshot = await runSetup("setup anvil snapshot for raw typing", ["gui", "snapshot"], (data) => {
      expect(Array.isArray(data.slots), "anvil snapshot slots missing");
    });
    const anvilSwordSlot = anvilSnapshot.slots.find((slot) => slot.item?.type === "minecraft:diamond_sword")?.slot;
    expect(Number.isInteger(anvilSwordSlot), "diamond sword slot not found in anvil gui");

    await runSetup("setup pick sword for raw typing", ["gui", "click", String(anvilSwordSlot), "--button", "left"], (data) => {
      expect(data.success === true, "failed to pick sword for raw typing");
    });
    await runSetup("setup place sword into anvil input", ["gui", "click", "0", "--button", "left"], (data) => {
      expect(data.success === true, "failed to place sword into anvil input");
    });

    await runClientLeaf("input type", ["input", "type", "RawName"], async (data) => {
      expect(data.typed === true, "input type did not report success");
      const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
      const preview = snapshot.slots.find((slot) => slot.slot === 2)?.item;
      expect(String(preview?.displayName ?? "").includes("RawName"), "input type did not update the anvil preview name");
    });

    await runClientLeaf("input key combo", ["input", "key", "combo", "backspace"], async (data) => {
      expect(data.pressed === true, "input key combo did not report success");
      const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
      const preview = snapshot.slots.find((slot) => slot.slot === 2)?.item;
      expect(String(preview?.displayName ?? "").includes("RawNam"), "input key combo did not update the anvil preview name");
      expect(!String(preview?.displayName ?? "").includes("RawName"), "input key combo did not remove the trailing character");
    });

    await closeGuiSetup("setup close anvil after raw typing");

    await resetFixture("setup reset before standard anvil");
    await runSetup(
      "setup reopen anvil",
      ["block", "interact", String(FIXTURE.anvil.x), String(FIXTURE.anvil.y), String(FIXTURE.anvil.z)],
      (data) => {
        expect(data.success === true, "failed to reopen anvil");
      }
    );
    await runSetup("setup wait reopened anvil gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "reopened anvil gui did not open");
    });

    await runClientLeaf("anvil", ["anvil", "--input-slot", "5", "--rename", "Renamed"], (data) => {
      expect(data.success === true, "anvil command failed");
      expect(String(data.result?.displayName).includes("Renamed"), "anvil did not rename the item");
    });
    await closeGuiSetup("setup close anvil gui");

    await resetFixture("setup reset before enchant");
    await prepareEnchantSetup();
    await runClientLeaf("enchant", ["enchant", "--option", "0"], (data) => {
      expect(data.success === true, "enchant command failed");
      expect(data.selectedOption === 0, "enchant command selected unexpected option");
    });
    await closeGuiSetup("setup close enchant gui");

    await runClientLeaf("chat command", ["chat", "command", "mcttp"], async (data) => {
      expect(data.sent === true, "chat command did not report sent");
      const teleported = await waitForTeleport(30);
      recordStep("chat command teleport confirm", teleported.cli, { kind: "verification", position: teleported.position });
    });

    const chatSendToken = `MCT_REAL_CHAT_SEND_${Date.now()}`;
    await runClientLeaf("chat send", ["chat", "send", chatSendToken], async (data) => {
      expect(data.sent === true, "chat send did not report sent");
      await waitForLogEntry(chatSendToken, 30);
    });

    await runClientLeaf("chat history", ["chat", "history", "--last", "10"], (data) => {
      expect(Array.isArray(data.messages), "chat history messages missing");
      expect(data.messages.some((message) => String(message.content ?? "").includes(chatSendToken)), "chat history missing sent token");
    });

    const chatLastToken = `MCT_REAL_CHAT_LAST_${Date.now()}`;
    await runSetup("setup chat last token", ["chat", "send", chatLastToken], async (data) => {
      expect(data.sent === true, "chat last setup send failed");
      await waitForLogEntry(chatLastToken, 30);
    });

    await runClientLeaf("chat last", ["chat", "last"], (data) => {
      expect(String(data.message?.content ?? "").includes(chatLastToken), "chat last did not return latest token");
    });

    const chatWaitToken = `MCT_REAL_CHAT_WAIT_${Date.now()}`;
    const scheduledChat = scheduleClientCommand(["chat", "send", chatWaitToken], 1000);
    await runClientLeaf("chat wait", ["chat", "wait", "--match", chatWaitToken, "--timeout", "7"], async (data) => {
      expect(data.matched === true, "chat wait did not match");
      expect(String(data.message?.content ?? "").includes(chatWaitToken), "chat wait returned unexpected message");
      unwrapRequestSuccess(await scheduledChat);
    });

    await restartEnvironmentWithResourcePack("setup restart before resourcepack reject");
    await runClientLeaf("resourcepack status", ["resourcepack", "status"], (data) => {
      expect(data.acceptanceStatus === "pending", "resourcepack status was not pending after request");
    });

    await runClientLeaf("resourcepack reject", ["resourcepack", "reject"], (data) => {
      expect(data.acceptanceStatus === "declined", "resourcepack reject did not decline the request");
    });

    await restartEnvironmentWithResourcePack("setup restart before resourcepack accept");
    await runClientLeaf("resourcepack status", ["resourcepack", "status"], (data) => {
      expect(data.acceptanceStatus === "pending", "resourcepack status was not pending before accept");
    });
    await runClientLeaf("resourcepack accept", ["resourcepack", "accept"], (data) => {
      expect(data.acceptanceStatus === "allowed", "resourcepack accept did not allow the request");
    });
    const reconnectCount = countOccurrences(await readClientLogText(), "Connecting to 127.0.0.1, 25565");
    await runClientLeaf("client reconnect", ["client", "reconnect"], (data) => {
      expect(data.connecting === true, "client reconnect did not start");
    });
    await waitForClientLogCountIncrease("Connecting to 127.0.0.1, 25565", reconnectCount, 30);
    const reconnectGui = await runCli(["--client", "real", "gui", "info"], { allowFailure: true });
    recordStep("client reconnect gui info", reconnectGui, {
      kind: "verification",
      verifiedData: reconnectGui.json?.data?.data ?? null
    });

    const finalDesktopShot = await takeDesktopScreenshot("client-after-full-real-test");
    summary.screenshots.push(finalDesktopShot);

    const missingRequestLeafCommands = supportMatrix.requestLeafCommands.filter(
      (leaf) => !coveredRequestLeafCommands.has(leaf)
    );
    assert.deepEqual(missingRequestLeafCommands, [], `Missing request leaf coverage: ${missingRequestLeafCommands.join(", ")}`);
    summary.supportMatrix.coveredRequestLeafCommands = [...coveredRequestLeafCommands].sort();
    summary.supportMatrix.coveredNonRequestLeafCommands = [...coveredNonRequestLeafCommands].sort();
    summary.supportMatrix.missingRequestLeafCommands = missingRequestLeafCommands;
  } finally {
    try {
      await updateServerProperties();
    } catch {}
    try {
      await resourcePackServer.close();
    } catch {}

    const cleanup = await stopEnvironment();
    await cleanupClientResidue(recordStep);
    coveredNonRequestLeafCommands.add("client stop");
    coveredNonRequestLeafCommands.add("server stop");
    recordStep("client stop", cleanup.clientStop, { leaf: "client stop", kind: "non_request" });
    recordStep("server stop", cleanup.serverStop, { leaf: "server stop", kind: "non_request" });
    summary.cleanup = {
      clientStop: {
        ok: cleanup.clientStop.ok,
        exitCode: cleanup.clientStop.exitCode,
        data: cleanup.clientStop.json?.data ?? cleanup.clientStop.json ?? null
      },
      serverStop: {
        ok: cleanup.serverStop.ok,
        exitCode: cleanup.serverStop.exitCode,
        data: cleanup.serverStop.json?.data ?? cleanup.serverStop.json ?? null
      }
    };
    summary.finishedAt = new Date().toISOString();
  }

  const reportPath = path.join(REPORT_DIR, "real-mod-full-test.latest.json");
  await writeFile(reportPath, `${JSON.stringify({ success: true, reportPath, summary }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ success: true, reportPath, summary }, null, 2)}\n`);
}

main().catch(async (error) => {
  const fallback = {
    success: false,
    error: error instanceof Error ? error.stack : String(error)
  };

  try {
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(
      path.join(REPORT_DIR, "real-mod-full-test.latest.json"),
      `${JSON.stringify(fallback, null, 2)}\n`,
      "utf8"
    );
  } catch {}

  process.stderr.write(`${JSON.stringify(fallback, null, 2)}\n`);
  process.exit(1);
});
