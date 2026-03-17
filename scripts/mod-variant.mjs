import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const VARIANTS_PATH = path.join(ROOT_DIR, "client-mod", "variants.json");

function readCatalog() {
  return JSON.parse(readFileSync(VARIANTS_PATH, "utf8"));
}

export function getVariantCatalog() {
  return readCatalog();
}

export function getDefaultVariant() {
  const catalog = readCatalog();
  return catalog.variants.find((variant) => variant.id === catalog.defaultVariant);
}

export function getVariantById(variantId) {
  const catalog = readCatalog();
  return catalog.variants.find((variant) => variant.id === variantId);
}
