import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import type { CommandContext } from "../../util/context.js";
import { MctError } from "../../util/errors.js";
import { loadConfig, writeConfig } from "../../util/config.js";
import { CacheManager } from "../CacheManager.js";
import { copyFileIfMissing, downloadFile } from "../DownloadUtils.js";
import { getMinecraftSupport, type ServerType } from "../VersionMatrix.js";

const SERVER_DOWNLOAD_BASE_URLS: Record<Extract<ServerType, "paper" | "purpur">, string> = {
  paper: process.env.MCT_PAPER_API_BASE_URL || "https://api.papermc.io/v2/projects",
  purpur: process.env.MCT_PURPUR_API_BASE_URL || "https://api.purpurmc.org/v2"
};

const MOJANG_VERSION_MANIFEST_URL =
  process.env.MCT_MOJANG_VERSION_MANIFEST_URL || "https://launchermeta.mojang.com/mc/game/version_manifest.json";
const SPIGOT_BUILD_TOOLS_URL =
  process.env.MCT_SPIGOT_BUILDTOOLS_URL ||
  "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar";

const execFileAsync = promisify(execFile);
type ExecFileLike = (
  file: string,
  args: string[],
  options: {
    cwd?: string;
    maxBuffer?: number;
  }
) => Promise<{
  stdout: string;
  stderr: string;
}>;

export interface DownloadServerOptions {
  type?: ServerType;
  version?: string;
  build?: string;
  dir?: string;
  fixtures?: string;
}

export interface DownloadServerDependencies {
  fetchImpl?: typeof fetch;
  cacheManager?: CacheManager;
  execFileImpl?: ExecFileLike;
}

function resolveDownloadUrl(type: Extract<ServerType, "paper" | "purpur">, version: string, build: string) {
  if (type === "paper") {
    return `${SERVER_DOWNLOAD_BASE_URLS.paper}/paper/versions/${version}/builds/${build}/downloads/paper-${version}-${build}.jar`;
  }

  return `${SERVER_DOWNLOAD_BASE_URLS.purpur}/purpur/${version}/${build}/download`;
}

async function fetchJsonWithRetry<T>(url: string, fetchImpl: typeof fetch, attempts = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(attempt * 500);
    }
  }

  throw lastError;
}

async function resolveVanillaDownloadSpec(version: string, fetchImpl: typeof fetch) {
  const manifest = await fetchJsonWithRetry<{
    versions: Array<{ id: string; url: string }>;
  }>(MOJANG_VERSION_MANIFEST_URL, fetchImpl);
  const versionEntry = manifest.versions.find((entry) => entry.id === version);
  if (!versionEntry) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Unsupported vanilla version ${version}`
      },
      4
    );
  }

  const versionJson = await fetchJsonWithRetry<{
    downloads?: {
      server?: {
        url: string;
      };
    };
  }>(versionEntry.url, fetchImpl);
  const serverDownload = versionJson.downloads?.server;
  if (!serverDownload?.url) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Vanilla server jar is not available for ${version}`
      },
      4
    );
  }

  return {
    type: "vanilla" as const,
    version,
    build: "release",
    fileName: `vanilla-${version}.jar`,
    downloadUrl: serverDownload.url
  };
}

async function buildSpigotServerJar(
  version: string,
  cacheManager: CacheManager,
  fetchImpl: typeof fetch,
  execFileImpl: ExecFileLike
) {
  const buildToolsJarPath = cacheManager.getServerJarPath("spigot", "buildtools", "latest");
  const cachePath = cacheManager.getServerJarPath("spigot", version, "buildtools");
  const buildDir = path.join(cacheManager.getRootDir(), "server", "spigot", "build", version);
  const builtJarPath = path.join(buildDir, `spigot-${version}.jar`);

  try {
    await access(cachePath);
    return {
      cachePath,
      build: "buildtools"
    };
  } catch {}

  try {
    await access(buildToolsJarPath);
  } catch {
    await downloadFile(SPIGOT_BUILD_TOOLS_URL, buildToolsJarPath, fetchImpl);
  }

  await mkdir(buildDir, { recursive: true });
  await execFileImpl(
    "java",
    ["-jar", buildToolsJarPath, "--rev", version, "--compile", "SPIGOT", "--disable-certificate-check", "--output-dir", "."],
    {
      cwd: buildDir,
      maxBuffer: 32 * 1024 * 1024
    }
  );

  try {
    await access(builtJarPath);
  } catch {
    throw new MctError(
      {
        code: "DOWNLOAD_FAILED",
        message: `BuildTools did not produce spigot-${version}.jar`,
        details: {
          buildDir
        }
      },
      2
    );
  }

  await copyFileIfMissing(builtJarPath, cachePath);
  return {
    cachePath,
    build: "buildtools"
  };
}

