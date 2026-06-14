#!/usr/bin/env node
// 构建 macOS 录制 helper 的通用二进制(arm64 + x86_64),复制到 cli/vendor/ 随包分发。
// 发版(prepack)时执行;录制目前仅支持 macOS,其它平台直接跳过。
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recorderDir = path.resolve(cliRoot, "..", "recorder/macos");
const vendorDir = path.join(cliRoot, "vendor");
const dest = path.join(vendorDir, "mct-recorder");

if (process.platform !== "darwin") {
  console.log(`[bundle-recorder] skip: platform ${process.platform} (recorder is macOS-only)`);
  process.exit(0);
}

if (!existsSync(recorderDir)) {
  console.log(`[bundle-recorder] skip: ${recorderDir} not found (publishing from a packed tarball?)`);
  process.exit(0);
}

const buildArgs = ["build", "-c", "release", "--arch", "arm64", "--arch", "x86_64"];

console.log(`[bundle-recorder] swift ${buildArgs.join(" ")} (in ${recorderDir})`);
execFileSync("swift", buildArgs, { cwd: recorderDir, stdio: "inherit" });

const binDir = execFileSync("swift", [...buildArgs, "--show-bin-path"], {
  cwd: recorderDir,
  encoding: "utf8"
}).trim();

const builtBinary = path.join(binDir, "mct-recorder");
mkdirSync(vendorDir, { recursive: true });
copyFileSync(builtBinary, dest);
chmodSync(dest, 0o755);

console.log(`[bundle-recorder] copied ${builtBinary} -> ${dest}`);
