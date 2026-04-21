import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MctError } from "../../util/errors.js";
import { CacheManager } from "../CacheManager.js";
import { copyFileIfMissing, downloadFile } from "../DownloadUtils.js";
import { detectJava } from "../JavaDetector.js";
import {
  findVariantByVersionAndLoader,
  getDefaultVariant,
  getModArtifactFileName,
  loadModVariantCatalog
} from "../ModVariantCatalog.js";
import type { LoaderType, ModVariant } from "../types.js";
import { prepareManagedFabricRuntime } from "./FabricRuntimeDownloader.js";

function getLaunchScriptPath() {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/download/client/ClientDownloader.js -> scripts/launch-fabric-client.mjs
  return path.resolve(path.dirname(thisFile), "..", "..", "..", "scripts", "launch-fabric-client.mjs");
}

const GITHUB_RELEASE_BASE_URL =
  process.env.MCT_MOD_DOWNLOAD_BASE_URL || "https://github.com/kzheart/mc-pilot/releases/download";

export interface DownloadClientOptions {
  loader?: LoaderType;
  version?: string;
  dir?: string;
  name?: string;
  wsPort?: number;
  server?: string;
  instanceDir?: string;
  metaDir?: string;
  librariesDir?: string;
  assetsDir?: string;
  nativesDir?: string;
  java?: string;
}

export interface DownloadClientDependencies {
  cacheManager?: CacheManager;
  detectJavaImpl?: typeof detectJava;
  fetchImpl?: typeof fetch;
  prepareManagedRuntimeImpl?: typeof prepareManagedFabricRuntime;
}

function ensureSupportedVariant(variant: ModVariant) {
  if (variant.loader !== "fabric") {
    throw new MctError(
      {
        code: "UNSUPPORTED_LOADER",
        message: `Loader ${variant.loader} is not implemented yet`
      },
      4
    );
  }

  if (!variant.fabricLoaderVersion || !variant.yarnMappings) {
    throw new MctError(
      {
        code: "VARIANT_NOT_BUILDABLE",
        message: `Variant ${variant.id} is not buildable yet`,
        details: {
          support: variant.support,
          validation: variant.validation
        }
      },
      4
    );
  }
}

export async function resolveArtifact(
  cwd: string,
  variant: ModVariant,
  cacheManager: CacheManager,
  fetchImpl: typeof fetch = fetch
) {
  const artifactFileName = getModArtifactFileName(variant);
  const gradleModule = (variant as any).gradleModule ?? `version-${variant.minecraftVersion}`;
  const buildArtifactPath = path.join(cwd, "client-mod", gradleModule, "build", "libs", artifactFileName);
  const cacheArtifactPath = cacheManager.getModFile(artifactFileName);

  // 1. Check local build artifact
  try {
    await access(buildArtifactPath);
    await copyFileIfMissing(buildArtifactPath, cacheArtifactPath);
    return { sourcePath: buildArtifactPath, cachePath: cacheArtifactPath, artifactFileName, source: "local-build" as const };
  } catch {}

  // 2. Check cache
  try {
    await access(cacheArtifactPath);
    return { sourcePath: cacheArtifactPath, cachePath: cacheArtifactPath, artifactFileName, source: "cache" as const };
  } catch {}

  // 3. Download from GitHub Releases
  const modVersion = variant.modVersion ?? "0.9.1";
  const releaseTag = `v${modVersion}`;
  const downloadUrl = `${GITHUB_RELEASE_BASE_URL}/${releaseTag}/${artifactFileName}`;

  try {
    await downloadFile(downloadUrl, cacheArtifactPath, fetchImpl);
    return { sourcePath: cacheArtifactPath, cachePath: cacheArtifactPath, artifactFileName, source: "github-release" as const };
  } catch (error) {
    throw new MctError(
      {
        code: "ARTIFACT_NOT_FOUND",
        message: `Could not find mod artifact for ${variant.id}. Tried local build, cache, and GitHub Releases.`,
        details: {
          localBuild: buildArtifactPath,
          cache: cacheArtifactPath,
          downloadUrl,
          downloadError: error instanceof Error ? error.message : String(error)
        }
      },
      4
    );
  }
}

interface ClientLaunchRuntimePaths {
  instanceDir: string;
  metaDir: string;
  librariesDir: string;
  assetsDir: string;
  nativesDir?: string;
}

function resolveLaunchRuntimePaths(cwd: string, options: DownloadClientOptions): ClientLaunchRuntimePaths | undefined {
  const runtimePaths = {
    instanceDir: options.instanceDir,
    metaDir: options.metaDir,
    librariesDir: options.librariesDir,
    assetsDir: options.assetsDir,
    nativesDir: options.nativesDir
  };
  const requiredEntries = Object.entries({
    instanceDir: runtimePaths.instanceDir,
    metaDir: runtimePaths.metaDir,
    librariesDir: runtimePaths.librariesDir,
    assetsDir: runtimePaths.assetsDir
  });
  const providedRequired = requiredEntries.filter(([, value]) => Boolean(value));

  if (providedRequired.length === 0) {
    return undefined;
  }

  const missing = requiredEntries
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: "Client runtime directories must be configured together",
        details: {
          missing
        }
      },
      4
    );
  }

  return {
    instanceDir: path.resolve(cwd, runtimePaths.instanceDir!),
    metaDir: path.resolve(cwd, runtimePaths.metaDir!),
    librariesDir: path.resolve(cwd, runtimePaths.librariesDir!),
    assetsDir: path.resolve(cwd, runtimePaths.assetsDir!),
    ...(runtimePaths.nativesDir
      ? {
          nativesDir: path.resolve(cwd, runtimePaths.nativesDir)
        }
      : {})
  };
}

