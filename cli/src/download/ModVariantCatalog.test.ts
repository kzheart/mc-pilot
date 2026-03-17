import assert from "node:assert/strict";
import test from "node:test";

import { getBuildableFabricVariants, getDefaultVariant, loadModVariantCatalog } from "./ModVariantCatalog.js";

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
    ["1.20.4-fabric", "1.20.1-fabric"]
  );
});
