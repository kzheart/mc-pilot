import { access } from "node:fs/promises";
import path from "node:path";

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

export interface DownloadServerOptions {
  type?: ServerType;
  version?: string;
  build?: string;
  dir?: string;
}

export interface DownloadServerDependencies {
  fetchImpl?: typeof fetch;
  cacheManager?: CacheManager;
}

function resolveDownloadUrl(type: Extract<ServerType, "paper" | "purpur">, version: string, build: string) {
  if (type === "paper") {
    return `${SERVER_DOWNLOAD_BASE_URLS.paper}/paper/versions/${version}/builds/${build}/downloads/paper-${version}-${build}.jar`;
  }

  return `${SERVER_DOWNLOAD_BASE_URLS.purpur}/purpur/${version}/${build}/download`;
}

export function resolveServerDownloadSpec(options: DownloadServerOptions) {
  const type = options.type ?? "paper";
  if (type === "spigot") {
    throw new MctError(
      {
        code: "UNSUPPORTED_PROVIDER",
        message: "Spigot download is not implemented yet"
      },
      4
    );
  }

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
  const spec = resolveServerDownloadSpec(options);
  const cacheManager = dependencies.cacheManager ?? new CacheManager();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const cachePath = cacheManager.getServerJarPath(spec.type, spec.version, spec.build);

  try {
    await access(cachePath);
  } catch {
    await downloadFile(spec.downloadUrl, cachePath, fetchImpl);
  }

  const targetDir = path.resolve(context.cwd, options.dir ?? context.config.server.dir);
  const targetJarPath = path.join(targetDir, spec.fileName);
  await copyFileIfMissing(cachePath, targetJarPath);

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
