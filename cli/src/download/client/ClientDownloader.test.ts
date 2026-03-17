import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const buildDir = path.join(tempDir, "client-mod", "build", "libs");
  const jarPath = path.join(buildDir, "mct-client-mod-1.20.4-fabric.jar");

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
        prismRoot: "/Applications/PrismLauncher",
        instanceId: "mct-1.20.4-fabric"
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
    assert.equal(result.modsDir, path.join(tempDir, "downloaded-client", "mods"));

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
    assert.equal(config.clients.default.wsPort, 25560);
    assert.equal(config.clients.default.server, "localhost:25565");
    assert.equal(config.clients.default.workingDir, "downloaded-client/minecraft");
    assert.equal(config.clients.default.env.MCT_CLIENT_MOD_VARIANT, "1.20.4-fabric");
    assert.equal(config.clients.default.launchCommand[0], "node");
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
