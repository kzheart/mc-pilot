import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ClientInstanceManager } from "./ClientInstanceManager.js";
import { GlobalStateStore } from "../util/global-state.js";
import { resolveClientInstanceDir } from "../util/paths.js";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

test("ClientInstanceManager launch applies mute and unmute audio settings via options.txt", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-client-mute-"));
  const previousMctHome = process.env.MCT_HOME;
  process.env.MCT_HOME = path.join(tempDir, "mct-home");

  try {
    const globalState = new GlobalStateStore();
    const manager = new ClientInstanceManager(globalState);
    const clientName = "fabric-muted";
    const instanceDir = resolveClientInstanceDir(clientName);
    const gameDir = path.join(instanceDir, "minecraft");
    const manifestPath = path.join(instanceDir, "launch-manifest.json");
    const optionsPath = path.join(gameDir, "options.txt");

    await mkdir(gameDir, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          gameDir,
          minecraftVersion: "1.20.4",
          fabricLoaderVersion: "0.16.14",
          assetsDir: path.join(tempDir, "assets"),
          assetsIndexId: "1.20",
          classpathEntries: [],
          mainClass: "net.minecraft.client.main.Main",
          javaArgs: [],
          gameArgs: []
        },
        null,
        2
      ),
      "utf8"
    );

    await manager.create({
      name: clientName,
      version: "1.20.4",
      wsPort: 25560,
      mute: true,
      launchArgs: ["--manifest", manifestPath, "--java", "/usr/bin/true"]
    });

    await manager.launch(clientName);
    await waitFor(async () => {
      try {
        const content = await readFile(optionsPath, "utf8");
        return content.includes("soundCategory_master:0.0") && content.includes("soundCategory_voice:0.0");
      } catch {
        return false;
      }
    });

    await manager.launch(clientName, { mute: false });
    await waitFor(async () => {
      const content = await readFile(optionsPath, "utf8");
      return content.includes("soundCategory_master:1.0") && content.includes("soundCategory_voice:1.0");
    });

    const meta = await manager.loadMeta(clientName);
    assert.equal(meta.mute, true);
  } finally {
    if (previousMctHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousMctHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
