#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getBuildableFabricVariants, loadModVariantCatalogSync } from "../cli/dist/download/ModVariantCatalog.js";
import { getMinecraftSupport } from "../cli/dist/download/VersionMatrix.js";

const DEFAULT_WS_PORT_BASE = 25580;

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const CLI_PATH = path.join(ROOT_DIR, "cli", "dist", "index.js");
const RUNNER_PATH = path.join(ROOT_DIR, "scripts", "real-mod-full-test.mjs");
const CLIENT_MOD_DIR = path.join(ROOT_DIR, "client-mod");
const MATRIX_ROOT = path.join(ROOT_DIR, "tmp", "real-e2e", "matrix");
const REPORT_DIR = path.join(ROOT_DIR, "tmp", "real-e2e", "reports");
// Shared cache dir: use CLI's cache hierarchy
const GLOBAL_CACHE_DIR = process.env.MCT_CACHE_DIR || path.join(process.env.HOME, ".mct", "cache");
const SHARED_SERVERS_DIR = path.join(GLOBAL_CACHE_DIR, "server");
const FIXTURE_PLUGIN_JAR = path.join(ROOT_DIR, "paper-fixture", "build", "libs", "mct-paper-fixture-0.1.0.jar");
const SUITE_REPORT_PATH = path.join(REPORT_DIR, "real-mod-test-suite.latest.json");
const SUITE_LOG_PATH = path.join(REPORT_DIR, "real-mod-test-suite.latest.log");
const INTER_VERSION_DELAY_MS = 6000;

function parseCliOptions(argv) {
  const selectedGroups = [];
  const selectedVersions = [];

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
    if (arg === "--version") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --version");
      }
      selectedVersions.push(nextValue);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { selectedGroups, selectedVersions };
}

