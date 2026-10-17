#!/usr/bin/env node
// Downloads every buildable variant's mod jar from an empty cache, exactly as the
// CLI would by default, and checks each jar carries the catalog's modVersion.
// --allow-unpublished skips (with a notice) while this CLI version's release does
// not exist yet, e.g. on the release commit before its tag finishes publishing.
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { CacheManager } = await import(path.join(root, "cli/dist/download/CacheManager.js"));
const { resolveArtifact } = await import(path.join(root, "cli/dist/download/client/ClientDownloader.js"));
const { loadModVariantCatalog } = await import(path.join(root, "cli/dist/download/ModVariantCatalog.js"));

const { version } = JSON.parse(await readFile(path.join(root, "cli/package.json"), "utf8"));
const tag = `v${version}`;

if (process.argv.includes("--allow-unpublished")) {
  const response = await fetch(`https://github.com/kzheart/mc-pilot/releases/tag/${tag}`, { method: "HEAD" });
  if (response.status === 404) {
    console.log(`::notice::Release ${tag} is not published yet; skipping the default mod download check.`);
    process.exit(0);
  }
}

const catalog = await loadModVariantCatalog();
const variants = catalog.variants.filter((variant) => variant.support === "ready" || variant.support === "configured");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mct-release-mods-"));
try {
  const cacheManager = new CacheManager(path.join(temporary, "cache"));
  for (const variant of variants) {
    const artifact = await resolveArtifact(temporary, variant, cacheManager);
    if (artifact.source !== "github-release") {
      throw new Error(`${variant.id} resolved from ${artifact.source}, not the release`);
    }
    console.log(`${tag} ${artifact.artifactFileName}: mod ${variant.modVersion}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
