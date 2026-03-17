import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { ModVariantCatalog, ModVariant } from "./types.js";

const DEFAULT_VARIANTS_PATH = fileURLToPath(new URL("../../../client-mod/variants.json", import.meta.url));

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map((value) => Number.parseInt(value, 10));
  const rightParts = right.split(".").map((value) => Number.parseInt(value, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export async function loadModVariantCatalog(filePath = DEFAULT_VARIANTS_PATH): Promise<ModVariantCatalog> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as ModVariantCatalog;
}

export function loadModVariantCatalogSync(filePath = DEFAULT_VARIANTS_PATH): ModVariantCatalog {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as ModVariantCatalog;
}

export function sortVariants(variants: ModVariant[]) {
  return [...variants].sort((left, right) => {
    const versionDelta = compareVersions(right.minecraftVersion, left.minecraftVersion);
    if (versionDelta !== 0) {
      return versionDelta;
    }

    return left.loader.localeCompare(right.loader);
  });
}

export function findVariant(catalog: ModVariantCatalog, variantId: string) {
  return catalog.variants.find((variant) => variant.id === variantId);
}

export function getDefaultVariant(catalog: ModVariantCatalog) {
  return findVariant(catalog, catalog.defaultVariant);
}

export function getBuildableFabricVariants(catalog: ModVariantCatalog) {
  return sortVariants(
    catalog.variants.filter(
      (variant) => variant.loader === "fabric" && variant.yarnMappings && variant.fabricLoaderVersion
    )
  );
}

export function getSupportedMinecraftVersions(catalog: ModVariantCatalog) {
  return [...new Set(catalog.variants.map((variant) => variant.minecraftVersion))].sort(compareVersions).reverse();
}
