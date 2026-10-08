import { searchClientVersions, type ClientLoader } from "./VersionMatrix.js";

export interface ClientSearchCommandResult {
  version: string;
  javaVersion: string;
  loaders: Array<{
    loader: ClientLoader;
    supported: boolean;
    loaderVersion?: string;
    loaderVersions?: readonly string[];
    modVersion?: string;
    validation?: "verified" | "limited" | "planned";
    notes?: string;
  }>;
}

export function buildClientSearchResults(filter?: {
  loader?: ClientLoader;
  version?: string;
}): ClientSearchCommandResult[] {
  const grouped = new Map<string, ClientSearchCommandResult>();

  for (const entry of searchClientVersions(filter)) {
    const current = grouped.get(entry.minecraftVersion) ?? {
      version: entry.minecraftVersion,
      javaVersion: entry.javaVersion,
      loaders: [],
    };

    current.loaders.push({
      loader: entry.loader,
      supported: entry.supported,
      ...(entry.loaderVersion ? { loaderVersion: entry.loaderVersion } : {}),
      ...(entry.loaderVersions?.length
        ? { loaderVersions: entry.loaderVersions }
        : {}),
      ...(entry.modVersion ? { modVersion: entry.modVersion } : {}),
      ...(entry.validation ? { validation: entry.validation } : {}),
      ...(entry.notes ? { notes: entry.notes } : {}),
    });
    grouped.set(entry.minecraftVersion, current);
  }

  return [...grouped.values()];
}
