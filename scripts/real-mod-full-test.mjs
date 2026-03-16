#!/usr/bin/env node

import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
const MOD_SOURCE_PATH = path.join(
  ROOT_DIR,
  "client-mod/src/client/java/com/mct/core/util/ClientActionExecutor.java"
);

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

const REAL_SUPPORTED_ACTIONS = ["chat.command", "chat.send", "position.get", "wait.perform"];
const REAL_SUPPORTED_LEAF_COMMANDS = ["chat command", "chat send", "position get", "wait"];

function collectLeafCommands(command, parents = []) {
  if (command.commands.length === 0) {
    return [parents.join(" ")];
  }

  return command.commands.flatMap((child) => collectLeafCommands(child, [...parents, child.name()]));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
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
  return runCommand(process.execPath, [path.join(ROOT_DIR, "cli/dist/index.js"), "--config", CONFIG_PATH, "--state-dir", STATE_DIR, ...args], options);
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
    Math.abs(Number(position.x) - 12.5) < 0.05 &&
    Math.abs(Number(position.y) - 80) < 0.05 &&
    Math.abs(Number(position.z) - 34.5) < 0.05 &&
    position.onGround === true
  );
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
    await sleep(1000);
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

    await sleep(1000);
  }

  throw new Error(`Teleport position was not reached within ${timeoutSeconds}s: ${JSON.stringify(latestPosition)}`);
}

async function takeScreenshot(name) {
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

async function stopEnvironment() {
  const clientStop = await runCli(["client", "stop", "real"], { allowFailure: true });
  const serverStop = await runCli(["server", "stop"], { allowFailure: true });
  return {
    clientStop,
    serverStop
  };
}

async function buildSupportMatrix() {
  const source = await readFile(MOD_SOURCE_PATH, "utf8");
  const sourceActions = [...source.matchAll(/case "([^"]+)"/g)].map((match) => match[1]).sort();
  const leafCommands = collectLeafCommands(buildProgram()).sort();
  const requestLeafCommands = leafCommands.filter((entry) => !NON_REQUEST_LEAF_COMMANDS.includes(entry));
  const unsupportedRequestLeafCommands = requestLeafCommands.filter(
    (entry) => !REAL_SUPPORTED_LEAF_COMMANDS.includes(entry)
  );

  return {
    sourceActions,
    leafCommands,
    requestLeafCommands,
    supportedLeafCommands: REAL_SUPPORTED_LEAF_COMMANDS,
    unsupportedRequestLeafCommands
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const summary = {
    startedAt: new Date().toISOString(),
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    serverLogPath: SERVER_LOG_PATH,
    clientLogPath: CLIENT_LOG_PATH,
    supportMatrix: null,
    screenshots: [],
    steps: [],
    cleanup: null
  };

  const supportMatrix = await buildSupportMatrix();
  assert.deepEqual(supportMatrix.sourceActions, [...REAL_SUPPORTED_ACTIONS].sort());
  summary.supportMatrix = {
    supportedActions: supportMatrix.sourceActions,
    supportedLeafCommands: supportMatrix.supportedLeafCommands,
    unsupportedRequestLeafCommands: supportMatrix.unsupportedRequestLeafCommands,
    unsupportedRequestCount: supportMatrix.unsupportedRequestLeafCommands.length
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

  try {
    const initialCleanup = await stopEnvironment();
    recordStep("cleanup-before-client-stop", initialCleanup.clientStop);
    recordStep("cleanup-before-server-stop", initialCleanup.serverStop);

    const serverStart = await runCli(["server", "start", "--eula"]);
    recordStep("server-start", serverStart);
    assert.equal(unwrapCliSuccess(serverStart).running, true);

    const serverReady = await runCli(["server", "wait-ready", "--timeout", "120"]);
    recordStep("server-wait-ready", serverReady);
    assert.equal(unwrapCliSuccess(serverReady).reachable, true);

    const clientLaunch = await runCli(["client", "launch", "real"]);
    recordStep("client-launch", clientLaunch);
    assert.equal(unwrapCliSuccess(clientLaunch).name, "real");

    const clientReady = await runCli(["client", "wait-ready", "real", "--timeout", "180"]);
    recordStep("client-wait-ready", clientReady);
    assert.equal(unwrapCliSuccess(clientReady).connected, true);

    const inWorld = await waitForInWorld(180);
    recordStep("position-get-in-world", inWorld.cli, { position: inWorld.position });

    const readyScreenshot = await takeScreenshot("client-in-world");
    summary.screenshots.push(readyScreenshot);

    const chatSend = await runCli(["--client", "real", "chat", "send", "MCT_REAL_CHAT_OK"]);
    recordStep("chat-send", chatSend);
    assert.equal(unwrapRequestSuccess(chatSend).sent, true);
    await waitForLogEntry("MCT_REAL_CHAT_OK", 30);

    const chatCommand = await runCli(["--client", "real", "chat", "command", "mcttp"]);
    recordStep("chat-command", chatCommand);
    assert.equal(unwrapRequestSuccess(chatCommand).sent, true);

    const teleported = await waitForTeleport(30);
    recordStep("position-get-after-mcttp", teleported.cli, { position: teleported.position });

    const waitStarted = Date.now();
    const waitResult = await runCli(["--client", "real", "wait", "1", "--timeout", "3"]);
    const waitElapsedMs = Date.now() - waitStarted;
    recordStep("wait-perform", waitResult, { elapsedMs: waitElapsedMs });
    assert.equal(unwrapRequestSuccess(waitResult).waited, 1);
    assert.ok(waitElapsedMs >= 900, `wait 1 finished too quickly: ${waitElapsedMs}ms`);

    const teleportedScreenshot = await takeScreenshot("client-after-mcttp");
    summary.screenshots.push(teleportedScreenshot);
  } finally {
    const cleanup = await stopEnvironment();
    recordStep("cleanup-after-client-stop", cleanup.clientStop);
    recordStep("cleanup-after-server-stop", cleanup.serverStop);
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
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
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
