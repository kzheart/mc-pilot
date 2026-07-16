import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { MctError } from "../../util/errors.js";
import { CacheManager } from "../CacheManager.js";
import { copyFileIfMissing, downloadFile } from "../DownloadUtils.js";
import { proxyAwareFetch } from "../HttpClient.js";
import {
  getMinecraftSupport,
  isProxyType,
  PROXY_MATRIX,
  type ServerType,
} from "../VersionMatrix.js";

const SERVER_DOWNLOAD_BASE_URLS: Record<
  Extract<ServerType, "paper" | "purpur">,
  string
> = {
  // PaperMC 旧版 v2 API 已于 2025 年下线(410 sunset),现用 Fill v3
  paper:
    process.env.MCT_PAPER_API_BASE_URL || "https://fill.papermc.io/v3/projects",
  purpur: process.env.MCT_PURPUR_API_BASE_URL || "https://api.purpurmc.org/v2",
};

const MOJANG_VERSION_MANIFEST_URL =
  process.env.MCT_MOJANG_VERSION_MANIFEST_URL ||
  "https://launchermeta.mojang.com/mc/game/version_manifest.json";
const SPIGOT_BUILD_TOOLS_URL =
  process.env.MCT_SPIGOT_BUILDTOOLS_URL ||
  "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar";
const BUNGEE_JENKINS_BASE =
  process.env.MCT_BUNGEE_JENKINS_URL || "https://ci.md-5.net/job/BungeeCord";

const execFileAsync = promisify(execFile);
type ExecFileLike = (
  file: string,
  args: string[],
  options: {
    cwd?: string;
    maxBuffer?: number;
  },
) => Promise<{
  stdout: string;
  stderr: string;
}>;

export interface DownloadServerOptions {
  type?: ServerType;
  version?: string;
  build?: string;
  javaCommand?: string;
  dir?: string;
  fixtures?: string;
}

export interface DownloadServerDependencies {
  fetchImpl?: typeof fetch;
  cacheManager?: CacheManager;
  execFileImpl?: ExecFileLike;
}

function resolvePurpurDownloadUrl(version: string, build: string) {
  return `${SERVER_DOWNLOAD_BASE_URLS.purpur}/purpur/${version}/${build}/download`;
}

async function fetchJsonWithRetry<T>(
  url: string,
  fetchImpl: typeof fetch,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`.trim(),
        );
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

async function resolveVanillaDownloadSpec(
  version: string,
  fetchImpl: typeof fetch,
) {
  const manifest = await fetchJsonWithRetry<{
    versions: Array<{ id: string; url: string }>;
  }>(MOJANG_VERSION_MANIFEST_URL, fetchImpl);
  const versionEntry = manifest.versions.find((entry) => entry.id === version);
  if (!versionEntry) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Unsupported vanilla version ${version}`,
      },
      4,
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
        message: `Vanilla server jar is not available for ${version}`,
      },
      4,
    );
  }

  return {
    type: "vanilla" as const,
    version,
    build: "release",
    fileName: `vanilla-${version}.jar`,
    downloadUrl: serverDownload.url,
  };
}

async function resolveFillDownloadUrl(
  project: "paper" | "velocity",
  version: string,
  build: string,
  fetchImpl: typeof fetch,
) {
  const buildInfo = await fetchJsonWithRetry<{
    downloads?: Record<string, { url?: string }>;
  }>(
    `${SERVER_DOWNLOAD_BASE_URLS.paper}/${project}/versions/${version}/builds/${build}`,
    fetchImpl,
  );
  const serverDownload = buildInfo.downloads?.["server:default"];
  if (!serverDownload?.url) {
    throw new MctError(
      {
        code: "DOWNLOAD_FAILED",
        message: `${project} ${version} build ${build} has no server download`,
        details: {
          version,
          build,
        },
      },
      2,
    );
  }

  return serverDownload.url;
}

async function resolveBungeeBuild(
  build: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (build && build !== "lastSuccessful") {
    return build;
  }
  const info = await fetchJsonWithRetry<{ number?: number }>(
    `${BUNGEE_JENKINS_BASE}/lastSuccessfulBuild/api/json`,
    fetchImpl,
  );
  if (!info.number) {
    throw new MctError(
      {
        code: "DOWNLOAD_FAILED",
        message: "Failed to resolve latest BungeeCord build from Jenkins",
      },
      2,
    );
  }
  return String(info.number);
}

function bungeeDownloadUrl(build: string): string {
  return `${BUNGEE_JENKINS_BASE}/${build}/artifact/bootstrap/target/BungeeCord.jar`;
}

