import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { CacheManager } from "./CacheManager.js";

test("CacheManager builds deterministic cache paths", () => {
  const cache = new CacheManager("/tmp/mct-cache");

  assert.equal(cache.getRootDir(), "/tmp/mct-cache");
  assert.equal(cache.getServerFile("paper", "1.20.4", "496"), path.join("/tmp/mct-cache", "server", "paper", "1.20.4-496.jar"));
  assert.equal(cache.getMinecraftDir("1.20.4"), path.join("/tmp/mct-cache", "client", "minecraft", "1.20.4"));
  assert.equal(cache.getLoaderDir("fabric"), path.join("/tmp/mct-cache", "client", "fabric"));
  assert.equal(cache.getModFile("mct-client-mod-1.20.4-fabric.jar"), path.join("/tmp/mct-cache", "mod", "mct-client-mod-1.20.4-fabric.jar"));
});