async function runCommand(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd ?? ROOT_DIR,
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

async function runCommandWithRetry(command, args, options = {}, retryOptions = {}) {
  const attempts = retryOptions.attempts ?? 3;
  const delayMs = retryOptions.delayMs ?? 2_000;
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runCommand(command, args, {
      ...options,
      allowFailure: true
    });
    lastResult = result;
    if (result.ok) {
      return result;
    }
    if (attempt < attempts) {
      await sleep(delayMs * attempt);
    }
  }

  return lastResult;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function resolveServerType(minecraftVersion) {
  const support = getMinecraftSupport(minecraftVersion);
  if (!support) {
    return null;
  }
  if (support.servers.paper.supported) {
    return "paper";
  }
  if (support.servers.purpur.supported) {
    return "purpur";
  }
  if (support.servers.spigot.supported) {
    return "spigot";
  }
  if (support.servers.vanilla.supported) {
    return "vanilla";
  }
  return null;
}

function resolveVersionMatrix(selectedVersions) {
  const catalog = loadModVariantCatalogSync();
  const buildableVariants = getBuildableFabricVariants(catalog);
  const requestedVersions = new Set(selectedVersions);
  const runnable = [];
  const skipped = [];

  for (const variant of buildableVariants) {
    if (requestedVersions.size > 0 && !requestedVersions.has(variant.minecraftVersion) && !requestedVersions.has(variant.id)) {
      continue;
    }

    const serverType = resolveServerType(variant.minecraftVersion);
    if (!serverType) {
      skipped.push({
        variantId: variant.id,
        minecraftVersion: variant.minecraftVersion,
        reason: "missing_downloadable_server_provider"
      });
      continue;
    }

    runnable.push({
      variantId: variant.id,
      minecraftVersion: variant.minecraftVersion,
      loader: variant.loader || "fabric",
      serverType
    });
  }

  return { runnable, skipped };
}

function getVersionPaths(variantId, minecraftVersion, serverType) {
  const rootDir = path.join(MATRIX_ROOT, variantId);
  return {
    rootDir,
    configPath: path.join(rootDir, "mct.config.json"),
    stateDir: path.join(rootDir, "state"),
    reportDir: path.join(rootDir, "reports"),
    screenshotDir: path.join(rootDir, "screenshots"),
    // Server: cached globally by type+version (same server jar for all runs)
    serverDir: path.join(SHARED_SERVERS_DIR, `${serverType ?? "vanilla"}`, minecraftVersion ?? variantId),
    // Client runtime: cached globally per MC version (libraries, assets, version JARs).
    // The mod JAR is always freshly copied in from the local build artifact.
    clientDir: path.join(GLOBAL_CACHE_DIR, "client", "runtime", minecraftVersion ?? variantId)
  };
}

async function prepareVersionEnvironment(entry, wsPort, logLine) {
  const paths = getVersionPaths(entry.variantId, entry.minecraftVersion, entry.serverType);
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.reportDir, { recursive: true });
  await mkdir(paths.screenshotDir, { recursive: true });
  await mkdir(paths.serverDir, { recursive: true });
  await mkdir(paths.clientDir, { recursive: true });

  await logLine(`variant build start variant=${entry.variantId}`);
  const gradleModule = `version-${entry.minecraftVersion}`;
  const buildResult = await runCommand("./gradlew", [`:${gradleModule}:build`, "-q"], {
    cwd: CLIENT_MOD_DIR,
    allowFailure: true
  });
  if (!buildResult.ok) {
    throw new Error(`Failed to build ${entry.variantId}: ${buildResult.stderr || buildResult.stdout}`);
  }

  await logLine(`server download start variant=${entry.variantId} provider=${entry.serverType}`);
  const serverDownload = await runCommandWithRetry(
    process.execPath,
    [
      CLI_PATH,
      "--config",
      paths.configPath,
      "--state-dir",
      paths.stateDir,
      "server",
      "download",
      "--type",
      entry.serverType,
      "--version",
      entry.minecraftVersion,
      "--dir",
      paths.serverDir,
      ...(entry.serverType !== "vanilla" ? ["--fixtures", FIXTURE_PLUGIN_JAR] : [])
    ]
  );
  const serverPayload = parseJsonMaybe(serverDownload.stdout) ?? parseJsonMaybe(serverDownload.stderr);
  if (!serverDownload.ok || serverPayload?.success !== true) {
    throw new Error(`Failed to download server for ${entry.variantId}: ${serverDownload.stderr || serverDownload.stdout}`);
  }

  await logLine(`client download start variant=${entry.variantId} wsPort=${wsPort}`);
  const clientDownload = await runCommandWithRetry(
    process.execPath,
    [
      CLI_PATH,
      "--config",
      paths.configPath,
      "--state-dir",
      paths.stateDir,
      "client",
      "download",
      "--loader",
      entry.loader || "fabric",
      "--version",
      entry.minecraftVersion,
      "--dir",
      paths.clientDir,
      "--name",
      "real",
      "--ws-port",
      String(wsPort),
      "--server",
      "127.0.0.1:25565"
    ]
  );
  const clientPayload = parseJsonMaybe(clientDownload.stdout) ?? parseJsonMaybe(clientDownload.stderr);
  if (!clientDownload.ok || clientPayload?.success !== true) {
    throw new Error(`Failed to download client for ${entry.variantId}: ${clientDownload.stderr || clientDownload.stdout}`);
  }

  return {
    paths,
    wsPort,
    build: {
      ok: true
    },
    serverDownload: serverPayload?.data ?? serverPayload,
    clientDownload: clientPayload?.data ?? clientPayload
  };
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

  const matrix = resolveVersionMatrix(options.selectedVersions);
  assert.notEqual(matrix.runnable.length, 0, "No runnable multi-version E2E targets were resolved");

  const summary = {
    startedAt: new Date().toISOString(),
    logPath: SUITE_LOG_PATH,
    reportPath: SUITE_REPORT_PATH,
    selectedGroups,
    selectedVersions: matrix.runnable.map((entry) => entry.variantId),
    skippedVersions: matrix.skipped,
    versions: []
  };

  const coveredRequestLeafCommands = new Set();
  const coveredNonRequestLeafCommands = new Set();
  let requestLeafCommands = [];
  let nonRequestLeafCommands = [];

  await logLine(`suite start groups=${selectedGroups.join(",")} variants=${summary.selectedVersions.join(",")}`);

  for (const [index, entry] of matrix.runnable.entries()) {
    const startedAt = Date.now();
    const versionRecord = {
      variantId: entry.variantId,
      minecraftVersion: entry.minecraftVersion,
      serverType: entry.serverType,
      ok: false,
      durationMs: 0,
      reportPath: null,
      logPath: null,
      error: null
    };
    summary.versions.push(versionRecord);

    try {
      await logLine(`variant start variant=${entry.variantId}`);
      const environment = await prepareVersionEnvironment(entry, DEFAULT_WS_PORT_BASE + index, logLine);
      versionRecord.prepare = {
        wsPort: environment.wsPort,
        configPath: environment.paths.configPath,
        stateDir: environment.paths.stateDir,
        serverDownload: environment.serverDownload,
        clientDownload: environment.clientDownload
      };

      const runnerArgs = [RUNNER_PATH];
      for (const group of selectedGroups) {
        runnerArgs.push("--group", group);
      }
      runnerArgs.push(
        "--config",
        environment.paths.configPath,
        "--state-dir",
        environment.paths.stateDir,
        "--report-dir",
        environment.paths.reportDir,
        "--screenshot-dir",
        environment.paths.screenshotDir,
        "--run-label",
        entry.variantId
      );

      const runResult = await runCommand(process.execPath, runnerArgs, { allowFailure: true });
      const payload = parseJsonMaybe(runResult.stdout) ?? parseJsonMaybe(runResult.stderr);
      versionRecord.ok = runResult.ok && payload?.success === true;
      versionRecord.durationMs = Date.now() - startedAt;
      versionRecord.reportPath = payload?.reportPath ?? null;
      versionRecord.logPath = payload?.logPath ?? null;
      versionRecord.error = payload?.error ?? null;

      if (!versionRecord.ok) {
        versionRecord.error = versionRecord.error ?? `Unknown run failure for ${entry.variantId}`;
        await logLine(`variant fail variant=${entry.variantId} error=${versionRecord.error}`);
      } else {
        requestLeafCommands = payload.summary?.supportMatrix?.requestLeafCommands ?? requestLeafCommands;
        nonRequestLeafCommands = payload.summary?.supportMatrix?.nonRequestLeafCommands ?? nonRequestLeafCommands;
        for (const leaf of payload.summary?.supportMatrix?.coveredRequestLeafCommands ?? []) {
          coveredRequestLeafCommands.add(leaf);
        }
        for (const leaf of payload.summary?.supportMatrix?.coveredNonRequestLeafCommands ?? []) {
          coveredNonRequestLeafCommands.add(leaf);
        }
        versionRecord.groups = payload.summary?.groups ?? [];
        await logLine(`variant pass variant=${entry.variantId} report=${versionRecord.reportPath}`);
      }
    } catch (error) {
      versionRecord.durationMs = Date.now() - startedAt;
      versionRecord.error = error instanceof Error ? error.stack : String(error);
      await logLine(`variant fail variant=${entry.variantId} error=${versionRecord.error}`);
      const failure = {
        success: false,
        summary
      };
      await writeFile(SUITE_REPORT_PATH, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
      // continue to next version instead of exiting
    }

    if (entry !== matrix.runnable[matrix.runnable.length - 1]) {
      await logLine(`variant settle variant=${entry.variantId} delayMs=${INTER_VERSION_DELAY_MS}`);
      await sleep(INTER_VERSION_DELAY_MS);
    }
  }

  const missingRequestLeafCommands = requestLeafCommands.filter((leaf) => !coveredRequestLeafCommands.has(leaf));
  const isFullSuite = selectedGroups.length === allGroups.length;
  if (isFullSuite) {
    assert.deepEqual(missingRequestLeafCommands, [], `Missing request leaf coverage: ${missingRequestLeafCommands.join(", ")}`);
  }

  summary.supportMatrix = {
    requestLeafCommands,
    nonRequestLeafCommands,
    coveredRequestLeafCommands: [...coveredRequestLeafCommands].sort(),
    coveredNonRequestLeafCommands: [...coveredNonRequestLeafCommands].sort(),
    missingRequestLeafCommands,
    fullSuite: isFullSuite
  };
  summary.finishedAt = new Date().toISOString();

  await logLine(`suite pass groups=${selectedGroups.join(",")} variants=${summary.selectedVersions.join(",")}`);
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
