#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getBuildableFabricVariants, loadModVariantCatalogSync } from "../cli/dist/download/ModVariantCatalog.js";
import { getMinecraftSupport, searchClientVersions } from "../cli/dist/download/VersionMatrix.js";
import {
  findDistinctPorts,
  parseCliOptions as parseSharedCliOptions,
  parseJsonMaybe,
  runCommand,
  runCommandWithRetry,
  sleep,
  slugifyProjectId,
} from "./lib.mjs";

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
const MACOS_JAVA_HOME = "/usr/libexec/java_home";

function parseCliOptions(argv) {
  const selectedGroups = [];
  const selectedVersions = [];

  parseSharedCliOptions(argv, {
    "--group": {
      apply: (value) => selectedGroups.push(value),
    },
    "--version": {
      apply: (value) => selectedVersions.push(value),
    },
  });

  return { selectedGroups, selectedVersions };
}

function resolveServerTarget(minecraftVersion, loader) {
  const client = searchClientVersions({ version: minecraftVersion, loader })[0];
  const verifiedPaper = client?.verifiedServers
    ?.filter((server) => server.type === "paper")
    .at(0);
  if (verifiedPaper) {
    return {
      serverType: verifiedPaper.type,
      serverVersion: verifiedPaper.minecraftVersion,
      serverBuild: verifiedPaper.build,
    };
  }

  const support = getMinecraftSupport(minecraftVersion);
  if (!support) {
    return null;
  }
  if (support.servers.paper.supported) {
    return { serverType: "paper", serverVersion: minecraftVersion };
  }
  if (support.servers.purpur.supported) {
    return { serverType: "purpur", serverVersion: minecraftVersion };
  }
  if (support.servers.spigot.supported) {
    return { serverType: "spigot", serverVersion: minecraftVersion };
  }
  if (support.servers.vanilla.supported) {
    return { serverType: "vanilla", serverVersion: minecraftVersion };
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

    const serverTarget = resolveServerTarget(
      variant.minecraftVersion,
      variant.loader || "fabric",
    );
    if (!serverTarget) {
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
      gradleBuild: variant.gradleBuild,
      gradleModule: variant.gradleModule,
      ...serverTarget,
    });
  }

  return { runnable, skipped };
}

function getVersionPaths(variantId, minecraftVersion, serverType) {
  const rootDir = path.join(MATRIX_ROOT, variantId);
  return {
    rootDir,
    projectDir: path.join(rootDir, "project"),
    mctHome: path.join(rootDir, "mct-home"),
    reportDir: path.join(rootDir, "reports"),
    screenshotDir: path.join(rootDir, "screenshots")
  };
}

function javaMajorForMinecraft(minecraftVersion) {
  const [major = "0", minor = "0"] = minecraftVersion.split(".");
  if (Number.parseInt(major, 10) >= 26) {
    return 25;
  }
  return Number.parseInt(minor, 10) >= 21 ? 21 : 17;
}

function resolveJavaCommand(minecraftVersion) {
  const envKey = `MCT_JAVA_${javaMajorForMinecraft(minecraftVersion)}`;
  if (process.env[envKey]) {
    return process.env[envKey];
  }

  if (process.platform === "darwin") {
    try {
      const javaHome = execFileSync(MACOS_JAVA_HOME, ["-v", String(javaMajorForMinecraft(minecraftVersion))], {
        encoding: "utf8"
      }).trim();
      if (javaHome) {
        return path.join(javaHome, "bin", "java");
      }
    } catch {}
  }

  return "java";
}

function appendJavaOption(args, minecraftVersion) {
  const javaCommand = resolveJavaCommand(minecraftVersion);
  if (javaCommand === "java") {
    return args;
  }
  return [...args, "--java", javaCommand];
}

