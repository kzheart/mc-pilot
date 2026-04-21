import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getBuildableFabricVariants, getDefaultVariant, getModArtifactFileName, loadModVariantCatalog } from "./ModVariantCatalog.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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
    ["1.21.4-fabric", "1.21.1-fabric", "1.20.4-fabric", "1.20.2-fabric", "1.20.1-fabric", "1.18.2-fabric"]
  );
});

test("getModArtifactFileName matches the local build artifact naming convention", async () => {
  const catalog = await loadModVariantCatalog();
  const variant = catalog.variants.find((entry) => entry.id === "1.20.1-fabric");

  assert.ok(variant);
  assert.equal(getModArtifactFileName(variant), "mct-client-mod-fabric-1.20.1.jar");
});

test("cli and client-mod variant catalogs stay aligned with the Gradle mod version", async () => {
  const cliCatalog = await loadModVariantCatalog();
  const clientCatalog = JSON.parse(
    await readFile(path.join(REPO_ROOT, "client-mod", "variants.json"), "utf8")
  ) as {
    variants: Array<{ id: string; modVersion?: string }>;
  };
  const gradleProperties = await readFile(path.join(REPO_ROOT, "client-mod", "gradle.properties"), "utf8");
  const modVersion = gradleProperties.match(/^mod_version=(.+)$/m)?.[1]?.trim();

  assert.ok(modVersion);

  for (const variant of cliCatalog.variants) {
    const matchingClientVariant = clientCatalog.variants.find((entry) => entry.id === variant.id);
    if (!matchingClientVariant) {
      continue;
    }
    assert.equal(variant.modVersion, matchingClientVariant.modVersion, `variant ${variant.id} drifted between cli and client-mod catalogs`);
  }

  const buildableFabricVariants = cliCatalog.variants.filter(
    (variant) => variant.loader === "fabric" && "gradleModule" in variant && Boolean((variant as { gradleModule?: string }).gradleModule)
  );
  assert.ok(buildableFabricVariants.length > 0);
  for (const variant of buildableFabricVariants) {
    assert.equal(variant.modVersion, modVersion, `variant ${variant.id} did not match client-mod Gradle version`);
  }
});
