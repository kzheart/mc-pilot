import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { downloadServerJarToCache, resolveServerDownloadSpec } from "./ServerDownloader.js";
import { CacheManager } from "../CacheManager.js";

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

test("downloadServerJarToCache downloads to cache", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-download-"));
  const cacheRoot = path.join(tempDir, "cache");
  const jarBytes = Buffer.from("paper-jar");

  try {
    const result = await downloadServerJarToCache(
      {
        type: "paper",
        version: "1.20.4"
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadServerJarToCache can resolve vanilla server metadata", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-download-"));
  const cacheRoot = path.join(tempDir, "cache");
  const jarBytes = Buffer.from("vanilla-jar");

  try {
    const result = await downloadServerJarToCache(
      {
        type: "vanilla",
        version: "1.20.3"
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadServerJarToCache can build spigot via BuildTools", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-server-download-"));
  const cacheRoot = path.join(tempDir, "cache");

  try {
    const result = await downloadServerJarToCache(
      {
        type: "spigot",
        version: "1.20.3"
      },
      {
        cacheManager: new CacheManager(cacheRoot),
        fetchImpl: async (url: string | URL | Request) => {
          assert.match(String(url), /BuildTools\.jar$/);
          return new Response(Buffer.from("buildtools"), { status: 200 });
        },
        execFileImpl: async (_command: string, _args: string[], options: { cwd?: string }) => {
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
