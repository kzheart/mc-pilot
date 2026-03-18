#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createQuickPlayMultiplayer, launch as launchMinecraft, LaunchPrecheck, MinecraftFolder, Version } from "@xmcl/core";

import { getDefaultVariant, getVariantById } from "./mod-variant.mjs";

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

async function syncBuiltMod(instanceRoot, repoRoot, variantId) {
  const artifactName = `mct-client-mod-${variantId.endsWith("-fabric") ? "fabric" : variantId.split("-").pop()}-${variantId.replace(/-fabric$|-forge$|-neoforge$/, "")}.jar`;
  const sourceJar = path.join(repoRoot, "client-mod", "versions", variantId, "build", "libs", artifactName);
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

async function ensureAutomationOptions(gameDir, server) {
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
  if (server) {
    values.set("lastServer", server);
  }

  const lines = [...values.entries()].map(([key, value]) => `${key}:${value}`);
  await mkdir(gameDir, { recursive: true });
  await writeFile(optionsPath, `${lines.join("\n")}\n`, "utf8");
}

async function buildLaunchSpec(options) {
  const repoRoot = process.cwd();
  const defaultVariant = getDefaultVariant();
  const minecraftVersion = process.env.MCT_CLIENT_VERSION || options["minecraft-version"] || defaultVariant.minecraftVersion;
  const modVariantId = process.env.MCT_CLIENT_MOD_VARIANT || options["mod-variant"] || `${minecraftVersion}-fabric`;
  const selectedVariant = getVariantById(modVariantId) ?? defaultVariant;
  const fabricLoaderVersion = options["fabric-loader-version"] || selectedVariant.fabricLoaderVersion || "0.16.10";
  const instanceRoot = options["instance-dir"];
  const metaRoot = options["meta-dir"];
  const librariesRoot = options["libraries-dir"];
  const assetsRoot = options["assets-dir"];
  const nativesDir = options["natives-dir"] || path.join(instanceRoot, "natives");
  const gameDir = path.join(instanceRoot, "minecraft");
  const packMeta = await readJson(path.join(instanceRoot, "mmc-pack.json"));
  await syncBuiltMod(instanceRoot, repoRoot, modVariantId);
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
  await ensureAutomationOptions(gameDir, server);
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
      "-Duser.language=en",
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
  await syncConfiguredMod(gameDir);

  const accountName = process.env.MCT_CLIENT_ACCOUNT || options.account || "TEST1";
  const accountUuid = offlineUuid(accountName);
  const server = process.env.MCT_CLIENT_SERVER || "";
  await ensureAutomationOptions(gameDir, server);
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

  const javaArgs = manifest.javaArgs
    .map((entry) => substitute(entry, substitutions))
    .filter((entry) => !entry.includes("${"));

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

// LWJGL arm64 patch for old MC versions (shipped x86-only LWJGL 3.2.x).
// Based on HMCL's NativePatcher approach: replace LWJGL 3.2.x with 3.3.1 arm64 builds.
// lwjgl-glfw Java JAR uses a community patch (org.glavo.hmcl.mmachina) for macOS arm64 compat.
// See: https://github.com/HMCL-dev/HMCL (HMCL/src/main/java/org/jackhuang/hmcl/util/NativePatcher.java)
const LWJGL_ARM64_PATCH = {
  patchVersion: "3.3.1",
  // Java JARs (classpath entries) — sha1 left empty to skip strict validation
  jars: {
    "org.lwjgl:lwjgl": { path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-jemalloc": { path: "org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-openal": { path: "org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-opengl": { path: "org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-stb": { path: "org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-tinyfd": { path: "org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar", sha1: "", size: 0 },
    // glfw uses community patch jar for arm64 compat (same as HMCL)
    "org.lwjgl:lwjgl-glfw": { path: "org/glavo/hmcl/mmachina/lwjgl-glfw/3.3.1-mmachina.1/lwjgl-glfw-3.3.1-mmachina.1.jar", url: "https://repo1.maven.org/maven2/org/glavo/hmcl/mmachina/lwjgl-glfw/3.3.1-mmachina.1/lwjgl-glfw-3.3.1-mmachina.1.jar", sha1: "", size: 0 }
  },
  // Native JARs — sha1 empty to skip validation
  natives: {
    "org.lwjgl:lwjgl": { path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-jemalloc": { path: "org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-openal": { path: "org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-opengl": { path: "org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-stb": { path: "org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-tinyfd": { path: "org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 },
    "org.lwjgl:lwjgl-glfw": { path: "org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-macos-arm64.jar", sha1: "", size: 0 }
  }
};

async function ensureArm64Natives(runtimeRoot, versionId) {
  if (os.arch() !== "arm64" || os.platform() !== "darwin") {
    return null;
  }

  const mc = MinecraftFolder.from(runtimeRoot);
  const nativesDir = mc.getNativesRoot(versionId);
  const nativesMarker = path.join(nativesDir, ".arm64-patched");

  // Check if the version JSON needs patch (look for old x86 LWJGL in raw JSON)
  let targetJsonPath = mc.getVersionJson(versionId);
  let needsJsonPatch = false;
  for (let depth = 0; depth < 5; depth++) {
    const raw = await readFile(targetJsonPath, "utf-8").catch(() => null);
    if (!raw) { break; }
    const json2 = JSON.parse(raw);
    if ((json2.libraries || []).some((lib) => lib.name?.startsWith("org.lwjgl:lwjgl:3.2"))) {
      needsJsonPatch = true;
      break;
    }
    if ((json2.libraries || []).some((lib) => lib.name?.startsWith("org.lwjgl:lwjgl:3.3"))) {
      break; // already patched
    }
    if (!json2.inheritsFrom) { break; }
    targetJsonPath = mc.getVersionJson(json2.inheritsFrom);
  }

  if (!needsJsonPatch) {
    // No old LWJGL detected — this version already has arm64 native support, no patch needed
    return null;
  }

  console.log("[MCT] Applying LWJGL 3.3.1 arm64 patch (based on HMCL NativePatcher)...");

  const { open, walkEntriesGenerator, openEntryReadStream } = await import("@xmcl/unzip");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream");
  const { promisify } = await import("node:util");
  const pipelineAsync = promisify(pipeline);

  async function downloadJar(entry) {
    const localPath = mc.getLibraryByPath(entry.path);
    try {
      await access(localPath);
      return localPath;
    } catch {
      console.log(`[MCT]   Downloading ${path.basename(entry.path)}...`);
      const response = await fetch(entry.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${entry.url}`);
      }
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
      return localPath;
    }
  }

  // 1. Download and extract arm64 natives into nativesDir
  await mkdir(nativesDir, { recursive: true });
  for (const [libKey, entry] of Object.entries(LWJGL_ARM64_PATCH.natives)) {
    const localJar = await downloadJar(entry).catch((e) => { console.log(`[MCT]   Skip ${libKey}: ${e.message}`); return null; });
    if (!localJar) { continue; }
    const zip = await open(localJar, { lazyEntries: true, autoClose: false });
    for await (const zipEntry of walkEntriesGenerator(zip)) {
      const name = zipEntry.fileName;
      if (!name.endsWith(".dylib") || name.endsWith("/")) { continue; }
      const dest = path.join(nativesDir, path.basename(name));
      await pipelineAsync(await openEntryReadStream(zip, zipEntry), createWriteStream(dest));
    }
  }

  // 2. Download Java JARs
  for (const [libKey, entry] of Object.entries(LWJGL_ARM64_PATCH.jars)) {
    await downloadJar(entry).catch((e) => console.log(`[MCT]   Skip ${libKey}: ${e.message}`));
  }

  // 3. Patch the vanilla version JSON to swap LWJGL 3.2.x -> 3.3.1
  let curJsonPath = mc.getVersionJson(versionId);
  for (let depth = 0; depth < 5; depth++) {
    const targetJsonPath = curJsonPath;
    const raw = await readFile(targetJsonPath, "utf-8").catch(() => null);
    if (!raw) { break; }
    const json2 = JSON.parse(raw);
    const hasOldLwjgl = (json2.libraries || []).some(
      (lib) => lib.name?.startsWith("org.lwjgl:lwjgl:3.2")
    );
    if (hasOldLwjgl) {
      const newLibraries = [];
      for (const lib of json2.libraries) {
        const name = lib.name || "";
        const parts = name.split(":");
        const baseKey = parts.slice(0, 2).join(":");

        if (!LWJGL_ARM64_PATCH.jars[baseKey] && !LWJGL_ARM64_PATCH.natives[baseKey]) {
          newLibraries.push(lib);
          continue;
        }

        // Build new library entry
        const newLib = { ...lib };

        // Replace Java JAR (artifact)
        if (LWJGL_ARM64_PATCH.jars[baseKey] && lib.downloads?.artifact) {
          const jarEntry = LWJGL_ARM64_PATCH.jars[baseKey];
          const newName = baseKey === "org.lwjgl:lwjgl-glfw"
            ? "org.glavo.hmcl.mmachina:lwjgl-glfw:3.3.1-mmachina.1"
            : `${baseKey}:3.3.1`;
          newLib.name = newName;
          newLib.downloads = { ...lib.downloads, artifact: { path: jarEntry.path, sha1: jarEntry.sha1, size: jarEntry.size, url: jarEntry.url } };
        }

        // Replace native classifiers with arm64 variant
        if (LWJGL_ARM64_PATCH.natives[baseKey] && lib.downloads?.classifiers?.["natives-macos"]) {
          const nativeEntry = LWJGL_ARM64_PATCH.natives[baseKey];
          newLib.downloads = {
            ...newLib.downloads,
            classifiers: { "natives-macos": { path: nativeEntry.path, sha1: nativeEntry.sha1, size: nativeEntry.size, url: nativeEntry.url } }
          };
        }

        newLibraries.push(newLib);
      }
      json2.libraries = newLibraries;
      await writeFile(targetJsonPath, JSON.stringify(json2, null, 2), "utf-8");
      break;
    }
    if (!json2.inheritsFrom) { break; }
    curJsonPath = mc.getVersionJson(json2.inheritsFrom);
  }

  await writeFile(nativesMarker, "3.3.1");
  console.log("[MCT] arm64 LWJGL 3.3.1 patch applied");
  return nativesDir;
}

async function launchXmclManagedClient(options) {
  const runtimeRoot = options["runtime-root"];
  const versionId = options["version-id"];
  const gameDir = options["game-dir"];

  if (!runtimeRoot || !versionId || !gameDir) {
    throw new Error("Missing required arguments: --runtime-root, --version-id and --game-dir");
  }

  await syncConfiguredMod(gameDir);
  const arm64NativesDir = await ensureArm64Natives(runtimeRoot, versionId);

  const accountName = process.env.MCT_CLIENT_ACCOUNT || options.account || "TEST1";
  const accountUuid = offlineUuid(accountName).replaceAll("-", "");
  const server = process.env.MCT_CLIENT_SERVER || "";
  await ensureAutomationOptions(gameDir, server);
  const [serverHost, serverPort = "25565"] = server.split(":");

  let prechecks;
  if (arm64NativesDir) {
    // Insert arm64 patch AFTER checkVersion (which downloads version JSONs)
    // but BEFORE checkLibraries (which validates jar sha1s) and checkNatives
    prechecks = [];
    for (const fn of LaunchPrecheck.DEFAULT_PRECHECKS) {
      if (fn === LaunchPrecheck.checkNatives) {
        continue; // skip — we already extracted arm64 natives
      }
      if (fn === LaunchPrecheck.checkLibraries) {
        continue; // skip — our patched 3.3.1 libs have empty sha1, let MC load them directly
      }
      prechecks.push(fn);
      if (fn === LaunchPrecheck.checkVersion) {
        // Apply arm64 patch right after version JSON is downloaded
        prechecks.push(async () => {
          await ensureArm64Natives(runtimeRoot, versionId);
        });
      }
    }
  }

  return launchMinecraft({
    gamePath: gameDir,
    resourcePath: runtimeRoot,
    javaPath: options.java || process.env.MCT_CLIENT_JAVA || "java",
    minMemory: 512,
    maxMemory: parseMaxMemory(options["max-mem"]),
    version: versionId,
    nativeRoot: arm64NativesDir || undefined,
    prechecks,
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
          // Legacy fallback for MC < 1.20 that ignores --quickPlayMultiplayer
          extraMCArgs: ["--server", serverHost, "--port", serverPort]
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
