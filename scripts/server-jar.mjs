// Server jars for the real-client test suite. mct itself no longer downloads
// servers, so the suite fetches the pinned builds it was verified against.

import { execFile } from "node:child_process";
import { access, copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FILL_API = process.env.MCT_PAPER_API_BASE_URL || "https://fill.papermc.io/v3/projects";
const MOJANG_MANIFEST =
  process.env.MCT_MOJANG_VERSION_MANIFEST_URL ||
  "https://launchermeta.mojang.com/mc/game/version_manifest.json";
const BUILD_TOOLS_URL =
  process.env.MCT_SPIGOT_BUILDTOOLS_URL ||
  "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar";

// Client Minecraft version -> server the suite runs it against. Pinned builds
// are the ones each client variant was verified with.
export const SUITE_SERVER_TARGETS = {
  "26.2": { serverType: "paper", serverVersion: "26.2", serverBuild: 60 },
  "26.1": { serverType: "paper", serverVersion: "26.1.2", serverBuild: 74 },
  "1.21.11": { serverType: "paper", serverVersion: "1.21.11", serverBuild: 69 },
  "1.21.4": { serverType: "paper", serverVersion: "1.21.4", serverBuild: 170 },
  "1.21.1": { serverType: "paper", serverVersion: "1.21.1", serverBuild: 119 },
  "1.20.4": { serverType: "paper", serverVersion: "1.20.4", serverBuild: 496 },
  "1.20.3": { serverType: "spigot", serverVersion: "1.20.3" },
  "1.20.2": { serverType: "paper", serverVersion: "1.20.2", serverBuild: 318 },
  "1.20.1": { serverType: "paper", serverVersion: "1.20.1", serverBuild: 196 },
  "1.18.2": { serverType: "paper", serverVersion: "1.18.2", serverBuild: 388 },
  "1.16.5": { serverType: "paper", serverVersion: "1.16.5", serverBuild: 794 },
  "1.12.2": { serverType: "paper", serverVersion: "1.12.2", serverBuild: 1620 },
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  await writeFile(partial, Buffer.from(await response.arrayBuffer()));
  await rename(partial, target);
}

async function resolveDownloadUrl({ serverType, serverVersion, serverBuild }) {
  if (serverType === "paper") {
    const build = serverBuild ?? "latest";
    const info = await fetchJson(
      `${FILL_API}/paper/versions/${serverVersion}/builds/${build}`,
    );
    const url = info.downloads?.["server:default"]?.url;
    if (!url) throw new Error(`paper ${serverVersion} build ${build} has no download`);
    return url;
  }
  if (serverType === "vanilla") {
    const manifest = await fetchJson(MOJANG_MANIFEST);
    const entry = manifest.versions.find((version) => version.id === serverVersion);
    if (!entry) throw new Error(`unknown vanilla version ${serverVersion}`);
    const url = (await fetchJson(entry.url)).downloads?.server?.url;
    if (!url) throw new Error(`vanilla ${serverVersion} has no server jar`);
    return url;
  }
  throw new Error(`no direct download for ${serverType}`);
}

async function buildSpigot(serverVersion, cacheDir, javaCommand) {
  const buildDir = path.join(cacheDir, "spigot-build", serverVersion);
  const buildTools = path.join(cacheDir, "BuildTools.jar");
  if (!(await exists(buildTools))) {
    await download(BUILD_TOOLS_URL, buildTools);
  }
  await mkdir(buildDir, { recursive: true });
  await execFileAsync(
    javaCommand,
    ["-jar", buildTools, "--rev", serverVersion, "--compile", "SPIGOT", "--disable-certificate-check", "--output-dir", "."],
    { cwd: buildDir, maxBuffer: 32 * 1024 * 1024 },
  );
  return path.join(buildDir, `spigot-${serverVersion}.jar`);
}

/** Download (or reuse from `cacheDir`) the server jar into `serverDir`. */
export async function installServerJar(target, { cacheDir, serverDir, javaCommand = "java" }) {
  const { serverType, serverVersion, serverBuild } = target;
  const fileName = `${serverType}-${serverVersion}${serverBuild != null ? `-${serverBuild}` : ""}.jar`;
  const cached = path.join(cacheDir, fileName);

  if (!(await exists(cached))) {
    if (serverType === "spigot") {
      await copyFile(await buildSpigot(serverVersion, cacheDir, javaCommand), cached);
    } else {
      await download(await resolveDownloadUrl(target), cached);
    }
  }

  await mkdir(serverDir, { recursive: true });
  const installed = path.join(serverDir, fileName);
  await copyFile(cached, installed);
  return installed;
}