function buildLaunchArgs(runtimePaths: ClientLaunchRuntimePaths, variant: ModVariant) {
  return [
    "--instance-dir",
    runtimePaths.instanceDir,
    "--meta-dir",
    runtimePaths.metaDir,
    "--libraries-dir",
    runtimePaths.librariesDir,
    "--assets-dir",
    runtimePaths.assetsDir,
    ...(runtimePaths.nativesDir ? ["--natives-dir", runtimePaths.nativesDir] : []),
    "--minecraft-version",
    variant.minecraftVersion,
    "--fabric-loader-version",
    variant.fabricLoaderVersion ?? "0.16.14"
  ];
}

function buildManagedLaunchArgs(runtimeRootDir: string, versionId: string, gameDir: string) {
  return [
    "--runtime-root",
    runtimeRootDir,
    "--version-id",
    versionId,
    "--game-dir",
    gameDir
  ];
}

async function ensureJavaReady(variant: ModVariant, detectJavaImpl: typeof detectJava, command?: string) {
  const result = await detectJavaImpl(command ?? "java");
  const requiredVersion = variant.javaVersion ?? 17;

  if (!result.available) {
    throw new MctError(
      {
        code: "JAVA_NOT_FOUND",
        message: `Java ${requiredVersion}+ is required for ${variant.id}`,
        details: {
          command: result.command
        }
      },
      4
    );
  }

  if ((result.majorVersion ?? 0) < requiredVersion) {
    throw new MctError(
      {
        code: "JAVA_VERSION_TOO_LOW",
        message: `Java ${requiredVersion}+ is required for ${variant.id}`,
        details: {
          detected: result.majorVersion,
          command: result.command
        }
      },
      4
    );
  }

  return result;
}

export async function downloadClientModToDir(
  cwd: string,
  targetDir: string,
  options: DownloadClientOptions,
  dependencies: DownloadClientDependencies = {}
) {
  const loader = options.loader ?? "fabric";
  const cacheManager = dependencies.cacheManager ?? new CacheManager();
  const detectJavaImpl = dependencies.detectJavaImpl ?? detectJava;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const prepareManagedRuntimeImpl = dependencies.prepareManagedRuntimeImpl ?? prepareManagedFabricRuntime;
  const catalog = await loadModVariantCatalog();
  const variant = options.version
    ? findVariantByVersionAndLoader(catalog, options.version, loader)
    : getDefaultVariant(catalog);

  if (!variant) {
    throw new MctError(
      {
        code: "VARIANT_NOT_FOUND",
        message: `No mod variant found for ${options.version ?? "default"} / ${loader}`
      },
      4
    );
  }

  ensureSupportedVariant(variant);
  const java = await ensureJavaReady(variant, detectJavaImpl, options.java);

  const artifact = await resolveArtifact(cwd, variant, cacheManager, fetchImpl);
  const minecraftDir = path.join(targetDir, "minecraft");
  const modsDir = path.join(minecraftDir, "mods");
  await mkdir(minecraftDir, { recursive: true });
  await mkdir(modsDir, { recursive: true });
  const targetJarPath = path.join(modsDir, artifact.artifactFileName);
  await copyFileIfMissing(artifact.sourcePath, targetJarPath);

  const runtimePaths = resolveLaunchRuntimePaths(cwd, options);
  const managedRuntime = runtimePaths
    ? undefined
    : await prepareManagedRuntimeImpl(variant, {
        runtimeRootDir: path.join(cacheManager.getRootDir(), "client", "runtime", variant.minecraftVersion),
        gameDir: minecraftDir
      }, { fetchImpl });
  const generatedLaunchArgs = runtimePaths
    ? buildLaunchArgs(runtimePaths, variant)
    : buildManagedLaunchArgs(managedRuntime!.runtimeRootDir, managedRuntime!.versionId, managedRuntime!.gameDir);

  return {
    downloaded: true,
    variant,
    variantId: variant.id,
    minecraftVersion: variant.minecraftVersion,
    loader: variant.loader,
    javaCommand: java.command,
    javaVersion: java.majorVersion,
    minecraftDir,
    modsDir,
    jar: targetJarPath,
    cachePath: artifact.cachePath,
    launchArgs: generatedLaunchArgs,
    runtimeRootDir: managedRuntime?.runtimeRootDir,
    runtimeVersionId: managedRuntime?.versionId
  };
}
