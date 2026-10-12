import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { ModVariantCatalog } from "./types.js";

import {
  getBuildableFabricVariants,
  getDefaultVariant,
  getModArtifactFileName,
  loadModVariantCatalog,
} from "./ModVariantCatalog.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

test("loadModVariantCatalog loads shared mod variants and default variant", async () => {
  const catalog = await loadModVariantCatalog();
  const defaultVariant = getDefaultVariant(catalog);

  assert.equal(catalog.defaultVariant, "1.20.4-fabric");
  assert.ok(defaultVariant);
  assert.equal(defaultVariant?.minecraftVersion, "1.20.4");
  assert.equal(defaultVariant?.loader, "fabric");
});

test("getBuildableFabricVariants only returns variants with build metadata", async () => {
  const catalog = await loadModVariantCatalog();
  const variants = getBuildableFabricVariants(catalog);

  assert.deepEqual(
    variants.map((variant) => variant.id),
    [
      "26.2-fabric",
      "26.1-fabric",
      "1.21.11-fabric",
      "1.21.4-fabric",
      "1.21.1-fabric",
      "1.20.4-fabric",
      "1.20.2-fabric",
      "1.20.1-fabric",
      "1.18.2-fabric",
    ],
  );
});

test("getModArtifactFileName matches the local build artifact naming convention", async () => {
  const catalog = await loadModVariantCatalog();
  const variant = catalog.variants.find(
    (entry) => entry.id === "1.20.1-fabric",
  );

  assert.ok(variant);
  assert.equal(
    getModArtifactFileName(variant),
    "mct-client-mod-fabric-1.20.1.jar",
  );
});

test("cli and client-mod variant catalogs stay aligned with the Gradle mod version", async () => {
  const cliCatalog = await loadModVariantCatalog();
  const clientCatalog = JSON.parse(
    await readFile(path.join(REPO_ROOT, "client-mod", "variants.json"), "utf8"),
  ) as ModVariantCatalog;
  const gradleProperties = await readFile(
    path.join(REPO_ROOT, "client-mod", "gradle.properties"),
    "utf8",
  );
  const modVersion = gradleProperties.match(/^mod_version=(.+)$/m)?.[1]?.trim();

  assert.ok(modVersion);

  assert.deepEqual(
    cliCatalog,
    clientCatalog,
    "the packaged CLI catalog must preserve every variant, field, and top-level setting",
  );
  assert.equal(
    new Set(cliCatalog.variants.map((variant) => variant.id)).size,
    cliCatalog.variants.length,
    "variant IDs must be unique",
  );
  assert.equal(
    new Set(
      cliCatalog.variants.map(
        (variant) => `${variant.minecraftVersion}-${variant.loader}`,
      ),
    ).size,
    cliCatalog.variants.length,
    "each version/loader pair must resolve to one variant",
  );

  const buildableVariants = cliCatalog.variants.filter(
    (variant) =>
      "gradleModule" in variant &&
      Boolean((variant as { gradleModule?: string }).gradleModule),
  );
  assert.ok(buildableVariants.length > 0);
  for (const variant of buildableVariants) {
    assert.equal(
      variant.modVersion,
      modVersion,
      `variant ${variant.id} did not match client-mod Gradle version`,
    );
  }
});
