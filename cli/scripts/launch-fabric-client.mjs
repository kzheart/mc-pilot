#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_EXTRA_JVM_ARGS, createQuickPlayMultiplayer, launch as launchMinecraft } from "@xmcl/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VARIANTS_PATH = path.join(__dirname, "..", "data", "variants.json");
const DEFAULT_CLIENT_LANGUAGE = "zh_cn";

function readCatalog() {
  return JSON.parse(readFileSync(VARIANTS_PATH, "utf8"));
}

function getDefaultVariant() {
  const catalog = readCatalog();
  return catalog.variants.find((variant) => variant.id === catalog.defaultVariant);
}

function getVariantById(variantId) {
  const catalog = readCatalog();
  return catalog.variants.find((variant) => variant.id === variantId);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) {
      continue;
    }

    const key = entry.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function offlineUuid(username) {
  const source = Buffer.from(`OfflinePlayer:${username}`, "utf8");
  const digest = createHash("md5").update(source).digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mavenPath(coordinate) {
  const parts = coordinate.split(":");
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(`Unsupported Maven coordinate: ${coordinate}`);
  }

  const [group, artifact, version, classifier] = parts;
  const baseName = `${artifact}-${version}${classifier ? `-${classifier}` : ""}.jar`;
  return path.join(...group.split("."), artifact, version, baseName);
}

function isRuleMatch(ruleOs = {}) {
  const current = {
    name: "osx-arm64",
    arch: "arm64"
  };

  if (ruleOs.name && ruleOs.name !== "osx" && ruleOs.name !== current.name) {
    return false;
  }

  if (ruleOs.arch && ruleOs.arch !== current.arch) {
    return false;
  }

  return true;
}

function isAllowedByRules(rules) {
  if (!rules || rules.length === 0) {
    return true;
  }

  let allowed = false;
  for (const rule of rules) {
    if (!rule.os || isRuleMatch(rule.os)) {
      allowed = rule.action === "allow";
    }
  }

  return allowed;
}

function substitute(template, variables) {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => variables[key] ?? "");
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function getClientLanguage() {
  return process.env.MCT_CLIENT_LANGUAGE || DEFAULT_CLIENT_LANGUAGE;
}

function localeJavaArgs(language) {
  const [languageCode = "zh", countryCode] = String(language).replace("-", "_").split("_");
  return [
    `-Duser.language=${languageCode || "zh"}`,
    ...(countryCode ? [`-Duser.country=${countryCode.toUpperCase()}`] : [])
  ];
}

function normalizeLocaleJavaArgs(javaArgs, language) {
  return [
    ...javaArgs.filter((entry) => !entry.startsWith("-Duser.language=") && !entry.startsWith("-Duser.country=")),
    ...localeJavaArgs(language)
  ];
}

function xmclExtraJvmArgs(language, maxMemory) {
  const defaultArgs = maxMemory ? DEFAULT_EXTRA_JVM_ARGS.filter((entry) => entry !== "-Xmx2G") : DEFAULT_EXTRA_JVM_ARGS;
  return normalizeLocaleJavaArgs([...defaultArgs], language);
}

