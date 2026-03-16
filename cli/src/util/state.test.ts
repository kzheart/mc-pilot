import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { StateStore } from "./state.js";

test("StateStore can write, read and remove JSON snapshots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-state-"));

  try {
    const store = new StateStore(tempDir);

    await store.writeJson("sample.json", { name: "bot", port: 25560 });
    assert.deepEqual(await store.readJson("sample.json", {}), { name: "bot", port: 25560 });

    await store.remove("sample.json");
    assert.deepEqual(await store.readJson("sample.json", { empty: true }), { empty: true });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
