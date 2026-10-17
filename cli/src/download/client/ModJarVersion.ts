const METADATA_ENTRIES = [
  "fabric.mod.json",
  "META-INF/mods.toml",
  "META-INF/neoforge.mods.toml",
  "mcmod.info",
] as const;

function parseVersion(entry: string, text: string) {
  if (entry === "fabric.mod.json") {
    return (JSON.parse(text) as { version?: unknown }).version;
  }
  if (entry === "mcmod.info") {
    const [mod] = JSON.parse(text) as Array<{ version?: unknown }>;
    return mod?.version;
  }
  // The mod's own entry is the first plain `version` key; dependencies use versionRange.
  return /^\s*version\s*=\s*"([^"]+)"/m.exec(text)?.[1];
}

/** Reads the mod version embedded in a client mod jar, or undefined when it cannot be read. */
export async function readModJarVersion(jarPath: string) {
  const { open, filterEntries, readEntry } = await import("@xmcl/unzip");
  let zip;
  try {
    zip = await open(jarPath, { lazyEntries: true, autoClose: false });
  } catch {
    return undefined;
  }
  try {
    const entries = await filterEntries(zip, [...METADATA_ENTRIES]);
    for (const [index, entry] of entries.entries()) {
      if (!entry) continue;
      const version = parseVersion(
        METADATA_ENTRIES[index],
        (await readEntry(zip, entry)).toString("utf8"),
      );
      if (typeof version === "string") return version;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    zip.close();
  }
}
