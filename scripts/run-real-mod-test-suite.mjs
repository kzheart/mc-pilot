#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const RUNNER_PATH = path.join(ROOT_DIR, "scripts", "real-mod-full-test.mjs");
const REPORT_DIR = path.join(ROOT_DIR, "tmp/real-e2e/reports");
const SUITE_REPORT_PATH = path.join(REPORT_DIR, "real-mod-test-suite.latest.json");
const SUITE_LOG_PATH = path.join(REPORT_DIR, "real-mod-test-suite.latest.log");
const INTER_GROUP_DELAY_MS = 6000;

function parseCliOptions(argv) {
  const selectedGroups = [];
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { selectedGroups };
}

async function runCommand(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: ROOT_DIR,
      maxBuffer: 32 * 1024 * 1024
    });
    return {
      ok: true,
      stdout,
      stderr
    };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        stdout: String(error.stdout ?? ""),
        stderr: String(error.stderr ?? "")
      };
    }
    throw error;
  }
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(SUITE_LOG_PATH, "", "utf8");

  const logLine = async (message) => {
    await appendFile(SUITE_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  };

  const listResult = await runCommand(process.execPath, [RUNNER_PATH, "--list-groups", "--json"]);
  const listed = parseJsonMaybe(listResult.stdout);
  const allGroups = listed?.groups ?? [];
  const selectedGroups = options.selectedGroups.length > 0 ? options.selectedGroups : allGroups.map((group) => group.id);
  const knownGroups = new Set(allGroups.map((group) => group.id));
  for (const group of selectedGroups) {
    assert.equal(knownGroups.has(group), true, `Unknown group: ${group}`);
  }

  const summary = {
    startedAt: new Date().toISOString(),
    logPath: SUITE_LOG_PATH,
    reportPath: SUITE_REPORT_PATH,
    selectedGroups,
    groups: []
  };

  const coveredRequestLeafCommands = new Set();
  const coveredNonRequestLeafCommands = new Set();
  let requestLeafCommands = [];
  let nonRequestLeafCommands = [];

  await logLine(`suite start groups=${selectedGroups.join(",")}`);

  for (const group of selectedGroups) {
    const startedAt = Date.now();
    await logLine(`group start id=${group}`);
    const runResult = await runCommand(process.execPath, [RUNNER_PATH, "--group", group], { allowFailure: true });
    const payload = parseJsonMaybe(runResult.stdout) ?? parseJsonMaybe(runResult.stderr);
    const groupRecord = {
      id: group,
      ok: runResult.ok && payload?.success === true,
      durationMs: Date.now() - startedAt,
      reportPath: payload?.reportPath ?? null,
      logPath: payload?.logPath ?? null,
      error: payload?.error ?? null
    };
    summary.groups.push(groupRecord);

    if (!groupRecord.ok) {
      await logLine(`group fail id=${group} error=${groupRecord.error ?? "unknown error"}`);
      const failure = {
        success: false,
        summary
      };
      await writeFile(SUITE_REPORT_PATH, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
      process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
      process.exit(1);
    }

    await logLine(`group pass id=${group} report=${groupRecord.reportPath}`);
    requestLeafCommands = payload.summary?.supportMatrix?.requestLeafCommands ?? requestLeafCommands;
    nonRequestLeafCommands = payload.summary?.supportMatrix?.nonRequestLeafCommands ?? nonRequestLeafCommands;
    for (const leaf of payload.summary?.supportMatrix?.coveredRequestLeafCommands ?? []) {
      coveredRequestLeafCommands.add(leaf);
    }
    for (const leaf of payload.summary?.supportMatrix?.coveredNonRequestLeafCommands ?? []) {
      coveredNonRequestLeafCommands.add(leaf);
    }

    if (group !== selectedGroups[selectedGroups.length - 1]) {
      await logLine(`group settle id=${group} delayMs=${INTER_GROUP_DELAY_MS}`);
      await sleep(INTER_GROUP_DELAY_MS);
    }
  }

  const missingRequestLeafCommands = requestLeafCommands.filter((leaf) => !coveredRequestLeafCommands.has(leaf));
  assert.deepEqual(missingRequestLeafCommands, [], `Missing request leaf coverage: ${missingRequestLeafCommands.join(", ")}`);

  summary.supportMatrix = {
    requestLeafCommands,
    nonRequestLeafCommands,
    coveredRequestLeafCommands: [...coveredRequestLeafCommands].sort(),
    coveredNonRequestLeafCommands: [...coveredNonRequestLeafCommands].sort(),
    missingRequestLeafCommands
  };
  summary.finishedAt = new Date().toISOString();

  await logLine(`suite pass groups=${selectedGroups.join(",")}`);
  const payload = {
    success: true,
    reportPath: SUITE_REPORT_PATH,
    logPath: SUITE_LOG_PATH,
    summary
  };
  await writeFile(SUITE_REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch(async (error) => {
  const payload = {
    success: false,
    reportPath: SUITE_REPORT_PATH,
    logPath: SUITE_LOG_PATH,
    error: error instanceof Error ? error.stack : String(error)
  };
  try {
    await mkdir(REPORT_DIR, { recursive: true });
    await appendFile(SUITE_LOG_PATH, `[${new Date().toISOString()}] suite fail error=${payload.error}\n`, "utf8");
    await writeFile(SUITE_REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {}
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});