async function prepareVersionEnvironment(entry, wsPort, serverPort, logLine) {
  const paths = getVersionPaths(entry.variantId, entry.minecraftVersion, entry.serverType);
  await rm(paths.rootDir, { recursive: true, force: true });
  await mkdir(paths.projectDir, { recursive: true });
  await mkdir(paths.mctHome, { recursive: true });
  await mkdir(paths.reportDir, { recursive: true });
  await mkdir(paths.screenshotDir, { recursive: true });
  const projectName = "real-e2e";
  const profileName = "default";
  const serverName = "server";
  const clientName = "real";
  const env = {
    ...process.env,
    MCT_HOME: paths.mctHome
  };

  await logLine(`variant build start variant=${entry.variantId}`);
  const gradleModule = entry.gradleModule || `version-${entry.minecraftVersion}`;
  const gradleDir = entry.gradleBuild
    ? path.join(CLIENT_MOD_DIR, entry.gradleBuild)
    : CLIENT_MOD_DIR;
  const javaCommand = resolveJavaCommand(entry.minecraftVersion);
  const javaHome = javaCommand === "java"
    ? null
    : path.dirname(path.dirname(javaCommand));
  const buildResult = await runCommand("./gradlew", [`:${gradleModule}:build`, "-q"], {
    cwd: gradleDir,
    env: javaHome
      ? {
          ...process.env,
          JAVA_HOME: javaHome,
          PATH: `${path.join(javaHome, "bin")}:${process.env.PATH || ""}`,
        }
      : process.env,
    allowFailure: true,
    timeoutMs: 120_000
  });
  if (!buildResult.ok) {
    throw new Error(`Failed to build ${entry.variantId}: ${buildResult.stderr || buildResult.stdout}`);
  }

  const artifactFileName = `mct-client-mod-${entry.loader || "fabric"}-${entry.minecraftVersion}.jar`;
  const buildArtifactPath = path.join(gradleDir, gradleModule, "build", "libs", artifactFileName);
  const cacheArtifactPath = path.join(GLOBAL_CACHE_DIR, "mod", artifactFileName);
  await mkdir(path.dirname(cacheArtifactPath), { recursive: true });
  await copyFile(buildArtifactPath, cacheArtifactPath);

  const initResult = await runCommandWithRetry(
    process.execPath,
    [
      CLI_PATH,
      "init",
      "--name",
      projectName
    ],
    {
      cwd: paths.projectDir,
      env,
      timeoutMs: 60_000
    }
  );
  const initPayload = parseJsonMaybe(initResult.stdout) ?? parseJsonMaybe(initResult.stderr);
  if (!initResult.ok || initPayload?.success !== true) {
    throw new Error(`Failed to initialize project for ${entry.variantId}: ${initResult.stderr || initResult.stdout}`);
  }

  await logLine(`server create start variant=${entry.variantId} provider=${entry.serverType} serverVersion=${entry.serverVersion}`);
  const serverCreateArgs = [
    CLI_PATH,
    "server",
    "create",
    serverName,
    "--type",
    entry.serverType,
    "--version",
    entry.serverVersion,
    "--port",
    String(serverPort),
    "--eula",
  ];
  if (entry.serverBuild != null) {
    serverCreateArgs.push("--build", String(entry.serverBuild));
  }
  const serverCreate = await runCommandWithRetry(
    process.execPath,
    appendJavaOption(serverCreateArgs, entry.serverVersion),
    {
      cwd: paths.projectDir,
      env,
      timeoutMs: 180_000
    }
  );
  const serverPayload = parseJsonMaybe(serverCreate.stdout) ?? parseJsonMaybe(serverCreate.stderr);
  if (!serverCreate.ok || serverPayload?.success !== true) {
    throw new Error(`Failed to create server for ${entry.variantId}: ${serverCreate.stderr || serverCreate.stdout}`);
  }

  await logLine(`client create start variant=${entry.variantId} wsPort=${wsPort}`);
  const clientCreate = await runCommandWithRetry(
    process.execPath,
    appendJavaOption([
      CLI_PATH,
      "client",
      "create",
      clientName,
      "--loader",
      entry.loader || "fabric",
      "--version",
      entry.minecraftVersion,
      "--ws-port",
      String(wsPort)
    ], entry.minecraftVersion),
    {
      cwd: paths.projectDir,
      env,
      timeoutMs: 300_000
    },
    { attempts: 2, delayMs: 5_000 }
  );
  const clientPayload = parseJsonMaybe(clientCreate.stdout) ?? parseJsonMaybe(clientCreate.stderr);
  if (!clientCreate.ok || clientPayload?.success !== true) {
    throw new Error(`Failed to create client for ${entry.variantId}: ${clientCreate.stderr || clientCreate.stdout}`);
  }

  const installedModPath = path.join(paths.mctHome, "clients", clientName, "minecraft", "mods", artifactFileName);
  await copyFile(buildArtifactPath, installedModPath);

  const projectId = initPayload?.data?.projectId ?? slugifyProjectId(paths.projectDir);
  const projectFilePath = path.join(paths.mctHome, "projects", projectId, "project.json");
  await writeFile(projectFilePath, `${JSON.stringify({
    projectId,
    rootDir: paths.projectDir,
    project: projectName,
    defaultProfile: profileName,
    profiles: {
      [profileName]: {
        server: serverName,
        clients: [clientName],
        deployPlugins: [FIXTURE_PLUGIN_JAR]
      }
    },
    screenshot: {
      outputDir: paths.screenshotDir
    },
    timeout: {
      serverReady: 120,
      clientReady: 180,
      default: 10
    }
  }, null, 2)}\n`);

  return {
    paths,
    projectId,
    wsPort,
    projectName,
    profileName,
    serverName,
    clientName,
    init: initPayload?.data ?? initPayload,
    serverCreate: serverPayload?.data ?? serverPayload,
    clientCreate: clientPayload?.data ?? clientPayload
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

  const fixtureBuild = await runCommand("gradle", ["build", "-q"], {
    cwd: path.join(ROOT_DIR, "paper-fixture"),
    env: {
      ...process.env,
      JAVA_HOME: path.dirname(path.dirname(resolveJavaCommand("1.18.2")))
    },
    allowFailure: true,
    timeoutMs: 120_000
  });
  if (!fixtureBuild.ok) {
    throw new Error(`Failed to build paper fixture: ${fixtureBuild.stderr || fixtureBuild.stdout}`);
  }

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
      const [wsPort, serverPort, resourcePackPort] = await findDistinctPorts(3);
      const environment = await prepareVersionEnvironment(entry, wsPort, serverPort, logLine);
      versionRecord.prepare = {
        wsPort: environment.wsPort,
        serverPort,
        resourcePackPort,
        projectDir: environment.paths.projectDir,
        mctHome: environment.paths.mctHome,
        init: environment.init,
        serverCreate: environment.serverCreate,
        clientCreate: environment.clientCreate
      };

      const runnerArgs = [RUNNER_PATH];
      for (const group of selectedGroups) {
        runnerArgs.push("--group", group);
      }
      runnerArgs.push(
        "--project-dir",
        environment.paths.projectDir,
        "--mct-home",
        environment.paths.mctHome,
        "--report-dir",
        environment.paths.reportDir,
        "--screenshot-dir",
        environment.paths.screenshotDir,
        "--run-label",
        entry.variantId
      );

      const runResult = await runCommand(process.execPath, runnerArgs, {
        allowFailure: true,
        env: {
          ...process.env,
          MCT_REAL_RESOURCEPACK_PORT: String(resourcePackPort)
        }
      });
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

  summary.supportMatrix = {
    requestLeafCommands,
    nonRequestLeafCommands,
    coveredRequestLeafCommands: [...coveredRequestLeafCommands].sort(),
    coveredNonRequestLeafCommands: [...coveredNonRequestLeafCommands].sort(),
    missingRequestLeafCommands,
    fullSuite: isFullSuite
  };
  summary.finishedAt = new Date().toISOString();

  const failedVersions = summary.versions.filter((version) => !version.ok);
  const success = failedVersions.length === 0;
  if (success) {
    await logLine(`suite pass groups=${selectedGroups.join(",")} variants=${summary.selectedVersions.join(",")}`);
  } else {
    await logLine(`suite fail failedVariants=${failedVersions.map((version) => version.variantId).join(",")}`);
  }
  const payload = {
    success,
    reportPath: SUITE_REPORT_PATH,
    logPath: SUITE_LOG_PATH,
    summary
  };
  await writeFile(SUITE_REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const output = `${JSON.stringify(payload, null, 2)}\n`;
  if (success) {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
  process.exit(1);
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
