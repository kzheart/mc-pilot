import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { MinecraftFolder, Version } from "@xmcl/core";
import { getVersionList, installDependencies, installFabric, installVersion } from "@xmcl/installer";
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
    timeout: 30_000
  },
  connections: 2
}).compose(
  interceptors.retry({
    maxRetries: 4,
    minTimeout: 500,
    maxTimeout: 5_000
  }),
  interceptors.redirect({
    maxRedirections: 5
  })
);

async function fetchWithRetry(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1], attempts = 4) {
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

export async function prepareManagedFabricRuntime(
  variant: ModVariant,
  runtimeOptions: PrepareFabricRuntimeOptions,
  dependencies: PrepareFabricRuntimeDependencies = {}
): Promise<PreparedFabricRuntime> {
  const fetchImpl = dependencies.fetchImpl ?? fetchWithRetry;
  const loaderVersion = variant.fabricLoaderVersion;
  if (!loaderVersion) {
    throw new MctError(
      {
        code: "VARIANT_NOT_BUILDABLE",
        message: `Variant ${variant.id} does not define a Fabric loader version`
      },
      4
    );
  }

  const { runtimeRootDir, gameDir } = runtimeOptions;
  await mkdir(runtimeRootDir, { recursive: true });
  await mkdir(gameDir, { recursive: true });

  const minecraft = new MinecraftFolder(runtimeRootDir);
  const versionList = await getVersionList({ fetch: fetchImpl });
  const versionMeta = versionList.versions.find((entry) => entry.id === variant.minecraftVersion);
  if (!versionMeta) {
    throw new MctError(
      {
        code: "UNSUPPORTED_VERSION",
        message: `Minecraft ${variant.minecraftVersion} metadata was not found`
      },
      4
    );
  }

  await installVersion(versionMeta, minecraft, {
    side: "client",
    dispatcher: DOWNLOAD_DISPATCHER
  });
  const versionId = await installFabric({
    minecraftVersion: variant.minecraftVersion,
    version: loaderVersion,
    minecraft,
    side: "client",
    fetch: fetchImpl
  });
  const resolvedVersion = await Version.parse(minecraft, versionId);
  await installDependencies(resolvedVersion, {
    side: "client",
    dispatcher: DOWNLOAD_DISPATCHER,
    assetsDownloadConcurrency: 2,
    librariesDownloadConcurrency: 2
  });

  await applyArm64LwjglPatch(runtimeRootDir, versionId, { fetchImpl });

  return {
    runtimeRootDir,
    gameDir,
    versionId
  };
}