export function resolveServerDownloadSpec(options: DownloadServerOptions) {
  const type = options.type ?? "paper";
  const resolvedVersion = options.version ?? "1.21.4";
  const versionEntry = getMinecraftSupport(resolvedVersion);

  if (!versionEntry) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Unsupported ${type} version ${options.version ?? ""}`.trim()
      },
      4
    );
  }

  if (type === "vanilla") {
    return {
      type,
      version: resolvedVersion,
      build: "release",
      fileName: `vanilla-${resolvedVersion}.jar`,
      downloadUrl: ""
    };
  }

  if (type === "spigot") {
    return {
      type,
      version: resolvedVersion,
      build: "buildtools",
      fileName: `spigot-${resolvedVersion}.jar`,
      downloadUrl: SPIGOT_BUILD_TOOLS_URL
    };
  }

  const resolvedBuild = options.build ?? versionEntry.servers[type].latestBuild?.toString();
  if (!resolvedBuild) {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: `${type} ${resolvedVersion} requires an explicit build`
      },
      4
    );
  }

  return {
    type,
    version: resolvedVersion,
    build: resolvedBuild,
    fileName: `${type}-${resolvedVersion}-${resolvedBuild}.jar`,
    downloadUrl: resolveDownloadUrl(type, resolvedVersion, resolvedBuild)
  };
}

export async function downloadServerJar(
  context: CommandContext,
  options: DownloadServerOptions,
  dependencies: DownloadServerDependencies = {}
) {
  const cacheManager = dependencies.cacheManager ?? new CacheManager();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const execFileImpl = (dependencies.execFileImpl ?? execFileAsync) as ExecFileLike;
  const initialSpec = resolveServerDownloadSpec(options);
  const spec =
    initialSpec.type === "vanilla"
      ? await resolveVanillaDownloadSpec(initialSpec.version, fetchImpl)
      : initialSpec;
  const cachePath =
    spec.type === "spigot"
      ? (await buildSpigotServerJar(spec.version, cacheManager, fetchImpl, execFileImpl)).cachePath
      : cacheManager.getServerJarPath(spec.type, spec.version, spec.build);

  if (spec.type !== "spigot") {
    try {
      await access(cachePath);
    } catch {
      await downloadFile(spec.downloadUrl, cachePath, fetchImpl);
    }
  }

  const targetDir = path.resolve(context.cwd, options.dir ?? context.config.server.dir);
  const targetJarPath = path.join(targetDir, spec.fileName);
  await copyFileIfMissing(cachePath, targetJarPath);

  if (options.fixtures) {
    const fixturesPath = path.resolve(context.cwd, options.fixtures);
    const pluginsDir = path.join(targetDir, "plugins");
    await mkdir(pluginsDir, { recursive: true });
    await copyFileIfMissing(fixturesPath, path.join(pluginsDir, path.basename(fixturesPath)));
  }

  const latestConfig = await loadConfig(context.configPath, context.cwd);
  latestConfig.server.jar = path.relative(context.cwd, targetJarPath);
  latestConfig.server.dir = path.relative(context.cwd, targetDir) || ".";
  await writeConfig(context.configPath, context.cwd, latestConfig);

  return {
    downloaded: true,
    type: spec.type,
    version: spec.version,
    build: spec.build,
    cachePath,
    jar: targetJarPath,
    dir: targetDir
  };
}
