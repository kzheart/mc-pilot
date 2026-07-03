import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { MinecraftFolder, Version } from "@xmcl/core";
import {
  getVersionList,
  installDependencies,
  installFabric,
  installForge,
  installVersion,
} from "@xmcl/installer";
import { Agent, interceptors } from "undici";

import { MctError } from "../../util/errors.js";
import type { ModVariant } from "../types.js";
import { applyArm64LwjglPatch } from "./Arm64LwjglPatcher.js";

export interface PrepareFabricRuntimeDependencies {
  fetchImpl?: typeof fetch;
}

export interface PreparedFabricRuntime {
  runtimeRootDir: string;
  gameDir: string;
  versionId: string;
}

const DOWNLOAD_DISPATCHER = new Agent({
  connect: {
    timeout: 30_000,
  },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
  connections: 8,
  pipelining: 0,
}).compose(
  interceptors.retry({
    maxRetries: 4,
    minTimeout: 500,
    maxTimeout: 5_000,
  }),
  interceptors.redirect({
    maxRedirections: 5,
  }),
);

async function fetchWithRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  attempts = 4,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) {
        return response;
      }

      if (response.status >= 500 && attempt < attempts) {
        await sleep(attempt * 500);
        continue;
      }

      return response;
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

export interface PrepareFabricRuntimeOptions {
  runtimeRootDir: string;
  gameDir: string;
}

type LoaderInstaller = (
  minecraft: MinecraftFolder,
  fetchImpl: typeof fetch,
) => Promise<string>;

async function fileExists(filePath: string, expectedSize?: number) {
  try {
    const fileStat = await stat(filePath);
    return (
      expectedSize === undefined ||
      expectedSize < 0 ||
      fileStat.size === expectedSize
    );
  } catch {
    return false;
  }
}

async function isManagedRuntimeComplete(
  runtimeRootDir: string,
  expectedVersionId: string,
) {
  const minecraft = new MinecraftFolder(runtimeRootDir);
  let version: Awaited<ReturnType<typeof Version.parse>>;
  try {
    version = await Version.parse(minecraft, expectedVersionId);
  } catch {
    return false;
  }

  if (version.downloads?.client) {
    const versionJar = path.join(
      runtimeRootDir,
      "versions",
      version.id,
      `${version.id}.jar`,
    );
    if (!(await fileExists(versionJar, version.downloads.client.size))) {
      return false;
    }
  }

  for (const library of version.libraries) {
    const libraryPath = path.join(
      runtimeRootDir,
      "libraries",
      library.download.path,
    );
    if (!(await fileExists(libraryPath, library.download.size))) {
      return false;
    }
  }

  const assetIndex = version.assetIndex;
  if (assetIndex) {
    const assetIndexId = assetIndex.id || assetIndex.sha1;
    const assetIndexPath = path.join(
      runtimeRootDir,
      "assets",
      "indexes",
      `${assetIndexId}.json`,
    );
    if (!(await fileExists(assetIndexPath, assetIndex.size))) {
      return false;
    }
    const { objects } = JSON.parse(await readFile(assetIndexPath, "utf8")) as {
      objects?: Record<string, { hash: string; size?: number }>;
    };
    if (!objects) {
      return false;
    }
    for (const asset of Object.values(objects)) {
      const assetPath = path.join(
        runtimeRootDir,
        "assets",
        "objects",
        asset.hash.slice(0, 2),
        asset.hash,
      );
      if (!(await fileExists(assetPath, asset.size))) {
        return false;
      }
    }
  }

  const logConfig = version.logging?.client?.file;
  if (logConfig) {
    const logConfigPath = path.join(
      runtimeRootDir,
      "assets",
      "log_configs",
      logConfig.id,
    );
    if (!(await fileExists(logConfigPath, logConfig.size))) {
      return false;
    }
  }

  const nativesDir = path.join(
    runtimeRootDir,
    "versions",
    expectedVersionId,
    `${expectedVersionId}-natives`,
  );
  if (!(await fileExists(nativesDir))) {
    await mkdir(nativesDir, { recursive: true });
  }

  return true;
}

