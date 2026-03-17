import { searchClientVersions, searchServerVersions, type ClientLoader, type ServerType } from "./VersionMatrix.js";

export interface ServerSearchCommandResult {
  type: ServerType;
  versions: Array<{
    version: string;
    build?: string;
    requiresBuildTools?: boolean;
  }>;
}

export interface ClientSearchCommandResult {
  version: string;
  javaVersion: string;
  loaders: Array<{
    loader: ClientLoader;
    supported: boolean;
    loaderVersion?: string;
    modVersion?: string;
    validation?: "verified" | "limited" | "planned";
    notes?: string;
  }>;
}

export function buildServerSearchResults(filter?: {
  type?: ServerType;
  version?: string;
}): ServerSearchCommandResult[] {
  const grouped = new Map<ServerType, ServerSearchCommandResult>();

  for (const entry of searchServerVersions(filter).filter((item) => item.supported)) {
    const current = grouped.get(entry.type) ?? {
      type: entry.type,
      versions: []
    };

    current.versions.push({
      version: entry.minecraftVersion,
      ...(entry.latestBuild != null ? { build: String(entry.latestBuild) } : {}),
      ...(entry.requiresBuildTools ? { requiresBuildTools: true } : {})
    });
    grouped.set(entry.type, current);
  }

  return [...grouped.values()];
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
      loaders: []
    };

    current.loaders.push({
      loader: entry.loader,
      supported: entry.supported,
      ...(entry.loaderVersion ? { loaderVersion: entry.loaderVersion } : {}),
      ...(entry.modVersion ? { modVersion: entry.modVersion } : {}),
      ...(entry.validation ? { validation: entry.validation } : {}),
      ...(entry.notes ? { notes: entry.notes } : {})
    });
    grouped.set(entry.minecraftVersion, current);
  }

  return [...grouped.values()];
}
