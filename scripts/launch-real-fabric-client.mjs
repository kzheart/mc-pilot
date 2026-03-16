#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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

async function buildLaunchSpec(options) {
  const prismRoot = options["prism-root"];
  const instanceId = options["instance-id"];
  const minecraftVersion = process.env.MCT_CLIENT_VERSION || options["minecraft-version"] || "1.20.4";
  const fabricLoaderVersion = options["fabric-loader-version"] || "0.16.10";
  const instanceRoot = path.join(prismRoot, "instances", instanceId);
  const gameDir = path.join(instanceRoot, "minecraft");
  const metaRoot = path.join(prismRoot, "meta");
  const librariesRoot = path.join(prismRoot, "libraries");
  const assetsRoot = path.join(prismRoot, "assets");
  const nativesDir = path.join(instanceRoot, "natives");
  const packMeta = await readJson(path.join(instanceRoot, "mmc-pack.json"));
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prismRoot = options["prism-root"];
  const instanceId = options["instance-id"];

  if (!prismRoot || !instanceId) {
    throw new Error("Missing required arguments: --prism-root and --instance-id");
  }

  const launch = await buildLaunchSpec(options);
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
