import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MctError } from "../../util/errors.js";
import { CacheManager } from "../CacheManager.js";
import type { ModVariant } from "../types.js";
import { resolveArtifact } from "./ClientDownloader.js";

const variant: ModVariant = {
  id: "1.20.4-fabric",
  minecraftVersion: "1.20.4",
  loader: "fabric",
  support: "ready",
  validation: "verified",
  modVersion: "0.9.1",
};

for (const scenario of [
  { name: "defaults to a published tag, not modVersion", tag: "v0.14.0" },
  { name: "supports the environment override", env: "v0.15.0", tag: "v0.15.0" },
  {
    name: "preserves an explicit variant tag",
    env: "v0.15.0",
    explicit: "v0.16.0",
    tag: "v0.16.0",
  },
]) {
  test(`resolveArtifact ${scenario.name} on a cold cache`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mct-release-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const previous = process.env.MCT_MOD_RELEASE_TAG;
    t.after(() => {
      if (previous === undefined) delete process.env.MCT_MOD_RELEASE_TAG;
      else process.env.MCT_MOD_RELEASE_TAG = previous;
    });
    if (scenario.env) process.env.MCT_MOD_RELEASE_TAG = scenario.env;
    else delete process.env.MCT_MOD_RELEASE_TAG;
    const requests: string[] = [];
    const result = await resolveArtifact(
      root,
      {
        ...variant,
        ...(scenario.explicit ? { releaseTag: scenario.explicit } : {}),
      },
      new CacheManager(path.join(root, "cache")),
      (async (url) => {
        requests.push(String(url));
        return new Response("downloaded-mod");
      }) as typeof fetch,
    );
    assert.equal(requests.length, 1);
    assert.ok(
      requests[0].endsWith(`/${scenario.tag}/mct-client-mod-fabric-1.20.4.jar`),
    );
    assert.equal(result.source, "github-release");
    assert.equal(await readFile(result.cachePath, "utf8"), "downloaded-mod");
    const cached = await resolveArtifact(
      root,
      variant,
      new CacheManager(path.join(root, "cache")),
      (async () => {
        assert.fail("warm cache must not download again");
      }) as typeof fetch,
    );
    assert.equal(cached.source, "cache");
  });
}

test("resolveArtifact reports the release tag and HTTP status on a missing asset", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    resolveArtifact(
      root,
      { ...variant, releaseTag: "missing-tag" },
      new CacheManager(path.join(root, "cache")),
      (async () => new Response("Not Found", { status: 404 })) as typeof fetch,
    ),
    (error: unknown) => {
      assert.ok(error instanceof MctError);
      assert.equal(error.code, "ARTIFACT_NOT_FOUND");
      const details = error.details as Record<string, unknown>;
      assert.equal(details.releaseTag, "missing-tag");
      assert.equal(details.downloadStatus, 404);
      assert.ok(String(details.downloadUrl).includes("/missing-tag/"));
      return true;
    },
  );
});
