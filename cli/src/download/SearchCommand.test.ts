import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_ENTRY = fileURLToPath(new URL("../index.js", import.meta.url));

async function runCli(args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
    cwd: process.cwd()
  });

  return JSON.parse(stdout) as {
    success: boolean;
    data: {
      results: Array<unknown>;
    };
  };
}

test("server search returns filtered Paper version data", async () => {
  const result = await runCli(["server", "search", "--type", "paper", "--version", "1.20.4"]);

  assert.equal(result.success, true);
  assert.deepEqual(result.data.results, [
    {
      type: "paper",
      versions: [{ version: "1.20.4", build: "496" }]
    }
  ]);
});

test("client search returns Fabric support across versions", async () => {
  const result = await runCli(["client", "search", "--loader", "fabric"]);

  assert.equal(result.success, true);
  assert.equal(result.data.results.length, 6);
  assert(
    result.data.results.every((entry) =>
      Array.isArray((entry as { loaders: Array<{ loader: string }> }).loaders)
        && (entry as { loaders: Array<{ loader: string }> }).loaders[0]?.loader === "fabric"
    )
  );
});
