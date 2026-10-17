import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ModVariant } from "../types.js";
import { prepareManagedFabricRuntime } from "./FabricRuntimeDownloader.js";

const variant: ModVariant = {
  id: "1.20.4-fabric",
  minecraftVersion: "1.20.4",
  loader: "fabric",
  fabricLoaderVersion: "0.16.14",
  support: "ready",
  validation: "verified",
  modVersion: "0.9.1",
};
const versionId = "1.20.4-fabric0.16.14";
const assetIndex = JSON.stringify({
  objects: { "icon.png": { hash: "ab12", size: 8 } },
});

// A loader version inherits the vanilla client jar, stored under the Minecraft version.
async function createCompleteRuntime(root: string) {
  const files: Record<string, string> = {
    "versions/1.20.4/1.20.4.json": JSON.stringify({
      id: "1.20.4",
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      arguments: { game: [], jvm: [] },
      libraries: [
        {
          // The arm64 LWJGL patch records patched libraries with size 0.
          name: "org.lwjgl:lwjgl:3.3.1",
          downloads: {
            artifact: {
              path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
              sha1: "ae58664f88e18a9bb2c77b063833ca7aaec484cb",
              size: 0,
              url: "https://unused.test/lwjgl.jar",
            },
          },
        },
      ],
      assets: "12",
      assetIndex: {
        id: "12",
        sha1: "unused",
        size: Buffer.byteLength(assetIndex),
        url: "https://unused.test/index.json",
      },
      downloads: {
        client: { sha1: "unused", size: 3, url: "https://unused.test/c.jar" },
      },
    }),
    "versions/1.20.4/1.20.4.jar": "jar",
    [`versions/${versionId}/${versionId}.json`]: JSON.stringify({
      id: versionId,
      inheritsFrom: "1.20.4",
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [],
    }),
    "libraries/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar": "lwjgl",
    "assets/indexes/12.json": assetIndex,
    "assets/objects/ab/ab12": "png-data",
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function offline() {
  const state = { requests: 0 };
  return {
    state,
    dependencies: {
      fetchImpl: (async () => {
        state.requests += 1;
        throw new Error("repair-required");
      }) as typeof fetch,
    },
  };
}

async function prepare(
  root: string,
  dependencies: { fetchImpl: typeof fetch },
) {
  return prepareManagedFabricRuntime(
    variant,
    { runtimeRootDir: root, gameDir: path.join(root, "game") },
    dependencies,
  );
}

test("a complete loader runtime without a ready marker is reused offline", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-runtime-complete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createCompleteRuntime(root);
  const { state, dependencies } = offline();

  const prepared = await prepare(root, dependencies);

  assert.equal(prepared.versionId, versionId);
  assert.equal(state.requests, 0);
  assert.equal(
    await readFile(path.join(root, `.ready-${versionId}`), "utf8"),
    versionId,
  );
});

test("a corrupt asset index of the expected size is repaired, not thrown", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-runtime-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createCompleteRuntime(root);
  await writeFile(
    path.join(root, "assets/indexes/12.json"),
    "x".repeat(Buffer.byteLength(assetIndex)),
  );
  const { state, dependencies } = offline();

  await assert.rejects(prepare(root, dependencies), /repair-required/);
  assert.equal(state.requests, 1);
});

for (const scenario of [
  {
    name: "a missing asset",
    damage: (root: string) => rm(path.join(root, "assets/objects/ab/ab12")),
  },
  {
    name: "a truncated asset",
    damage: (root: string) =>
      writeFile(path.join(root, "assets/objects/ab/ab12"), "png"),
  },
  {
    name: "a missing client jar",
    damage: (root: string) => rm(path.join(root, "versions/1.20.4/1.20.4.jar")),
  },
]) {
  test(`a ready marker does not hide ${scenario.name}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mct-runtime-marker-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await createCompleteRuntime(root);
    await writeFile(path.join(root, `.ready-${versionId}`), versionId);
    await scenario.damage(root);
    const { state, dependencies } = offline();

    await assert.rejects(prepare(root, dependencies), /repair-required/);
    assert.equal(state.requests, 1);
  });
}
