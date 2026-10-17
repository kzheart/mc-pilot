import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  modVersion: "0.10.0",
};

const cliVersion = (
  JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds an uncompressed jar holding the given entries. */
function jar(entries: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const fabricJar = (version: string) =>
  jar({ "fabric.mod.json": JSON.stringify({ id: "mct", version }) });

for (const scenario of [
  {
    name: "defaults to the release of this CLI version",
    tag: `v${cliVersion}`,
  },
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
        return new Response(fabricJar("0.10.0"));
      }) as typeof fetch,
    );
    assert.equal(requests.length, 1);
    assert.ok(
      requests[0].endsWith(`/${scenario.tag}/mct-client-mod-fabric-1.20.4.jar`),
    );
    assert.equal(result.source, "github-release");
    assert.deepEqual(await readFile(result.cachePath), fabricJar("0.10.0"));
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

for (const scenario of [
  {
    name: "a Fabric jar",
    variant,
    jar: fabricJar,
  },
  {
    name: "a Forge mods.toml jar",
    variant: { ...variant, id: "1.20.1-forge", minecraftVersion: "1.20.1", loader: "forge" as const },
    jar: (version: string) =>
      jar({
        "META-INF/mods.toml": `modLoader = "javafml"\nloaderVersion = "[47,)"\n\n[[mods]]\nmodId = "mct"\nversion = "${version}"\n\n[[dependencies.mct]]\nmodId = "forge"\nversionRange = "[47.3.0,)"\n`,
      }),
  },
  {
    name: "a NeoForge neoforge.mods.toml jar",
    variant: { ...variant, id: "26.2-neoforge", minecraftVersion: "26.2", loader: "neoforge" as const },
    jar: (version: string) =>
      jar({
        "META-INF/neoforge.mods.toml": `loaderVersion = "[1,)"\n[[mods]]\nmodId = "mct"\nversion = "${version}"\n`,
      }),
  },
  {
    name: "a legacy Forge mcmod.info jar",
    variant: { ...variant, id: "1.12.2-forge", minecraftVersion: "1.12.2", loader: "forge" as const },
    jar: (version: string) =>
      jar({
        "mcmod.info": JSON.stringify([{ modid: "mct", version, mcversion: "1.12.2" }]),
      }),
  },
]) {
  test(`resolveArtifact replaces a stale cached ${scenario.name}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mct-release-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cacheManager = new CacheManager(path.join(root, "cache"));
    const fileName = `mct-client-mod-${scenario.variant.loader}-${scenario.variant.minecraftVersion}.jar`;
    await mkdir(path.dirname(cacheManager.getModFile(fileName)), { recursive: true });

    await writeFile(cacheManager.getModFile(fileName), scenario.jar("0.10.0"));
    const current = await resolveArtifact(root, scenario.variant, cacheManager, (async () => {
      assert.fail("a current cached jar must not be downloaded again");
    }) as typeof fetch);
    assert.equal(current.source, "cache");

    await writeFile(cacheManager.getModFile(fileName), scenario.jar("0.9.1"));
    const refreshed = await resolveArtifact(
      root,
      scenario.variant,
      cacheManager,
      (async () => new Response(scenario.jar("0.10.0"))) as typeof fetch,
    );
    assert.equal(refreshed.source, "github-release");
    assert.deepEqual(await readFile(refreshed.cachePath), scenario.jar("0.10.0"));
  });
}

test("resolveArtifact replaces a cached jar whose version cannot be read", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheManager = new CacheManager(path.join(root, "cache"));
  const cachePath = cacheManager.getModFile("mct-client-mod-fabric-1.20.4.jar");
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, "PK\u0003\u0004truncated");
  const result = await resolveArtifact(
    root,
    variant,
    cacheManager,
    (async () => new Response(fabricJar("0.10.0"))) as typeof fetch,
  );
  assert.equal(result.source, "github-release");
  assert.deepEqual(await readFile(cachePath), fabricJar("0.10.0"));
});

test("resolveArtifact rejects a downloaded jar for another mod version", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheManager = new CacheManager(path.join(root, "cache"));
  await assert.rejects(
    resolveArtifact(
      root,
      variant,
      cacheManager,
      (async () => new Response(fabricJar("0.9.1"))) as typeof fetch,
    ),
    (error: unknown) => {
      assert.ok(error instanceof MctError);
      assert.equal(error.code, "ARTIFACT_VERSION_MISMATCH");
      const details = error.details as Record<string, unknown>;
      assert.equal(details.expected, "0.10.0");
      assert.equal(details.actual, "0.9.1");
      return true;
    },
  );
  await assert.rejects(readFile(cacheManager.getModFile("mct-client-mod-fabric-1.20.4.jar")));
});

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
