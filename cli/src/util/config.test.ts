import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "./config.js";

test("loadConfig returns defaults when config file is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-config-"));

  try {
    const config = await loadConfig(undefined, tempDir);
    assert.equal(config.server.port, 25565);
    assert.equal(config.timeout.default, 10);
    assert.deepEqual(config.clients, {});
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig merges partial config with defaults", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-config-"));

  try {
    const configPath = path.join(tempDir, "mct.config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          server: {
            port: 25590
          },
          timeout: {
            default: 42
          }
        },
        null,
        2
      )
    );

    const config = await loadConfig(configPath, tempDir);
    assert.equal(config.server.port, 25590);
    assert.equal(config.server.dir, "./server");
    assert.equal(config.timeout.default, 42);
    assert.equal(config.timeout.clientReady, 60);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
