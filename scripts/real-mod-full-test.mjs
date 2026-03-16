#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, appendFile, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildProgram } from "../cli/dist/index.js";
import { TEST_GROUPS } from "./real-mod-full-test/groups/index.mjs";

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
const LEGACY_REPORT_PATH = path.join(REPORT_DIR, "real-mod-full-test.latest.json");

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

function summarizeForLog(value, maxLength = 240) {
  if (value == null) {
    return "";
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function parseCliOptions(argv) {
  const selectedGroups = [];
  let listGroups = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--group") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --group");
      }
      selectedGroups.push(nextValue);
      index += 1;
      continue;
    }
    if (arg === "--list-groups") {
      listGroups = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const knownGroups = new Set(TEST_GROUPS.map((group) => group.id));
  for (const group of selectedGroups) {
    if (!knownGroups.has(group)) {
      throw new Error(`Unknown group: ${group}`);
    }
  }

  const effectiveGroups = selectedGroups.length > 0 ? selectedGroups : TEST_GROUPS.map((group) => group.id);
  const runLabel = effectiveGroups.length === TEST_GROUPS.length ? "all" : effectiveGroups.join("+");

  return {
    listGroups,
    json,
    selectedGroups: effectiveGroups,
    selectedGroupSet: new Set(effectiveGroups),
    runLabel,
    runSlug: slugify(runLabel) || "all"
  };
}

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
  const options = parseCliOptions(process.argv.slice(2));
  if (options.listGroups) {
    const payload = {
      groups: TEST_GROUPS,
      defaultGroups: TEST_GROUPS.map((group) => group.id)
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      for (const group of TEST_GROUPS) {
        process.stdout.write(`${group.id}\t${group.title}\n`);
      }
    }
    return;
  }

  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await ensureFileExists(RESOURCEPACK_PATH);
  await syncBuiltFixturePlugin();

  const runReportPath =
    options.runSlug === "all"
      ? LEGACY_REPORT_PATH
      : path.join(REPORT_DIR, `real-mod-full-test.${options.runSlug}.latest.json`);
  const runLogPath = path.join(REPORT_DIR, `real-mod-full-test.${options.runSlug}.latest.log`);
  await writeFile(runLogPath, "", "utf8");

  let logChain = Promise.resolve();
  const writeLogLine = (message) => {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    logChain = logChain.then(() => appendFile(runLogPath, line, "utf8"));
  };

  const summary = {
    startedAt: new Date().toISOString(),
    selectedGroups: options.selectedGroups,
    runLabel: options.runLabel,
    reportPath: runReportPath,
    logPath: runLogPath,
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    serverLogPath: SERVER_LOG_PATH,
    clientLogPath: CLIENT_LOG_PATH,
    screenshots: [],
    supportMatrix: null,
    groups: [],
    steps: [],
    cleanup: null
  };

  const supportMatrix = buildSupportMatrix();
  const coveredRequestLeafCommands = new Set();
  const coveredNonRequestLeafCommands = new Set();
  const resourcePackServer = await startResourcePackServer();
  await updateServerProperties();
  const state = {
    cachedEntityIds: {}
  };

  summary.supportMatrix = {
    requestLeafCommands: supportMatrix.requestLeafCommands,
    requestLeafCount: supportMatrix.requestLeafCommands.length,
    nonRequestLeafCommands: NON_REQUEST_LEAF_COMMANDS
  };

  writeLogLine(`run start groups=${options.selectedGroups.join(",")}`);

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
    writeLogLine(
      `step name=${name} kind=${extra.kind ?? "step"} ok=${result.ok} exit=${result.exitCode} durationMs=${result.durationMs} data=${summarizeForLog(extra.verifiedData ?? result.json?.data ?? result.json ?? null)}`
    );
  };

  async function runTestGroup(groupId, fn) {
    if (!options.selectedGroupSet.has(groupId)) {
      return;
    }

    const definition = TEST_GROUPS.find((group) => group.id === groupId);
    const record = {
      id: groupId,
      title: definition?.title ?? groupId,
      startedAt: new Date().toISOString(),
      status: "running"
    };
    summary.groups.push(record);
    writeLogLine(`group start id=${groupId} title=${record.title}`);
    const startedStepCount = summary.steps.length;

    try {
      await fn();
      record.status = "passed";
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.stack : String(error);
      writeLogLine(`group fail id=${groupId} error=${summarizeForLog(record.error, 400)}`);
      throw error;
    } finally {
      record.finishedAt = new Date().toISOString();
      record.stepCount = summary.steps.length - startedStepCount;
      writeLogLine(`group end id=${groupId} status=${record.status}`);
    }
  }

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

  const testContext = {
    FIXTURE,
    SCREENSHOT_DIR,
    approx,
    applyHudSetup,
    chestSlotPoint,
    closeGuiSetup,
    countOccurrences,
    ensureFileExists,
    expect,
    openChestSetup,
    path,
    pointNear,
    pollClientRequest,
    prepareEnchantSetup,
    readClientLogText,
    recordStep,
    resetFixture,
    restartEnvironmentWithResourcePack,
    runCli,
    runClientLeaf,
    runSetup,
    scheduleClientCommand,
    sleep,
    state,
    summary,
    takeDesktopScreenshot,
    unwrapRequestSuccess,
    waitForClientLogCountIncrease,
    waitForLogEntry,
    waitForTeleport
  };

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

    await launchRealClientAndWaitReady("initial");
    coveredNonRequestLeafCommands.add("client launch");
    coveredNonRequestLeafCommands.add("client wait-ready");

    await runNonRequestLeaf("client list", ["client", "list"], (data) => {
      expect(Array.isArray(data.clients), "client list did not return clients");
      expect(data.clients.some((client) => client.name === "real"), "client list missing real client");
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
    for (const group of TEST_GROUPS) {
      await runTestGroup(group.id, async () => {
        await group.run(testContext);
      });
    }

      const missingRequestLeafCommands = supportMatrix.requestLeafCommands.filter(
        (leaf) => !coveredRequestLeafCommands.has(leaf)
      );
      summary.supportMatrix.coveredRequestLeafCommands = [...coveredRequestLeafCommands].sort();
      summary.supportMatrix.coveredNonRequestLeafCommands = [...coveredNonRequestLeafCommands].sort();
      summary.supportMatrix.missingRequestLeafCommands = missingRequestLeafCommands;
      if (options.selectedGroups.length === TEST_GROUPS.length) {
        assert.deepEqual(missingRequestLeafCommands, [], `Missing request leaf coverage: ${missingRequestLeafCommands.join(", ")}`);
      }
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
    writeLogLine("run cleanup complete");
  }

  await logChain;
  const payload = { success: true, reportPath: runReportPath, logPath: runLogPath, summary };
  await writeFile(runReportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch(async (error) => {
  const options = parseCliOptions(process.argv.slice(2));
  const reportPath =
    options.runSlug === "all"
      ? LEGACY_REPORT_PATH
      : path.join(REPORT_DIR, `real-mod-full-test.${options.runSlug}.latest.json`);
  const logPath = path.join(REPORT_DIR, `real-mod-full-test.${options.runSlug}.latest.log`);
  const fallback = {
    success: false,
    reportPath,
    logPath,
    error: error instanceof Error ? error.stack : String(error)
  };

  try {
    await mkdir(REPORT_DIR, { recursive: true });
    await appendFile(logPath, `[${new Date().toISOString()}] run fail error=${summarizeForLog(fallback.error, 800)}\n`, "utf8");
    await writeFile(reportPath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
  } catch {}

  process.stderr.write(`${JSON.stringify(fallback, null, 2)}\n`);
  process.exit(1);
});
