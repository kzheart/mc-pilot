import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { downloadServerJar, resolveServerDownloadSpec } from "./ServerDownloader.js";
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

test("resolveServerDownloadSpec resolves default Paper build", () => {
  const spec = resolveServerDownloadSpec({
    type: "paper",
    version: "1.20.4"
  });

  assert.equal(spec.build, "496");
  assert.equal(spec.fileName, "paper-1.20.4-496.jar");
});

test("resolveServerDownloadSpec resolves vanilla without build metadata", () => {
  const spec = resolveServerDownloadSpec({
    type: "vanilla",
    version: "1.20.3"
  });

  assert.equal(spec.build, "release");
  assert.equal(spec.fileName, "vanilla-1.20.3.jar");
});

test("downloadServerJar writes cache, target jar and config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const cacheRoot = path.join(tempDir, "cache");
  const jarBytes = Buffer.from("paper-jar");

  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");

  try {
    const result = await downloadServerJar(
      createContext(tempDir, configPath),
      {
        type: "paper",
        version: "1.20.4",
        dir: "./runtime-server"
      },
      {
        cacheManager: new CacheManager(cacheRoot),
        fetchImpl: async (url: string | URL | Request) => {
          assert.match(String(url), /paper\/versions\/1.20.4\/builds\/496\/downloads/);
          return new Response(jarBytes, { status: 200 });
        }
      }
    );

    assert.equal(result.version, "1.20.4");
    assert.equal(await readFile(result.cachePath, "utf8"), "paper-jar");
    assert.equal(await readFile(result.jar, "utf8"), "paper-jar");

    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      server: {
        jar: string;
        dir: string;
      };
    };
    assert.equal(config.server.jar, "runtime-server/paper-1.20.4-496.jar");
    assert.equal(config.server.dir, "runtime-server");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadServerJar can resolve vanilla server metadata and persist the jar", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const cacheRoot = path.join(tempDir, "cache");
  const jarBytes = Buffer.from("vanilla-jar");

  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");

  try {
    const result = await downloadServerJar(
      createContext(tempDir, configPath),
      {
        type: "vanilla",
        version: "1.20.3",
        dir: "./runtime-server"
      },
      {
        cacheManager: new CacheManager(cacheRoot),
        fetchImpl: async (url: string | URL | Request) => {
          const text = String(url);
          if (text.includes("version_manifest.json")) {
            return Response.json({
              versions: [{ id: "1.20.3", url: "https://meta.example/1.20.3.json" }]
            });
          }
          if (text === "https://meta.example/1.20.3.json") {
            return Response.json({
              downloads: {
                server: {
                  url: "https://downloads.example/server-1.20.3.jar"
                }
              }
            });
          }
          assert.equal(text, "https://downloads.example/server-1.20.3.jar");
          return new Response(jarBytes, { status: 200 });
        }
      }
    );

    assert.equal(result.type, "vanilla");
    assert.equal(await readFile(result.cachePath, "utf8"), "vanilla-jar");
    assert.equal(await readFile(result.jar, "utf8"), "vanilla-jar");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadServerJar can build spigot via BuildTools and cache the output jar", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-download-"));
  const configPath = path.join(tempDir, "mct.config.json");
  const cacheRoot = path.join(tempDir, "cache");

  await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");

  try {
    const result = await downloadServerJar(
      createContext(tempDir, configPath),
      {
        type: "spigot",
        version: "1.20.3",
        dir: "./runtime-server"
      },
      {
        cacheManager: new CacheManager(cacheRoot),
        fetchImpl: async (url: string | URL | Request) => {
          assert.match(String(url), /BuildTools\.jar$/);
          return new Response(Buffer.from("buildtools"), { status: 200 });
        },
        execFileImpl: async (_command, _args, options) => {
          assert.equal(options?.cwd, path.join(cacheRoot, "server", "spigot", "build", "1.20.3"));
          await mkdir(String(options?.cwd), { recursive: true });
          await writeFile(path.join(String(options?.cwd), "spigot-1.20.3.jar"), "spigot-jar", "utf8");
          return {
            stdout: "",
            stderr: ""
          };
        }
      }
    );

    assert.equal(result.type, "spigot");
    assert.equal(await readFile(result.cachePath, "utf8"), "spigot-jar");
    assert.equal(await readFile(result.jar, "utf8"), "spigot-jar");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
