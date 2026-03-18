import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { CommandContext } from "../../util/context.js";
import { DEFAULT_WS_PORT_BASE, loadConfig, writeConfig } from "../../util/config.js";
import { MctError } from "../../util/errors.js";
import { CacheManager } from "../CacheManager.js";
import { copyFileIfMissing } from "../DownloadUtils.js";
import { detectJava } from "../JavaDetector.js";
import {
  findVariantByVersionAndLoader,
  getDefaultVariant,
  getModArtifactFileName,
  loadModVariantCatalog
} from "../ModVariantCatalog.js";
import type { LoaderType, ModVariant } from "../types.js";
import { prepareManagedFabricRuntime } from "./FabricRuntimeDownloader.js";

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

async function resolveLocalArtifact(context: CommandContext, variant: ModVariant, cacheManager: CacheManager) {
  const artifactFileName = getModArtifactFileName(variant);
  const gradleModule = (variant as any).gradleModule ?? `version-${variant.minecraftVersion}`;
  const buildArtifactPath = path.join(context.cwd, "client-mod", gradleModule, "build", "libs", artifactFileName);
  const cacheArtifactPath = cacheManager.getModFile(artifactFileName);

  try {
    await access(buildArtifactPath);
    await copyFileIfMissing(buildArtifactPath, cacheArtifactPath);
    return {
      sourcePath: buildArtifactPath,
      cachePath: cacheArtifactPath,
      artifactFileName
    };
  } catch {
    try {
      await access(cacheArtifactPath);
      return {
        sourcePath: cacheArtifactPath,
        cachePath: cacheArtifactPath,
        artifactFileName
      };
    } catch {
      throw new MctError(
        {
          code: "ARTIFACT_NOT_FOUND",
          message: `Missing local build artifact for ${variant.id}`,
          details: {
            expectedBuildArtifact: buildArtifactPath,
            expectedCacheArtifact: cacheArtifactPath
          }
        },
        4
      );
    }
  }
}

interface ClientLaunchRuntimePaths {
  instanceDir: string;
  metaDir: string;
  librariesDir: string;
  assetsDir: string;
  nativesDir?: string;
}

function resolveLaunchRuntimePaths(context: CommandContext, options: DownloadClientOptions): ClientLaunchRuntimePaths | undefined {
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
    instanceDir: path.resolve(context.cwd, runtimePaths.instanceDir!),
    metaDir: path.resolve(context.cwd, runtimePaths.metaDir!),
    librariesDir: path.resolve(context.cwd, runtimePaths.librariesDir!),
    assetsDir: path.resolve(context.cwd, runtimePaths.assetsDir!),
    ...(runtimePaths.nativesDir
      ? {
          nativesDir: path.resolve(context.cwd, runtimePaths.nativesDir)
        }
      : {})
  };
}

function buildLaunchCommand(context: CommandContext, runtimePaths: ClientLaunchRuntimePaths, variant: ModVariant) {
  return [
    process.execPath,
    path.join(context.cwd, "scripts", "launch-fabric-client.mjs"),
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
    variant.fabricLoaderVersion ?? "0.16.10"
  ];
}

function buildManagedLaunchCommand(context: CommandContext, runtimeRootDir: string, versionId: string, gameDir: string) {
  return [
    process.execPath,
    path.join(context.cwd, "scripts", "launch-fabric-client.mjs"),
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

export async function downloadClientMod(
  context: CommandContext,
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

  const artifact = await resolveLocalArtifact(context, variant, cacheManager);
  const clientRootDir = path.resolve(context.cwd, options.dir ?? "./client");
  const minecraftDir = path.join(clientRootDir, "minecraft");
  const modsDir = path.join(minecraftDir, "mods");
  await mkdir(minecraftDir, { recursive: true });
  await mkdir(modsDir, { recursive: true });
  const targetJarPath = path.join(modsDir, artifact.artifactFileName);
  await copyFileIfMissing(artifact.sourcePath, targetJarPath);

  const clientName = options.name ?? "default";
  const latestConfig = await loadConfig(context.configPath, context.cwd);
  const configuredClient = latestConfig.clients[clientName] ?? {};
  const runtimePaths = resolveLaunchRuntimePaths(context, options);
  const managedRuntime = runtimePaths
    ? undefined
    : await prepareManagedRuntimeImpl(variant, clientRootDir, { fetchImpl });
  const generatedLaunchCommand = runtimePaths
    ? buildLaunchCommand(context, runtimePaths, variant)
    : buildManagedLaunchCommand(context, managedRuntime!.runtimeRootDir, managedRuntime!.versionId, managedRuntime!.gameDir);

  latestConfig.clients[clientName] = {
    ...configuredClient,
    version: variant.minecraftVersion,
    wsPort: options.wsPort ?? configuredClient.wsPort ?? DEFAULT_WS_PORT_BASE,
    server: options.server ?? configuredClient.server ?? "localhost:25565",
    workingDir: path.relative(context.cwd, minecraftDir) || ".",
    env: {
      ...configuredClient.env,
      MCT_CLIENT_MOD_VARIANT: variant.id,
      MCT_CLIENT_MOD_JAR: path.relative(context.cwd, targetJarPath)
    },
    ...(generatedLaunchCommand ? { launchCommand: generatedLaunchCommand } : {})
  };

  await writeConfig(context.configPath, context.cwd, latestConfig);

  return {
    downloaded: true,
    variantId: variant.id,
    minecraftVersion: variant.minecraftVersion,
    loader: variant.loader,
    javaCommand: java.command,
    javaVersion: java.majorVersion,
    clientRootDir,
    minecraftDir,
    modsDir,
    jar: targetJarPath,
    cachePath: artifact.cachePath,
    clientName,
    launchCommandConfigured: Boolean(generatedLaunchCommand),
    runtimeRootDir: managedRuntime?.runtimeRootDir,
    runtimeVersionId: managedRuntime?.versionId
  };
}