async function ensureFile(filePath, downloadUrl) {
  try {
    await access(filePath);
    return;
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download ${downloadUrl}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function getLocalBuildArtifactPath(repoRoot, variant) {
  const artifactName = `mct-client-mod-${variant.loader ?? "fabric"}-${variant.minecraftVersion}.jar`;
  const gradleModule = variant.gradleModule || `version-${variant.minecraftVersion}`;
  return {
    artifactName,
    sourceJar: path.join(repoRoot, "client-mod", gradleModule, "build", "libs", artifactName)
  };
}

async function syncBuiltMod(instanceRoot, repoRoot, variant) {
  const { artifactName, sourceJar } = getLocalBuildArtifactPath(repoRoot, variant);
  const targetDir = path.join(instanceRoot, "minecraft", "mods");
  const targetJar = path.join(targetDir, artifactName);

  try {
    await access(sourceJar);
  } catch {
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await copyFile(sourceJar, targetJar);
}

async function syncConfiguredMod(gameDir) {
  const configuredJar = process.env.MCT_CLIENT_MOD_JAR;
  if (!configuredJar) {
    return;
  }

  const sourceJar = path.isAbsolute(configuredJar) ? configuredJar : path.resolve(process.cwd(), configuredJar);
  const targetDir = path.join(gameDir, "mods");
  const targetJar = path.join(targetDir, path.basename(sourceJar));

  try {
    await access(sourceJar);
  } catch {
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await copyFile(sourceJar, targetJar);
}

async function ensureAutomationOptions(gameDir, server, mute, language = DEFAULT_CLIENT_LANGUAGE) {
  const optionsPath = path.join(gameDir, "options.txt");
  const values = new Map();

  try {
    const content = await readFile(optionsPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) {
        continue;
      }
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }
  } catch {}

  values.set("onboardAccessibility", "false");
  values.set("skipMultiplayerWarning", "true");
  values.set("skipRealms32bitWarning", "true");
  values.set("joinedFirstServer", "true");
  values.set("tutorialStep", "none");
  values.set("pauseOnLostFocus", "false");
  values.set("lang", language);
  if (mute !== undefined) {
    const volume = mute ? "0.0" : "1.0";
    for (const category of [
      "master",
      "music",
      "record",
      "weather",
      "block",
      "hostile",
      "neutral",
      "player",
      "ambient",
      "voice"
    ]) {
      values.set(`soundCategory_${category}`, volume);
    }
  }
  if (server) {
    values.set("lastServer", server);
  }

  const lines = [...values.entries()].map(([key, value]) => `${key}:${value}`);
  await mkdir(gameDir, { recursive: true });
  await writeFile(optionsPath, `${lines.join("\n")}\n`, "utf8");
}

async function buildLaunchSpec(options) {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const defaultVariant = getDefaultVariant();
  const minecraftVersion = process.env.MCT_CLIENT_VERSION || options["minecraft-version"] || defaultVariant.minecraftVersion;
  const modVariantId = process.env.MCT_CLIENT_MOD_VARIANT || options["mod-variant"] || `${minecraftVersion}-fabric`;
  const selectedVariant = getVariantById(modVariantId) ?? defaultVariant;
  const fabricLoaderVersion = options["fabric-loader-version"] || selectedVariant.fabricLoaderVersion || "0.16.14";
  const instanceRoot = options["instance-dir"];
  const metaRoot = options["meta-dir"];
  const librariesRoot = options["libraries-dir"];
  const assetsRoot = options["assets-dir"];
  const nativesDir = options["natives-dir"] || path.join(instanceRoot, "natives");
  const gameDir = path.join(instanceRoot, "minecraft");
  const packMeta = await readJson(path.join(instanceRoot, "mmc-pack.json"));
  const mute = parseOptionalBoolean(process.env.MCT_CLIENT_MUTE);
  const language = getClientLanguage();
  await syncBuiltMod(instanceRoot, repoRoot, selectedVariant);
  const componentMetas = new Map();
  for (const component of packMeta.components) {
    const componentMetaPath = path.join(metaRoot, component.uid, `${component.version}.json`);
    componentMetas.set(component.uid, await readJson(componentMetaPath));
  }

  const vanillaMeta = componentMetas.get("net.minecraft");
  const fabricMeta = componentMetas.get("net.fabricmc.fabric-loader");
  const intermediaryMeta = componentMetas.get("net.fabricmc.intermediary");

  const libraries = [];
  for (const component of packMeta.components) {
    const meta = componentMetas.get(component.uid);
    for (const library of meta.libraries ?? []) {
      if (!isAllowedByRules(library.rules)) {
        continue;
      }

      libraries.push({
        coordinate: library.name,
        path: library.downloads?.artifact?.path ?? mavenPath(library.name),
        url:
          library.downloads?.artifact?.url ??
          `${library.url.replace(/\/$/, "")}/${mavenPath(library.name)}`
      });
    }
  }

  const mainJarPath =
    vanillaMeta.mainJar?.downloads?.artifact?.path ??
    mavenPath(vanillaMeta.mainJar?.name ?? `com.mojang:minecraft:${minecraftVersion}:client`);
  const mainJarUrl = vanillaMeta.mainJar?.downloads?.artifact?.url;

  for (const entry of libraries) {
    if (entry.url) {
      await ensureFile(path.join(librariesRoot, entry.path), entry.url);
    }
  }

  if (mainJarUrl) {
    await ensureFile(path.join(librariesRoot, mainJarPath), mainJarUrl);
  }

  await mkdir(nativesDir, { recursive: true });

  const accountName = process.env.MCT_CLIENT_ACCOUNT || options.account || "TEST1";
  const accountUuid = offlineUuid(accountName);
  const server = process.env.MCT_CLIENT_SERVER || "";
  await ensureAutomationOptions(gameDir, server, mute, language);
  const [serverHost, serverPort = "25565"] = server.split(":");
  const classpath = [
    path.join(librariesRoot, mainJarPath),
    ...libraries.map((entry) => path.join(librariesRoot, entry.path))
  ].join(path.delimiter);
  const substitutions = {
    auth_player_name: accountName,
    version_name: `fabric-loader-${fabricLoaderVersion}-${minecraftVersion}`,
    game_directory: gameDir,
    assets_root: assetsRoot,
    assets_index_name: vanillaMeta.assetIndex.id,
    auth_uuid: accountUuid,
    auth_access_token: "0",
    user_type: "legacy",
    version_type: "release"
  };
  const gameArgs = vanillaMeta.minecraftArguments
    .split(" ")
    .filter(Boolean)
    .map((entry) => substitute(entry, substitutions));

  if (serverHost) {
    gameArgs.push("--quickPlayMultiplayer", `${serverHost}:${serverPort}`);
  }

  return {
    cwd: gameDir,
    classpathEntries: [path.join(librariesRoot, mainJarPath), ...libraries.map((entry) => path.join(librariesRoot, entry.path))],
    classpath,
    gameArgs,
    mainClass: fabricMeta.mainClass,
    nativesDir,
    javaBin: options.java || process.env.MCT_CLIENT_JAVA || "java",
    javaArgs: [
      "-XstartOnFirstThread",
      "-Xms512m",
      `-Xmx${options["max-mem"] || "1024m"}`,
      ...localeJavaArgs(language),
      `-Djava.library.path=${nativesDir}`,
      "-DFabricMcEmu=net.minecraft.client.main.Main"
    ]
  };
}

async function buildManifestLaunchSpec(options) {
  const manifestPath = options.manifest;
  if (!manifestPath) {
    throw new Error("Missing required argument: --manifest");
  }

  const manifest = await readJson(manifestPath);
  const gameDir = manifest.gameDir;
  const mute = parseOptionalBoolean(process.env.MCT_CLIENT_MUTE);
  const language = getClientLanguage();
  await syncConfiguredMod(gameDir);

  const accountName = process.env.MCT_CLIENT_ACCOUNT || options.account || "TEST1";
  const accountUuid = offlineUuid(accountName);
  const server = process.env.MCT_CLIENT_SERVER || "";
  await ensureAutomationOptions(gameDir, server, mute, language);
  const [serverHost, serverPort = "25565"] = server.split(":");
  const substitutions = {
    auth_player_name: accountName,
    version_name: `fabric-loader-${manifest.fabricLoaderVersion}-${manifest.minecraftVersion}`,
    game_directory: gameDir,
    assets_root: manifest.assetsDir,
    assets_index_name: manifest.assetsIndexId,
    auth_uuid: accountUuid,
    auth_access_token: "0",
    user_type: "legacy",
    version_type: "release",
    natives_directory: path.join(manifest.runtimeRootDir ?? path.dirname(manifestPath), "natives")
  };
  const gameArgs = manifest.gameArgs.map((entry) => substitute(entry, substitutions));
  if (serverHost && !gameArgs.includes("--quickPlayMultiplayer")) {
    gameArgs.push("--quickPlayMultiplayer", `${serverHost}:${serverPort}`);
  }

  const javaArgs = normalizeLocaleJavaArgs(manifest.javaArgs
    .map((entry) => substitute(entry, substitutions))
    .filter((entry) => !entry.includes("${")), language);

  return {
    cwd: gameDir,
    classpathEntries: manifest.classpathEntries,
    classpath: manifest.classpathEntries.join(path.delimiter),
    gameArgs,
    mainClass: manifest.mainClass,
    javaBin: options.java || process.env.MCT_CLIENT_JAVA || "java",
    javaArgs
  };
}

function parseMaxMemory(value) {
  if (!value) {
    return 1024;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized.endsWith("g")) {
    return Number.parseInt(normalized.slice(0, -1), 10) * 1024;
  }
  if (normalized.endsWith("m")) {
    return Number.parseInt(normalized.slice(0, -1), 10);
  }
  return Number.parseInt(normalized, 10);
}

async function launchXmclManagedClient(options) {
  const runtimeRoot = options["runtime-root"];
  const versionId = options["version-id"];
  const gameDir = options["game-dir"];

  if (!runtimeRoot || !versionId || !gameDir) {
    throw new Error("Missing required arguments: --runtime-root, --version-id and --game-dir");
  }

  await syncConfiguredMod(gameDir);

  const accountName = process.env.MCT_CLIENT_ACCOUNT || options.account || "TEST1";
  const accountUuid = offlineUuid(accountName).replaceAll("-", "");
  const server = process.env.MCT_CLIENT_SERVER || "";
  const mute = parseOptionalBoolean(process.env.MCT_CLIENT_MUTE);
  const language = getClientLanguage();
  await ensureAutomationOptions(gameDir, server, mute, language);
  const [serverHost, serverPort = "25565"] = server.split(":");
  const maxMemory = parseMaxMemory(options["max-mem"]);

  return launchMinecraft({
    gamePath: gameDir,
    resourcePath: runtimeRoot,
    javaPath: options.java || process.env.MCT_CLIENT_JAVA || "java",
    minMemory: 512,
    maxMemory,
    extraJVMArgs: xmclExtraJvmArgs(language, maxMemory),
    version: versionId,
    gameProfile: {
      name: accountName,
      id: accountUuid
    },
    accessToken: "0",
    userType: "legacy",
    launcherName: "mct",
    launcherBrand: "mct",
    ...(serverHost
      ? {
          quickPlayMultiplayer: createQuickPlayMultiplayer(serverHost, Number.parseInt(serverPort, 10)),
          // Legacy fallback for MC < 1.19.1 that ignores --quickPlayMultiplayer.
          // Don't pass both to 1.19.1+ to avoid "Attempt to connect while already connecting".
          extraMCArgs: versionId.startsWith("1.18.") || versionId.startsWith("1.12.")
            ? ["--server", serverHost, "--port", serverPort]
            : []
        }
      : {}),
    extraExecOption: {
      cwd: gameDir,
      env: {
        ...process.env
      },
      stdio: "inherit"
    }
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options["runtime-root"]) {
    const child = await launchXmclManagedClient(options);

    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });
    return;
  }

  const launch = options.manifest
    ? await buildManifestLaunchSpec(options)
    : await (async () => {
        const instanceDir = options["instance-dir"];
        const metaDir = options["meta-dir"];
        const librariesDir = options["libraries-dir"];
        const assetsDir = options["assets-dir"];
        if (!instanceDir || !metaDir || !librariesDir || !assetsDir) {
          throw new Error("Missing required arguments: --manifest or --instance-dir, --meta-dir, --libraries-dir and --assets-dir");
        }
        return buildLaunchSpec(options);
      })();
  console.log(`[mct-launch] mainClass=${launch.mainClass}`);
  console.log(`[mct-launch] classpathEntries=${launch.classpathEntries.length}`);
  console.log(
    `[mct-launch] lwjglCorePresent=${launch.classpathEntries.some((entry) => entry.endsWith(`${path.sep}org${path.sep}lwjgl${path.sep}lwjgl${path.sep}3.3.2${path.sep}lwjgl-3.3.2.jar`))}`
  );
  console.log(`[mct-launch] gameArgs=${launch.gameArgs.join(" ")}`);
  const child = spawn(
    launch.javaBin,
    [...launch.javaArgs, "-cp", launch.classpath, launch.mainClass, ...launch.gameArgs],
    {
      cwd: launch.cwd,
      env: {
        ...process.env
      },
      stdio: "inherit"
    }
  );

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
