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

import {
  ClientInstanceManager,
  validateClientResolution,
  validateRecordingExecutable,
} from "./ClientInstanceManager.js";
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
  const previousPackPolicy = process.env.MCT_CLIENT_RESOURCE_PACK_POLICY;
  delete process.env.MCT_CLIENT_RESOURCE_PACK_POLICY;
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
    const javaEnvPath = path.join(tempDir, "java-env.txt");
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
          `>"${javaEnvPath}" echo policy:%MCT_CLIENT_RESOURCE_PACK_POLICY%`,
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
        `#!/bin/sh\nprintf 'policy:%s\\n' "$MCT_CLIENT_RESOURCE_PACK_POLICY" > "${javaEnvPath}"\nprintf '%s\\n' "$@" > "${javaArgsPath}"\n`,
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

    // No CLI/config choice must remain absent so the mod can apply its default
    // without overriding an explicit saved server preference.
    assert.equal((await readFile(javaEnvPath, "utf8")).trim(), "policy:");
    assert.equal(
      (await manager.loadMeta(clientName)).resourcePackPolicy,
      undefined,
    );

    const initialArguments = await readFile(javaArgsPath, "utf8");
    assert.ok(!initialArguments.includes("--width"));
    assert.ok(!initialArguments.includes("-Dmct.record.ffmpeg="));

    await manager.launch(clientName, {
      width: 1920,
      height: 1080,
      recordFfmpeg: path.join(tempDir, "ffmpeg with spaces"),
      mute: false,
      resourcePackPolicy: "reject",
      force: true,
    });
    await waitFor(async () => {
      const content = await readFile(optionsPath, "utf8");
      return (
        content.includes("soundCategory_master:1.0") &&
        content.includes("soundCategory_voice:1.0")
      );
    });
    await waitFor(
      async () =>
        (await readFile(javaEnvPath, "utf8")).trim() === "policy:reject",
    );

    await waitFor(async () => {
      const args = (await readFile(javaArgsPath, "utf8")).replace(
        /\r\n/g,
        "\n",
      );
      return (
        args.includes("--width\n1920\n--height\n1080") &&
        args.includes(
          `-Dmct.record.ffmpeg=${path.join(tempDir, "ffmpeg with spaces")}\n`,
        )
      );
    });
    assert.equal(
      (await manager.loadMeta(clientName)).width,
      undefined,
      "launch overrides are not persisted",
    );
    await manager.updateMeta(clientName, {
      resourcePackPolicy: "prompt",
      width: 1280,
      height: 720,
      recordFfmpeg: "ffmpeg-saved",
    });
    await manager.launch(clientName, { force: true });
    await waitFor(
      async () =>
        (await readFile(javaEnvPath, "utf8")).trim() === "policy:prompt",
    );

    await waitFor(async () => {
      const args = (await readFile(javaArgsPath, "utf8")).replace(
        /\r\n/g,
        "\n",
      );
      return (
        args.includes("--width\n1280\n--height\n720") &&
        args.includes("-Dmct.record.ffmpeg=ffmpeg-saved")
      );
    });
    await manager.launch(clientName, {
      resourcePackPolicy: "accept",
      force: true,
    });
    await waitFor(
      async () =>
        (await readFile(javaEnvPath, "utf8")).trim() === "policy:accept",
    );

    const meta = await manager.loadMeta(clientName);
    assert.equal(meta.mute, true);
    assert.equal(meta.resourcePackPolicy, "prompt");
  } finally {
    if (previousMctHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousMctHome;
    }
    if (previousPackPolicy === undefined) {
      delete process.env.MCT_CLIENT_RESOURCE_PACK_POLICY;
    } else {
      process.env.MCT_CLIENT_RESOURCE_PACK_POLICY = previousPackPolicy;
    }
    await rmWithRetry(tempDir);
  }
});

test("client window resolution is explicit, paired and bounded", () => {
  assert.doesNotThrow(() => validateClientResolution());
  assert.doesNotThrow(() => validateClientResolution(1920, 1080));
  for (const [width, height] of [
    [1920, undefined],
    [undefined, 1080],
    [0, 1080],
    [1920, NaN],
    [7681, 1080],
    [1920, 4321],
    [1920.5, 1080],
  ]) {
    assert.throws(() => validateClientResolution(width, height), {
      code: "INVALID_PARAMS",
    });
  }
});

test("recording executable config is structurally validated without executing it", () => {
  for (const value of [undefined, "ffmpeg", "/trusted/ffmpeg with spaces"])
    assert.doesNotThrow(() => validateRecordingExecutable(value));
  for (const value of ["", "  ", "ffmpeg\0ignored", "ffmpeg\nargument"])
    assert.throws(() => validateRecordingExecutable(value), {
      code: "INVALID_PARAMS",
    });
});