async function prepareManagedRuntime(
  variant: ModVariant,
  runtimeOptions: PrepareFabricRuntimeOptions,
  dependencies: PrepareFabricRuntimeDependencies,
  expectedVersionId: string,
  installLoader: LoaderInstaller,
): Promise<PreparedFabricRuntime> {
  const fetchImpl = dependencies.fetchImpl ?? fetchWithRetry;
  const { runtimeRootDir, gameDir } = runtimeOptions;
  await mkdir(runtimeRootDir, { recursive: true });
  await mkdir(gameDir, { recursive: true });

  const readyMarker = path.join(runtimeRootDir, `.ready-${expectedVersionId}`);

  try {
    await access(readyMarker);
    // Runtime already prepared, skip download
    return { runtimeRootDir, gameDir, versionId: expectedVersionId };
  } catch {
    // Not ready, proceed with download
  }

  if (await isManagedRuntimeComplete(runtimeRootDir, expectedVersionId)) {
    await writeFile(readyMarker, new Date().toISOString(), "utf8");
    return { runtimeRootDir, gameDir, versionId: expectedVersionId };
  }

  const minecraft = new MinecraftFolder(runtimeRootDir);
  const versionList = await getVersionList({ fetch: fetchImpl });
  const versionMeta = versionList.versions.find(
    (entry) => entry.id === variant.minecraftVersion,
  );
  if (!versionMeta) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Minecraft ${variant.minecraftVersion} metadata was not found`,
      },
      4,
    );
  }

  await installVersion(versionMeta, minecraft, {
    side: "client",
    dispatcher: DOWNLOAD_DISPATCHER,
  });
  const installedVersionId = await installLoader(minecraft, fetchImpl);
  const resolvedVersion = await Version.parse(minecraft, installedVersionId);
  await installDependencies(resolvedVersion, {
    side: "client",
    dispatcher: DOWNLOAD_DISPATCHER,
    assetsDownloadConcurrency: 8,
    librariesDownloadConcurrency: 4,
  });

  await applyArm64LwjglPatch(runtimeRootDir, installedVersionId, { fetchImpl });
  await mkdir(minecraft.getNativesRoot(installedVersionId), {
    recursive: true,
  });
  await writeFile(readyMarker, new Date().toISOString(), "utf8");

  return {
    runtimeRootDir,
    gameDir,
    versionId: installedVersionId,
  };
}

export async function prepareManagedFabricRuntime(
  variant: ModVariant,
  runtimeOptions: PrepareFabricRuntimeOptions,
  dependencies: PrepareFabricRuntimeDependencies = {},
): Promise<PreparedFabricRuntime> {
  const loaderVersion = variant.fabricLoaderVersion;
  if (!loaderVersion) {
    throw new MctError(
      {
        code: "VARIANT_NOT_BUILDABLE",
        message: `Variant ${variant.id} does not define a Fabric loader version`,
      },
      4,
    );
  }

  return prepareManagedRuntime(
    variant,
    runtimeOptions,
    dependencies,
    `${variant.minecraftVersion}-fabric${loaderVersion}`,
    (minecraft, fetchImpl) =>
      installFabric({
        minecraftVersion: variant.minecraftVersion,
        version: loaderVersion,
        minecraft,
        side: "client",
        fetch: fetchImpl,
      }),
  );
}

export async function prepareManagedForgeRuntime(
  variant: ModVariant,
  runtimeOptions: PrepareFabricRuntimeOptions,
  dependencies: PrepareFabricRuntimeDependencies = {},
): Promise<PreparedFabricRuntime> {
  const forgeVersion = variant.forgeVersion;
  if (!forgeVersion) {
    throw new MctError(
      {
        code: "VARIANT_NOT_BUILDABLE",
        message: `Variant ${variant.id} does not define a Forge version`,
      },
      4,
    );
  }

  return prepareManagedRuntime(
    variant,
    runtimeOptions,
    dependencies,
    `${variant.minecraftVersion}-forge-${forgeVersion}`,
    (minecraft) =>
      installForge(
        {
          mcversion: variant.minecraftVersion,
          version: forgeVersion,
        },
        minecraft,
        {
          side: "client",
          dispatcher: DOWNLOAD_DISPATCHER,
        },
      ),
  );
}

export async function prepareManagedClientRuntime(
  variant: ModVariant,
  runtimeOptions: PrepareFabricRuntimeOptions,
  dependencies: PrepareFabricRuntimeDependencies = {},
): Promise<PreparedFabricRuntime> {
  if (variant.loader === "fabric") {
    return prepareManagedFabricRuntime(variant, runtimeOptions, dependencies);
  }
  if (variant.loader === "forge") {
    return prepareManagedForgeRuntime(variant, runtimeOptions, dependencies);
  }

  throw new MctError(
    {
      code: "UNSUPPORTED_LOADER",
      message: `Loader ${variant.loader} is not implemented yet`,
    },
    4,
  );
}
