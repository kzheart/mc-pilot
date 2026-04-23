import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { downloadClientModToDir } from "./ClientDownloader.js";
import { CacheManager } from "../CacheManager.js";
import type { ModVariant } from "../types.js";

test("downloadClientModToDir copies a local variant jar to target dir", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.4", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.4.jar");
  const targetDir = path.join(tempDir, "client-instance");

  await mkdir(buildDir, { recursive: true });
  await writeFile(jarPath, "mod-jar", "utf8");

  try {
    const result = await downloadClientModToDir(
      tempDir,
      targetDir,
      {
        version: "1.20.4",
        loader: "fabric",
        instanceDir: "./runtime/instances/mct-1.20.4-fabric",
        metaDir: "./runtime/meta",
        librariesDir: "./runtime/libraries",
        assetsDir: "./runtime/assets"
      },
      {
        cacheManager: new CacheManager(path.join(tempDir, "cache")),
        detectJavaImpl: async () => ({
          available: true,
          command: "java",
          majorVersion: 17
        })
      }
    );

    assert.equal(result.variantId, "1.20.4-fabric");
    assert.equal(await readFile(result.jar, "utf8"), "mod-jar");
    assert.equal(result.javaVersion, 17);
    assert.equal(result.minecraftDir, path.join(targetDir, "minecraft"));
    assert.equal(result.modsDir, path.join(targetDir, "minecraft", "mods"));
    assert.ok(result.launchArgs.length > 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientModToDir prepares a self-managed runtime", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.2", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.2.jar");
  const targetDir = path.join(tempDir, "client-instance");
  const fabricVersionId = "fabric-loader-0.16.14-1.20.2";

  await mkdir(buildDir, { recursive: true });
  await writeFile(jarPath, "mod-jar-1202", "utf8");

  try {
    const result = await downloadClientModToDir(
      tempDir,
      targetDir,
      {
        version: "1.20.2",
        loader: "fabric"
      },
      {
        cacheManager: new CacheManager(path.join(tempDir, "cache")),
        detectJavaImpl: async () => ({
          available: true,
          command: "java",
          majorVersion: 17
        }),
        prepareManagedRuntimeImpl: async (_variant: ModVariant, runtimeOptions: { runtimeRootDir: string; gameDir: string }) => {
          const { runtimeRootDir, gameDir } = runtimeOptions;
          await mkdir(path.join(runtimeRootDir, "versions", fabricVersionId), { recursive: true });
          return {
            runtimeRootDir,
            gameDir,
            versionId: fabricVersionId
          };
        }
      }
    );

    assert.equal(result.runtimeRootDir, path.join(tempDir, "cache", "client", "runtime", "1.20.2"));
    assert.equal(result.runtimeVersionId, fabricVersionId);
    assert.equal(await readFile(result.jar, "utf8"), "mod-jar-1202");
    assert.equal(result.launchArgs[0], "--runtime-root");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientModToDir prepares a Forge runtime", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.4-forge", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-forge-1.20.4.jar");
  const targetDir = path.join(tempDir, "client-instance");
  const forgeVersionId = "1.20.4-forge-49.0.49";

  await mkdir(buildDir, { recursive: true });
  await writeFile(jarPath, "forge-mod-jar", "utf8");

  try {
    const result = await downloadClientModToDir(
      tempDir,
      targetDir,
      {
        version: "1.20.4",
        loader: "forge"
      },
      {
        cacheManager: new CacheManager(path.join(tempDir, "cache")),
        detectJavaImpl: async () => ({
          available: true,
          command: "java",
          majorVersion: 17
        }),
        prepareManagedRuntimeImpl: async (variant: ModVariant, runtimeOptions: { runtimeRootDir: string; gameDir: string }) => {
          assert.equal(variant.id, "1.20.4-forge");
          const { runtimeRootDir, gameDir } = runtimeOptions;
          await mkdir(path.join(runtimeRootDir, "versions", forgeVersionId), { recursive: true });
          return {
            runtimeRootDir,
            gameDir,
            versionId: forgeVersionId
          };
        }
      }
    );

    assert.equal(result.variantId, "1.20.4-forge");
    assert.equal(result.loader, "forge");
    assert.equal(result.runtimeVersionId, forgeVersionId);
    assert.equal(await readFile(result.jar, "utf8"), "forge-mod-jar");
    assert.deepEqual(result.launchArgs.slice(0, 2), ["--runtime-root", path.join(tempDir, "cache", "client", "runtime", "1.20.4")]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientModToDir rejects missing local build artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));

  try {
    await assert.rejects(
      downloadClientModToDir(tempDir, path.join(tempDir, "client"), {
        version: "1.20.4",
        loader: "fabric"
      }, {
        cacheManager: new CacheManager(path.join(tempDir, "cache")),
        detectJavaImpl: async () => ({
          available: true,
          command: "java",
          majorVersion: 17
        })
      }),
      {
        name: "MctError",
        code: "ARTIFACT_NOT_FOUND"
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientModToDir rejects partial client runtime directory configuration", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.4", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.4.jar");

  await mkdir(buildDir, { recursive: true });
  await writeFile(jarPath, "mod-jar", "utf8");

  try {
    await assert.rejects(
      downloadClientModToDir(
        tempDir,
        path.join(tempDir, "client"),
        {
          version: "1.20.4",
          loader: "fabric",
          instanceDir: "./runtime/instances/mct-1.20.4-fabric"
        },
        {
          cacheManager: new CacheManager(path.join(tempDir, "cache")),
          detectJavaImpl: async () => ({
            available: true,
            command: "java",
            majorVersion: 17
          })
        }
      ),
      {
        name: "MctError",
        code: "INVALID_PARAMS"
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientModToDir rejects missing Java runtime", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));

  try {
    await assert.rejects(
      downloadClientModToDir(tempDir, path.join(tempDir, "client"), {
        version: "1.20.4",
        loader: "fabric"
      }, {
        detectJavaImpl: async () => ({
          available: false,
          command: "java"
        })
      }),
      {
        name: "MctError",
        code: "JAVA_NOT_FOUND"
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