async function buildSpigotServerJar(
  version: string,
  javaCommand: string,
  cacheManager: CacheManager,
  fetchImpl: typeof fetch,
  execFileImpl: ExecFileLike,
) {
  const buildToolsJarPath = cacheManager.getServerJarPath(
    "spigot",
    "buildtools",
    "latest",
  );
  const cachePath = cacheManager.getServerJarPath(
    "spigot",
    version,
    "buildtools",
  );
  const buildDir = path.join(
    cacheManager.getRootDir(),
    "server",
    "spigot",
    "build",
    version,
  );
  const builtJarPath = path.join(buildDir, `spigot-${version}.jar`);

  try {
    await access(cachePath);
    return {
      cachePath,
      build: "buildtools",
    };
  } catch {}

  try {
    await access(buildToolsJarPath);
  } catch {
    await downloadFile(SPIGOT_BUILD_TOOLS_URL, buildToolsJarPath, fetchImpl);
  }

  await mkdir(buildDir, { recursive: true });
  await execFileImpl(
    javaCommand,
    [
      "-jar",
      buildToolsJarPath,
      "--rev",
      version,
      "--compile",
      "SPIGOT",
      "--disable-certificate-check",
      "--output-dir",
      ".",
    ],
    {
      cwd: buildDir,
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  try {
    await access(builtJarPath);
  } catch {
    throw new MctError(
      {
        code: "DOWNLOAD_FAILED",
        message: `BuildTools did not produce spigot-${version}.jar`,
        details: {
          buildDir,
        },
      },
      2,
    );
  }

  await copyFileIfMissing(builtJarPath, cachePath);
  return {
    cachePath,
    build: "buildtools",
  };
}

export function resolveServerDownloadSpec(options: DownloadServerOptions) {
  const type = options.type ?? "paper";

  if (isProxyType(type)) {
    if (type === "velocity") {
      const version = options.version ?? PROXY_MATRIX.velocity.defaultVersion;
      const build =
        options.build ?? String(PROXY_MATRIX.velocity.latestBuild ?? "");
      if (!build) {
        throw new MctError(
          {
            code: "INVALID_PARAMS",
            message: `velocity ${version} requires an explicit build`,
          },
          4,
        );
      }
      return {
        type,
        version,
        build,
        fileName: `velocity-${version}-${build}.jar`,
        // 实际下载地址需异步查询 Fill API,在下载时解析
        downloadUrl: "",
      };
    }

    const build = options.build ?? "lastSuccessful";
    return {
      type,
      version: "latest",
      build,
      fileName: `bungeecord-${build}.jar`,
      // 实际 build 号与下载地址在下载时经 Jenkins API 解析
      downloadUrl: "",
    };
  }

  const resolvedVersion = options.version ?? "1.21.4";
  const versionEntry = getMinecraftSupport(resolvedVersion);

  if (!versionEntry) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Unsupported ${type} version ${options.version ?? ""}`.trim(),
      },
      4,
    );
  }

  if (!versionEntry.servers[type].supported) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `${type} does not publish an exact ${resolvedVersion} server artifact`,
      },
      4,
    );
  }

  if (type === "vanilla") {
    return {
      type,
      version: resolvedVersion,
      build: "release",
      fileName: `vanilla-${resolvedVersion}.jar`,
      downloadUrl: "",
    };
  }

  if (type === "spigot") {
    return {
      type,
      version: resolvedVersion,
      build: "buildtools",
      fileName: `spigot-${resolvedVersion}.jar`,
      downloadUrl: SPIGOT_BUILD_TOOLS_URL,
    };
  }

  const resolvedBuild =
    options.build ?? versionEntry.servers[type].latestBuild?.toString();
  if (!resolvedBuild) {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: `${type} ${resolvedVersion} requires an explicit build`,
      },
      4,
    );
  }

  return {
    type,
    version: resolvedVersion,
    build: resolvedBuild,
    fileName: `${type}-${resolvedVersion}-${resolvedBuild}.jar`,
    // paper 的实际下载地址需异步查询 Fill API,在下载时解析
    downloadUrl:
      type === "purpur"
        ? resolvePurpurDownloadUrl(resolvedVersion, resolvedBuild)
        : "",
  };
}

export async function downloadServerJarToCache(
  options: DownloadServerOptions,
  dependencies: DownloadServerDependencies = {},
) {
  const cacheManager = dependencies.cacheManager ?? new CacheManager();
  const fetchImpl = dependencies.fetchImpl ?? proxyAwareFetch;
  const execFileImpl = (dependencies.execFileImpl ??
    execFileAsync) as ExecFileLike;
  const spec = resolveServerDownloadSpec(options);

  // bungeecord 缺省 build 需先经 Jenkins 解析出真实 build 号,保证缓存 key 稳定
  let resolvedSpec = spec;
  if (spec.type === "bungeecord" && spec.build === "lastSuccessful") {
    const realBuild = await resolveBungeeBuild(undefined, fetchImpl);
    resolvedSpec = {
      ...spec,
      build: realBuild,
      fileName: `bungeecord-${realBuild}.jar`,
    };
  }

  const cachePath =
    resolvedSpec.type === "spigot"
      ? (
          await buildSpigotServerJar(
            resolvedSpec.version,
            options.javaCommand ?? "java",
            cacheManager,
            fetchImpl,
            execFileImpl,
          )
        ).cachePath
      : cacheManager.getServerJarPath(
          resolvedSpec.type,
          resolvedSpec.version,
          resolvedSpec.build,
        );

  if (resolvedSpec.type !== "spigot") {
    try {
      await access(cachePath);
    } catch {
      // 缓存命中时不发起网络请求,仅在需要下载时解析实际地址
      const downloadUrl =
        resolvedSpec.type === "vanilla"
          ? (await resolveVanillaDownloadSpec(resolvedSpec.version, fetchImpl))
              .downloadUrl
          : resolvedSpec.type === "paper"
            ? await resolveFillDownloadUrl(
                "paper",
                resolvedSpec.version,
                resolvedSpec.build,
                fetchImpl,
              )
            : resolvedSpec.type === "velocity"
              ? await resolveFillDownloadUrl(
                  "velocity",
                  resolvedSpec.version,
                  resolvedSpec.build,
                  fetchImpl,
                )
              : resolvedSpec.type === "bungeecord"
                ? bungeeDownloadUrl(resolvedSpec.build)
                : resolvedSpec.downloadUrl;
      await downloadFile(downloadUrl, cachePath, fetchImpl);
    }
  }

  return {
    downloaded: true,
    type: resolvedSpec.type,
    version: resolvedSpec.version,
    build: resolvedSpec.build,
    cachePath,
    fileName: resolvedSpec.fileName,
  };
}
