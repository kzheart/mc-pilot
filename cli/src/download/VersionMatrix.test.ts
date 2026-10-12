import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

import { loadModVariantCatalogSync } from "./ModVariantCatalog.js";
import type { ModVariant, ModVariantCatalog } from "./types.js";

import {
  getClientVersionMatrix,
  getMinecraftSupport,
  getSupportedMinecraftVersions,
  getVersionMatrix,
  searchClientVersions,
} from "./VersionMatrix.js";

test("getVersionMatrix exposes documented client support entries", () => {
  const matrix = getVersionMatrix();

  assert.equal(matrix.length, 14);
  assert.deepEqual(getSupportedMinecraftVersions(), [
    "26.2",
    "26.1.2",
    "26.1.1",
    "26.1",
    "1.21.11",
    "1.21.4",
    "1.21.1",
    "1.20.4",
    "1.20.3",
    "1.20.2",
    "1.20.1",
    "1.18.2",
    "1.16.5",
    "1.12.2",
  ]);

  const latest = getMinecraftSupport("1.21.11");
  assert.ok(latest);
  assert.equal(latest.clients.fabric.supported, true);
  assert.equal(latest.clients.fabric.loaderVersion, "0.19.2");
  assert.equal(latest.clients.forge.supported, true);
  assert.equal(latest.clients.forge.loaderVersion, "61.1.8");
  assert.equal(latest.clients.neoforge.supported, true);
  assert.equal(latest.clients.neoforge.loaderVersion, "21.11.42");
});

test("Minecraft 26.1 exposes exact client support", () => {
  const support = getMinecraftSupport("26.1");

  assert.ok(support);
  assert.equal(support.javaVersion, "25+");
  assert.deepEqual(
    Object.values(support.clients).map((client) => client.validation),
    ["verified", "verified", "verified"],
  );
  assert.equal(support.clients.fabric.loaderVersion, "0.19.3");
  assert.equal(support.clients.forge.loaderVersion, "62.0.9");
  assert.equal(support.clients.neoforge.loaderVersion, "26.1.0.19-beta");
});

test("Minecraft 26.1 patch versions have no client of their own", () => {
  for (const version of ["26.1.1", "26.1.2"]) {
    const support = getMinecraftSupport(version);
    assert.ok(support);
    assert.equal(support.clients.fabric.supported, false);
  }
});

test("searchClientVersions exposes all loaders and java requirements", () => {
  const results = searchClientVersions({ version: "1.21.4" });

  assert.equal(results.length, 3);

  const neoforge = results.find((entry) => entry.loader === "neoforge");
  const fabric = results.find((entry) => entry.loader === "fabric");
  const forge = results.find((entry) => entry.loader === "forge");

  assert.equal(fabric?.supported, true);
  assert.equal(fabric?.loaderVersion, "0.16.14");
  assert.equal(fabric?.modVersion, "0.9.1");
  assert.equal(fabric?.validation, "verified");
  assert.equal(fabric?.notes, undefined);
  assert.equal(fabric?.javaVersion, "21+");

  assert.equal(forge?.supported, true);
  assert.equal(forge?.loaderVersion, "54.1.16");
  assert.equal(forge?.modVersion, "0.9.1");
  assert.equal(forge?.validation, "verified");
  assert.equal(forge?.javaVersion, "21+");

  assert.equal(neoforge?.supported, true);
  assert.equal(neoforge?.loaderVersion, "21.4.157");
  assert.equal(neoforge?.modVersion, "0.9.1");
  assert.equal(neoforge?.validation, "verified");
  assert.equal(neoforge?.javaVersion, "21+");
});

