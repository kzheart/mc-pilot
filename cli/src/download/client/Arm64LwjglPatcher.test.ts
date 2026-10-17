import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyArm64LwjglPatch, needsArm64Patch } from "./Arm64LwjglPatcher.js";

const PATCH_PATHS = [
  "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
  "org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar",
  "org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar",
  "org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar",
  "org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar",
  "org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar",
  "org/glavo/hmcl/mmachina/lwjgl-glfw/3.3.1-mmachina.1/lwjgl-glfw-3.3.1-mmachina.1.jar",
  "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-macos-arm64.jar",
  "org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1-natives-macos-arm64.jar",
  "org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-macos-arm64.jar",
  "org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-macos-arm64.jar",
  "org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1-natives-macos-arm64.jar",
  "org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1-natives-macos-arm64.jar",
  "org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-macos-arm64.jar",
];

async function createLwjgl32Runtime(root: string) {
  const versionJson = path.join(root, "versions", "1.18.2", "1.18.2.json");
  await mkdir(path.dirname(versionJson), { recursive: true });
  const content = JSON.stringify({
    id: "1.18.2",
    libraries: [
      {
        name: "org.lwjgl:lwjgl:3.2.2",
        downloads: {
          artifact: { path: "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar" },
        },
      },
    ],
  });
  await writeFile(versionJson, content);
  return { versionJson, content };
}

for (const scenario of [
  { name: "re-downloads truncated cached LWJGL jars", truncatedCache: true },
  {
    name: "fails instead of skipping LWJGL jars it cannot download",
    truncatedCache: false,
  },
]) {
  test(
    `applyArm64LwjglPatch ${scenario.name}`,
    { skip: !needsArm64Patch() },
    async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "mct-arm64-lwjgl-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const { versionJson, content } = await createLwjgl32Runtime(root);
      if (scenario.truncatedCache) {
        for (const relative of PATCH_PATHS) {
          const library = path.join(root, "libraries", relative);
          await mkdir(path.dirname(library), { recursive: true });
          await writeFile(library, "PK\u0003\u0004truncated");
        }
      }
      const requests: string[] = [];
      await assert.rejects(
        applyArm64LwjglPatch(root, "1.18.2", {
          fetchImpl: (async (url) => {
            requests.push(String(url));
            return new Response("unavailable", { status: 503 });
          }) as typeof fetch,
        }),
        /HTTP 503/,
      );
      assert.ok(
        requests.length > 0,
        "cached jars must be verified, not trusted by existence",
      );
      assert.equal(
        await readFile(versionJson, "utf8"),
        content,
        "the version must not be switched to LWJGL jars that are not installed",
      );
    },
  );
}
