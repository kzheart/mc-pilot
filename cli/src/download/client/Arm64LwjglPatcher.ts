import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MinecraftFolder } from "@xmcl/core";

const LWJGL_ARM64_PATCH = {
  patchVersion: "3.3.1",
  jars: {
    "org.lwjgl:lwjgl": { path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar", sha1: "ae58664f88e18a9bb2c77b063833ca7aaec484cb", size: 0 },
    "org.lwjgl:lwjgl-jemalloc": { path: "org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar", sha1: "a817bcf213db49f710603677457567c37d53e103", size: 0 },
    "org.lwjgl:lwjgl-openal": { path: "org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar", sha1: "2623a6b8ae1dfcd880738656a9f0243d2e6840bd", size: 0 },
    "org.lwjgl:lwjgl-opengl": { path: "org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar", sha1: "831a5533a21a5f4f81bbc51bb13e9899319b5411", size: 0 },
    "org.lwjgl:lwjgl-stb": { path: "org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar", sha1: "b119297cf8ed01f247abe8685857f8e7fcf5980f", size: 0 },
    "org.lwjgl:lwjgl-tinyfd": { path: "org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar", url: "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar", sha1: "0ff1914111ef2e3e0110ef2dabc8d8cdaad82347", size: 0 },
    "org.lwjgl:lwjgl-glfw": { path: "org/glavo/hmcl/mmachina/lwjgl-glfw/3.3.1-mmachina.1/lwjgl-glfw-3.3.1-mmachina.1.jar", url: "https://repo1.maven.org/maven2/org/glavo/hmcl/mmachina/lwjgl-glfw/3.3.1-mmachina.1/lwjgl-glfw-3.3.1-mmachina.1.jar", sha1: "e9a101bca4fa30d26b21b526ff28e7c2d8927f1b", size: 0 }
  },
  natives: {
    "org.lwjgl:lwjgl": { path: "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-macos-arm64.jar", sha1: "71d0d5e469c9c95351eb949064497e3391616ac9", size: 0 },
    "org.lwjgl:lwjgl-jemalloc": { path: "org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1-natives-macos-arm64.jar", sha1: "e577b87d8ad2ade361aaea2fcf226c660b15dee8", size: 0 },
    "org.lwjgl:lwjgl-openal": { path: "org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-macos-arm64.jar", sha1: "23d55e7490b57495320f6c9e1936d78fd72c4ef8", size: 0 },
    "org.lwjgl:lwjgl-opengl": { path: "org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-macos-arm64.jar", sha1: "eafe34b871d966292e8db0f1f3d6b8b110d4e91d", size: 0 },
    "org.lwjgl:lwjgl-stb": { path: "org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1-natives-macos-arm64.jar", sha1: "fcf073ed911752abdca5f0b00a53cfdf17ff8e8b", size: 0 },
    "org.lwjgl:lwjgl-tinyfd": { path: "org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1-natives-macos-arm64.jar", sha1: "972ecc17bad3571e81162153077b4d47b7b9eaa9", size: 0 },
    "org.lwjgl:lwjgl-glfw": { path: "org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-macos-arm64.jar", url: "https://libraries.minecraft.net/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-macos-arm64.jar", sha1: "cac0d3f712a3da7641fa174735a5f315de7ffe0a", size: 0 }
  }
} as const;

type PatchEntry = { path: string; url: string; sha1: string; size: number };

export interface Arm64PatchDependencies {
  fetchImpl?: typeof fetch;
}

export function needsArm64Patch() {
  return os.arch() === "arm64" && os.platform() === "darwin";
}

async function downloadJar(entry: PatchEntry, minecraft: MinecraftFolder, fetchImpl: typeof fetch) {
  const localPath = minecraft.getLibraryByPath(entry.path);
  try {
    await access(localPath);
    return localPath;
  } catch {
    console.error(`[MCT]   Downloading ${path.basename(entry.path)}...`);
    const response = await fetchImpl(entry.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${entry.url}`);
    }
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
    return localPath;
  }
}

export async function applyArm64LwjglPatch(
  runtimeRoot: string,
  versionId: string,
  dependencies: Arm64PatchDependencies = {}
): Promise<string | null> {
  if (!needsArm64Patch()) {
    return null;
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const minecraft = MinecraftFolder.from(runtimeRoot);
  const nativesDir = minecraft.getNativesRoot(versionId);

  // Walk version JSON chain to detect old LWJGL 3.2.x
  let targetJsonPath = minecraft.getVersionJson(versionId);
  let needsJsonPatch = false;
  for (let depth = 0; depth < 5; depth++) {
    const raw = await readFile(targetJsonPath, "utf-8").catch(() => null);
    if (!raw) { break; }
    const json = JSON.parse(raw);
    if ((json.libraries || []).some((lib: { name?: string }) => lib.name?.startsWith("org.lwjgl:lwjgl:3.2"))) {
      needsJsonPatch = true;
      break;
    }
    if ((json.libraries || []).some((lib: { name?: string }) => lib.name?.startsWith("org.lwjgl:lwjgl:3.3"))) {
      break;
    }
    if (!json.inheritsFrom) { break; }
    targetJsonPath = minecraft.getVersionJson(json.inheritsFrom);
  }

  if (!needsJsonPatch) {
    return null;
  }

  console.error("[MCT] Applying LWJGL 3.3.1 arm64 patch (based on HMCL NativePatcher)...");

  const { open, walkEntriesGenerator, openEntryReadStream } = await import("@xmcl/unzip");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream");
  const { promisify } = await import("node:util");
  const pipelineAsync = promisify(pipeline);

  // 1. Download and extract arm64 natives
  await mkdir(nativesDir, { recursive: true });
  for (const [libKey, entry] of Object.entries(LWJGL_ARM64_PATCH.natives)) {
    const localJar = await downloadJar(entry, minecraft, fetchImpl).catch((e) => { console.error(`[MCT]   Skip ${libKey}: ${(e as Error).message}`); return null; });
    if (!localJar) { continue; }
    const zip = await open(localJar, { lazyEntries: true, autoClose: false });
    for await (const zipEntry of walkEntriesGenerator(zip)) {
      const name = zipEntry.fileName;
      if (!name.endsWith(".dylib") || name.endsWith("/")) { continue; }
      const dest = path.join(nativesDir, path.basename(name));
      await pipelineAsync(await openEntryReadStream(zip, zipEntry), createWriteStream(dest));
    }
  }

  // 2. Download Java JARs
  for (const [libKey, entry] of Object.entries(LWJGL_ARM64_PATCH.jars)) {
    await downloadJar(entry, minecraft, fetchImpl).catch((e) => console.error(`[MCT]   Skip ${libKey}: ${(e as Error).message}`));
  }

  // 3. Patch vanilla version JSON to swap LWJGL 3.2.x -> 3.3.1
  let curJsonPath = minecraft.getVersionJson(versionId);
  for (let depth = 0; depth < 5; depth++) {
    const raw = await readFile(curJsonPath, "utf-8").catch(() => null);
    if (!raw) { break; }
    const json = JSON.parse(raw);
    const hasOldLwjgl = (json.libraries || []).some(
      (lib: { name?: string }) => lib.name?.startsWith("org.lwjgl:lwjgl:3.2")
    );
    if (hasOldLwjgl) {
      const newLibraries = [];
      for (const lib of json.libraries) {
        const name = lib.name || "";
        const parts = name.split(":");
        const baseKey = parts.slice(0, 2).join(":");

        if (!(baseKey in LWJGL_ARM64_PATCH.jars) && !(baseKey in LWJGL_ARM64_PATCH.natives)) {
          newLibraries.push(lib);
          continue;
        }

        const newLib = { ...lib };

        if ((baseKey in LWJGL_ARM64_PATCH.jars) && lib.downloads?.artifact) {
          const jarEntry = LWJGL_ARM64_PATCH.jars[baseKey as keyof typeof LWJGL_ARM64_PATCH.jars];
          const newName = baseKey === "org.lwjgl:lwjgl-glfw"
            ? "org.glavo.hmcl.mmachina:lwjgl-glfw:3.3.1-mmachina.1"
            : `${baseKey}:3.3.1`;
          newLib.name = newName;
          newLib.downloads = { ...lib.downloads, artifact: { path: jarEntry.path, sha1: jarEntry.sha1, size: jarEntry.size, url: jarEntry.url } };
        }

        if ((baseKey in LWJGL_ARM64_PATCH.natives) && lib.downloads?.classifiers?.["natives-macos"]) {
          const nativeEntry = LWJGL_ARM64_PATCH.natives[baseKey as keyof typeof LWJGL_ARM64_PATCH.natives];
          newLib.downloads = {
            ...newLib.downloads,
            classifiers: { "natives-macos": { path: nativeEntry.path, sha1: nativeEntry.sha1, size: nativeEntry.size, url: nativeEntry.url } }
          };
        }

        newLibraries.push(newLib);
      }
      json.libraries = newLibraries;
      await writeFile(curJsonPath, JSON.stringify(json, null, 2), "utf-8");
      break;
    }
    if (!json.inheritsFrom) { break; }
    curJsonPath = minecraft.getVersionJson(json.inheritsFrom);
  }

  await writeFile(path.join(nativesDir, ".arm64-patched"), "3.3.1");
  console.error("[MCT] arm64 LWJGL 3.3.1 patch applied");
  return nativesDir;
}