test("searchClientVersions retains unsupported discovery rows without inventing artifacts", () => {
  const results = searchClientVersions({ loader: "fabric" }).filter(
    (entry) =>
      entry.minecraftVersion === "1.20.3" ||
      entry.minecraftVersion === "1.20.2",
  );

  assert.deepEqual(results, [
    {
      loader: "fabric",
      minecraftVersion: "1.20.3",
      supported: false,
      notes: "未提供精确 1.20.3 客户端变体",
      javaVersion: "17+",
    },
    {
      loader: "fabric",
      minecraftVersion: "1.20.2",
      supported: true,
      loaderVersion: "0.16.14",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
  ]);
});

test("searchClientVersions exposes configured 1.20.x Forge variants", () => {
  const results = searchClientVersions({ loader: "forge" }).filter(
    (entry) =>
      entry.minecraftVersion === "1.20.4" ||
      entry.minecraftVersion === "1.20.2" ||
      entry.minecraftVersion === "1.20.1",
  );

  assert.deepEqual(results, [
    {
      loader: "forge",
      minecraftVersion: "1.20.4",
      supported: true,
      loaderVersion: "49.0.49",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
    {
      loader: "forge",
      minecraftVersion: "1.20.2",
      supported: true,
      loaderVersion: "48.1.0",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
    {
      loader: "forge",
      minecraftVersion: "1.20.1",
      supported: true,
      loaderVersion: "47.3.0",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
  ]);
});

test("Minecraft 1.12.2 exposes selectable Forge builds from the real variant", () => {
  const [forge] = searchClientVersions({
    loader: "forge",
    version: "1.12.2",
  });

  assert.equal(forge?.supported, true);
  assert.equal(forge?.loaderVersion, "14.23.5.2864");
  assert.deepEqual(forge?.loaderVersions, [
    "14.23.5.2859",
    "14.23.5.2860",
    "14.23.5.2864",
  ]);
  assert.equal(forge?.javaVersion, "8");
  assert.equal(forge?.validation, "verified");
});

test("every catalog variant is discoverable with its exact configured metadata", () => {
  const catalog = loadModVariantCatalogSync();
  const results = searchClientVersions(undefined, catalog);
  const supportedIds = results
    .filter((entry) => entry.supported)
    .map((entry) => `${entry.minecraftVersion}-${entry.loader}`)
    .sort();
  assert.deepEqual(
    supportedIds,
    catalog.variants
      .filter((variant) => ["ready", "configured"].includes(variant.support))
      .map((variant) => variant.id)
      .sort(),
  );

  for (const variant of catalog.variants) {
    const entry = results.find(
      (result) =>
        result.minecraftVersion === variant.minecraftVersion &&
        result.loader === variant.loader,
    );
    assert.ok(entry, `missing catalog variant ${variant.id}`);
    assert.equal(
      entry.loaderVersion,
      variant.fabricLoaderVersion ??
        variant.forgeVersion ??
        variant.neoforgeVersion,
    );
    assert.deepEqual(entry.loaderVersions, variant.forgeVersions);
    assert.equal(entry.modVersion, variant.modVersion);
    assert.equal(entry.validation, variant.validation);
    assert.equal(entry.notes, variant.notes);
    assert.equal(
      entry.javaVersion,
      variant.javaVersionMax === variant.javaVersion
        ? String(variant.javaVersion)
        : `${variant.javaVersion}+`,
    );
  }
});

function syntheticVariant(overrides: Partial<ModVariant> = {}): ModVariant {
  return {
    id: "27.1-fabric",
    minecraftVersion: "27.1",
    loader: "fabric",
    support: "configured",
    validation: "planned",
    fabricLoaderVersion: "test-loader",
    modVersion: "test-mod",
    javaVersion: 25,
    ...overrides,
  };
}

function withSyntheticVariant(variant = syntheticVariant()): ModVariantCatalog {
  const catalog = loadModVariantCatalogSync();
  return { ...catalog, variants: [...catalog.variants, variant] };
}

test("catalog-only additions appear in every discovery API without a matrix edit", () => {
  const catalog = withSyntheticVariant();
  assert.equal(getVersionMatrix(catalog)[0]?.minecraftVersion, "27.1");
  assert.equal(getSupportedMinecraftVersions(catalog)[0], "27.1");
  assert.equal(
    getMinecraftSupport("27.1", catalog)?.clients.fabric.loaderVersion,
    "test-loader",
  );
  assert.deepEqual(
    searchClientVersions({ loader: "fabric", version: "27.1" }, catalog),
    [
      {
        loader: "fabric",
        minecraftVersion: "27.1",
        supported: true,
        loaderVersion: "test-loader",
        modVersion: "test-mod",
        validation: "planned",
        javaVersion: "25+",
      },
    ],
  );
  assert.equal(getClientVersionMatrix(catalog)[0]?.minecraftVersion, "27.1");
});

test("configured availability and runtime validation remain independent", () => {
  for (const support of [
    "ready",
    "configured",
    "planned",
    "unsupported",
  ] as const) {
    const catalog = withSyntheticVariant(syntheticVariant({ support }));
    const result = getMinecraftSupport("27.1", catalog)?.clients.fabric;
    assert.equal(
      result?.supported,
      support === "ready" || support === "configured",
    );
    assert.equal(result?.validation, "planned");
  }
});

test("omitted variants cannot fall back to stale hardcoded support", () => {
  const catalog = loadModVariantCatalogSync();
  catalog.variants = catalog.variants.filter(
    (variant) => variant.id !== "1.20.4-fabric",
  );
  assert.deepEqual(getMinecraftSupport("1.20.4", catalog)?.clients.fabric, {
    supported: false,
    notes: "不支持此版本",
  });
  catalog.variants = catalog.variants.filter(
    (variant) => variant.minecraftVersion !== "1.20.4",
  );
  assert.equal(getMinecraftSupport("1.20.4", catalog), undefined);
  assert.deepEqual(searchClientVersions({ version: "1.20.4" }, catalog), []);
});

test("compatibility-only rows are never advertised as exact client artifacts", () => {
  for (const version of ["26.1.1", "26.1.2", "1.20.3", "1.16.5"]) {
    const results = searchClientVersions({ version });
    assert.equal(results.length, 3);
    for (const result of results) {
      assert.equal(result.supported, false);
      assert.equal(result.loaderVersion, undefined);
      assert.equal(result.modVersion, undefined);
      assert.equal(result.validation, undefined);
      assert.ok(result.notes);
    }
  }
  const catalog = withSyntheticVariant(
    syntheticVariant({
      id: "1.20.3-fabric",
      minecraftVersion: "1.20.3",
      javaVersion: 17,
    }),
  );
  assert.equal(
    getMinecraftSupport("1.20.3", catalog)?.clients.fabric.supported,
    true,
  );
  assert.equal(
    getMinecraftSupport("1.20.3", catalog)?.clients.fabric.notes,
    undefined,
  );
});

test("version and loader ordering is stable regardless of catalog order", () => {
  const catalog = withSyntheticVariant(
    syntheticVariant({
      id: "1.21.9-fabric",
      minecraftVersion: "1.21.9",
      javaVersion: 21,
    }),
  );
  const expected = searchClientVersions(undefined, catalog);
  catalog.variants.reverse();
  assert.deepEqual(searchClientVersions(undefined, catalog), expected);
  const versions = getSupportedMinecraftVersions(catalog);
  assert.deepEqual(versions.slice(4, 7), ["1.21.11", "1.21.9", "1.21.4"]);
  assert.deepEqual(
    expected.map((entry) => entry.loader),
    [
      ...versions.map(() => "fabric"),
      ...versions.map(() => "forge"),
      ...versions.map(() => "neoforge"),
    ],
  );
});

test("Java display preserves minimum, bounded range, and exact requirements", () => {
  for (const [javaVersion, javaVersionMax, expected] of [
    [17, undefined, "17+"],
    [17, 21, "17-21"],
    [8, 8, "8"],
  ] as const) {
    const catalog = withSyntheticVariant(
      syntheticVariant({ javaVersion, javaVersionMax }),
    );
    assert.equal(getMinecraftSupport("27.1", catalog)?.javaVersion, expected);
    assert.equal(
      searchClientVersions({ version: "27.1" }, catalog)[0]?.javaVersion,
      expected,
    );
  }
  const catalog = withSyntheticVariant(
    syntheticVariant({ javaVersion: 21, javaVersionMax: 17 }),
  );
  assert.throws(
    () => getVersionMatrix(catalog),
    /Conflicting Java bounds for 27\.1/,
  );
});

test("each public discovery operation reads one catalog snapshot", (context) => {
  const reader = context.mock.method(fs, "readFileSync");
  syncBuiltinESMExports();
  try {
    for (const operation of [
      () => getVersionMatrix(),
      () => getSupportedMinecraftVersions(),
      () => getMinecraftSupport("26.2"),
      () => searchClientVersions(),
      () => getClientVersionMatrix(),
    ]) {
      reader.mock.resetCalls();
      operation();
      assert.equal(reader.mock.callCount(), 1);
    }
  } finally {
    reader.mock.restore();
    syncBuiltinESMExports();
  }
});

test("discovery does not mutate the catalog or expose mutable Forge choices", () => {
  const catalog = loadModVariantCatalogSync();
  const before = structuredClone(catalog);
  const choices = getMinecraftSupport("1.12.2", catalog)?.clients.forge
    .loaderVersions;
  assert.ok(choices);
  (choices as string[]).push("not-a-real-build");
  assert.deepEqual(catalog, before);
  assert.deepEqual(
    getMinecraftSupport("1.12.2", catalog)?.clients.forge.loaderVersions,
    ["14.23.5.2859", "14.23.5.2860", "14.23.5.2864"],
  );
});
