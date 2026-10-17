import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { CacheManager } from "./CacheManager.js";
import { resolveArtifact } from "./client/ClientDownloader.js";
import type { ModVariant } from "./types.js";

const variant: ModVariant = {
  id: "1.20.4-fabric",
  minecraftVersion: "1.20.4",
  loader: "fabric",
  support: "ready",
  validation: "verified",
  modVersion: "0.9.1",
};

const DOWNLOAD_BYTES = 256 * 1024 * 1024;

function largestFile(dir: string) {
  let largest = 0;
  for (const name of readdirSync(dir)) {
    const info = statSync(path.join(dir, name), { throwIfNoEntry: false });
    if (info?.isFile()) largest = Math.max(largest, info.size);
  }
  return largest;
}

test("a download killed while writing is not reused as a cached mod", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-download-kill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = new CacheManager(path.join(root, "cache"));
  const target = cache.getModFile("mct-client-mod-fabric-1.20.4.jar");
  await mkdir(path.dirname(target), { recursive: true });
  const downloadUtils = fileURLToPath(
    new URL("./DownloadUtils.js", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { downloadFile } = await import(${JSON.stringify(downloadUtils)});
       await downloadFile("https://unused.test/mod.jar", process.argv[1],
         async () => new Response(new Uint8Array(${DOWNLOAD_BYTES})));`,
      target,
    ],
    { stdio: "ignore" },
  );
  const exited = once(child, "exit");
  let written = 0;
  const deadline = Date.now() + 30_000;
  while (child.exitCode === null && Date.now() < deadline) {
    written = largestFile(path.dirname(target));
    if (written > 0) break;
    await sleep(1);
  }
  child.kill("SIGKILL");
  await exited;
  assert.ok(
    written > 0 && written < DOWNLOAD_BYTES,
    `the child must be killed mid-write (observed ${written} bytes)`,
  );

  const result = await resolveArtifact(
    root,
    variant,
    cache,
    (async () => new Response("restored-mod")) as typeof fetch,
  );
  assert.equal(result.source, "github-release");
  assert.equal(await readFile(target, "utf8"), "restored-mod");
});
