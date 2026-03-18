import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { downloadClientMod } from "./ClientDownloader.js";
import { StateStore } from "../../util/state.js";
import type { CommandContext } from "../../util/context.js";
import { CacheManager } from "../CacheManager.js";

function createContext(cwd: string, configPath: string): CommandContext {
  return {
    cwd,
    configPath,
    config: {
      server: {
        dir: "./server",
        port: 25565,
        jvmArgs: []
      },
      clients: {},
      screenshot: {
        outputDir: "./screenshots"
      },
      timeout: {
        serverReady: 120,
        clientReady: 60,
        default: 10
      }
    },
    state: new StateStore(path.join(cwd, ".mct-state")),
    outputMode: "json"
  };
}

test("downloadClientMod copies a local variant jar and writes client config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.4", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.4.jar");

  await mkdir(buildDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");
  await writeFile(jarPath, "mod-jar", "utf8");

  try {
    const result = await downloadClientMod(
      createContext(tempDir, configPath),
      {
        version: "1.20.4",
        loader: "fabric",
        dir: "./downloaded-client",
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
    assert.equal(result.clientRootDir, path.join(tempDir, "downloaded-client"));
    assert.equal(result.minecraftDir, path.join(tempDir, "downloaded-client", "minecraft"));
    assert.equal(result.modsDir, path.join(tempDir, "downloaded-client", "minecraft", "mods"));

    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      clients: Record<string, {
        version: string;
        wsPort: number;
        server: string;
        workingDir: string;
        env: Record<string, string>;
        launchCommand: string[];
      }>;
    };
    assert.equal(config.clients.default.version, "1.20.4");
    assert.equal(config.clients.default.wsPort, 25580);
    assert.equal(config.clients.default.server, "localhost:25565");
    assert.equal(config.clients.default.workingDir, "downloaded-client/minecraft");
    assert.equal(config.clients.default.env.MCT_CLIENT_MOD_VARIANT, "1.20.4-fabric");
    assert.equal(config.clients.default.env.MCT_CLIENT_MOD_JAR, "downloaded-client/minecraft/mods/mct-client-mod-fabric-1.20.4.jar");
    assert.equal(config.clients.default.launchCommand[0], process.execPath);
    assert.equal(config.clients.default.launchCommand[1], path.join(tempDir, "scripts", "launch-fabric-client.mjs"));
    assert.deepEqual(config.clients.default.launchCommand.slice(2, 10), [
      "--instance-dir",
      path.join(tempDir, "runtime", "instances", "mct-1.20.4-fabric"),
      "--meta-dir",
      path.join(tempDir, "runtime", "meta"),
      "--libraries-dir",
      path.join(tempDir, "runtime", "libraries"),
      "--assets-dir",
      path.join(tempDir, "runtime", "assets")
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientMod prepares a self-managed runtime when no external runtime directories are provided", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.2", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.2.jar");

  await mkdir(buildDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");
  await writeFile(jarPath, "mod-jar-1202", "utf8");

  const fabricVersionId = "fabric-loader-0.16.10-1.20.2";

  try {
    const result = await downloadClientMod(
      createContext(tempDir, configPath),
      {
        version: "1.20.2",
        loader: "fabric",
        dir: "./managed-client",
        name: "managed"
      },
      {
        cacheManager: new CacheManager(path.join(tempDir, "cache")),
        detectJavaImpl: async () => ({
          available: true,
          command: "java",
          majorVersion: 17
        }),
        prepareManagedRuntimeImpl: async (_variant, clientRootDir) => {
          const runtimeRootDir = path.join(clientRootDir, "runtime");
          const gameDir = path.join(clientRootDir, "minecraft");
          await mkdir(path.join(runtimeRootDir, "versions", fabricVersionId), { recursive: true });
          await mkdir(path.join(runtimeRootDir, "libraries", "com", "example", "vanilla-lib", "1.0.0"), { recursive: true });
          await writeFile(
            path.join(runtimeRootDir, "versions", fabricVersionId, `${fabricVersionId}.json`),
            JSON.stringify({ id: fabricVersionId }, null, 2),
            "utf8"
          );
          await writeFile(
            path.join(runtimeRootDir, "libraries", "com", "example", "vanilla-lib", "1.0.0", "vanilla-lib-1.0.0.jar"),
            "vanilla-lib",
            "utf8"
          );
          return {
            runtimeRootDir,
            gameDir,
            versionId: fabricVersionId
          };
        }
      }
    );

    assert.equal(result.runtimeRootDir, path.join(tempDir, "managed-client", "runtime"));
    assert.equal(result.runtimeVersionId, fabricVersionId);
    assert.equal(await readFile(result.jar, "utf8"), "mod-jar-1202");

    const fabricJsonPath = path.join(tempDir, "managed-client", "runtime", "versions", fabricVersionId, `${fabricVersionId}.json`);
    const fabricJson = JSON.parse(await readFile(fabricJsonPath, "utf8")) as { id: string };
    assert.equal(fabricJson.id, fabricVersionId);
    assert.equal(await readFile(path.join(tempDir, "managed-client", "runtime", "libraries", "com", "example", "vanilla-lib", "1.0.0", "vanilla-lib-1.0.0.jar"), "utf8"), "vanilla-lib");

    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      clients: Record<string, { launchCommand: string[]; workingDir: string }>;
    };
    assert.equal(config.clients.managed.launchCommand[0], process.execPath);
    assert.equal(config.clients.managed.launchCommand[2], "--runtime-root");
    assert.equal(config.clients.managed.launchCommand[3], result.runtimeRootDir);
    assert.equal(config.clients.managed.launchCommand[4], "--version-id");
    assert.equal(config.clients.managed.launchCommand[5], fabricVersionId);
    assert.equal(config.clients.managed.workingDir, "managed-client/minecraft");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientMod can resolve and configure the 1.20.1 fabric variant", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.1", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.1.jar");

  await mkdir(buildDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");
  await writeFile(jarPath, "mod-jar-1201", "utf8");

  try {
    const result = await downloadClientMod(
      createContext(tempDir, configPath),
      {
        version: "1.20.1",
        loader: "fabric",
        dir: "./downloaded-client-1201",
        name: "legacy",
        wsPort: 26660,
        server: "mc.example.net:25570",
        instanceDir: "./runtime/instances/mct-1.20.1-fabric",
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

    assert.equal(result.variantId, "1.20.1-fabric");
    assert.equal(await readFile(result.jar, "utf8"), "mod-jar-1201");

    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      clients: Record<string, {
        version: string;
        wsPort: number;
        server: string;
        env: Record<string, string>;
      }>;
    };

    assert.equal(config.clients.legacy.version, "1.20.1");
    assert.equal(config.clients.legacy.wsPort, 26660);
    assert.equal(config.clients.legacy.server, "mc.example.net:25570");
    assert.equal(config.clients.legacy.env.MCT_CLIENT_MOD_VARIANT, "1.20.1-fabric");
    assert.equal(config.clients.legacy.env.MCT_CLIENT_MOD_JAR, "downloaded-client-1201/minecraft/mods/mct-client-mod-fabric-1.20.1.jar");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadClientMod rejects missing local build artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const configPath = path.join(tempDir, "mct.config.json");

  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");

  try {
    await assert.rejects(
      downloadClientMod(createContext(tempDir, configPath), {
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

test("downloadClientMod rejects partial client runtime directory configuration", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const buildDir = path.join(tempDir, "client-mod", "version-1.20.4", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-fabric-1.20.4.jar");

  await mkdir(buildDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");
  await writeFile(jarPath, "mod-jar", "utf8");

  try {
    await assert.rejects(
      downloadClientMod(
        createContext(tempDir, configPath),
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

test("downloadClientMod rejects missing Java runtime", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-download-"));
  const configPath = path.join(tempDir, "mct.config.json");

  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");

  try {
    await assert.rejects(
      downloadClientMod(createContext(tempDir, configPath), {
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
