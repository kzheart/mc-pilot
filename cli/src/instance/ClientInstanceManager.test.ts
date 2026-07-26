import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ClientInstanceManager } from "./ClientInstanceManager.js";
import { GlobalStateStore } from "../util/global-state.js";
import { resolveClientInstanceDir } from "../util/paths.js";

/**
 * Windows cannot remove a directory that is still some process's cwd; the
 * detached fake-java launch may outlive the assertions by a moment.
 */
async function rmWithRetry(target: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code === "EBUSY" || code === "EPERM") && attempt < 20) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      throw error;
    }
  }
}

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

test("ClientInstanceManager launch defaults to Simplified Chinese and muted audio", async () => {
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
    const javaArgsPath = path.join(tempDir, "java-args.txt");
    const isWindows = process.platform === "win32";
    const fakeJavaPath = path.join(
      tempDir,
      isWindows ? "fake-java.cmd" : "fake-java.sh",
    );

    await mkdir(gameDir, { recursive: true });
    if (isWindows) {
      // Batch equivalent of the POSIX script: print each argument on its own
      // line. %~1 strips the quotes added by the cmd.exe launch path.
      await writeFile(
        fakeJavaPath,
        [
          "@echo off",
          `break > "${javaArgsPath}.tmp"`,
          ":loop",
          'if "%~1"=="" goto done',
          `>>"${javaArgsPath}.tmp" echo %~1`,
          "shift",
          "goto loop",
          ":done",
          `move /y "${javaArgsPath}.tmp" "${javaArgsPath}" >nul`,
          "",
        ].join("\r\n"),
        "utf8",
      );
    } else {
      await writeFile(
        fakeJavaPath,
        `#!/bin/sh\nprintf '%s\\n' "$@" > "${javaArgsPath}"\n`,
        "utf8",
      );
      await chmod(fakeJavaPath, 0o755);
    }
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
          javaArgs: ["-Duser.language=en"],
          gameArgs: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    await manager.create({
      name: clientName,
      version: "1.20.4",
      wsPort: 25560,
      launchArgs: ["--manifest", manifestPath, "--java", fakeJavaPath],
    });

    await manager.launch(clientName);
    await waitFor(async () => {
      try {
        const content = await readFile(optionsPath, "utf8");
        return (
          content.includes("lang:zh_cn") &&
          content.includes("soundCategory_master:0.0") &&
          content.includes("soundCategory_voice:0.0")
        );
      } catch {
        return false;
      }
    });
    await waitFor(async () => {
      try {
        const raw = await readFile(javaArgsPath, "utf8");
        const content = raw.replace(/\r\n/g, "\n");
        return (
          content.includes("-Duser.language=zh\n") &&
          content.includes("-Duser.country=CN\n") &&
          !content.includes("-Duser.language=en")
        );
      } catch {
        return false;
      }
    });

    await manager.launch(clientName, { mute: false });
    await waitFor(async () => {
      const content = await readFile(optionsPath, "utf8");
      return (
        content.includes("soundCategory_master:1.0") &&
        content.includes("soundCategory_voice:1.0")
      );
    });

    const meta = await manager.loadMeta(clientName);
    assert.equal(meta.mute, true);
  } finally {
    if (previousMctHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousMctHome;
    }
    await rmWithRetry(tempDir);
  }
});
