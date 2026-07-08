import {
  isProxyType,
  PROXY_MATRIX,
  searchClientVersions,
  searchServerVersions,
  type ClientLoader,
  type ProxyType,
  type ServerType,
} from "./VersionMatrix.js";

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

function buildProxySearchResult(
  proxyType: ProxyType,
): ServerSearchCommandResult {
  const info = PROXY_MATRIX[proxyType];
  return {
    type: proxyType,
    versions: [
      {
        version: info.defaultVersion,
        ...(info.latestBuild != null
          ? { build: String(info.latestBuild) }
          : {}),
      },
    ],
  };
}

export function buildServerSearchResults(filter?: {
  type?: ServerType;
  version?: string;
}): ServerSearchCommandResult[] {
  if (filter?.type && isProxyType(filter.type)) {
    return [buildProxySearchResult(filter.type)];
  }

  const grouped = new Map<ServerType, ServerSearchCommandResult>();

  const gameFilter: Parameters<typeof searchServerVersions>[0] =
    filter?.type !== undefined
      ? {
          type: filter.type as Exclude<ServerType, ProxyType>,
          version: filter.version,
        }
      : filter?.version !== undefined
        ? { version: filter.version }
        : undefined;

  for (const entry of searchServerVersions(gameFilter).filter(
    (item) => item.supported,
  )) {
    const current = grouped.get(entry.type) ?? {
      type: entry.type,
      versions: [],
    };

    current.versions.push({
      version: entry.minecraftVersion,
      ...(entry.latestBuild != null
        ? { build: String(entry.latestBuild) }
        : {}),
      ...(entry.requiresBuildTools ? { requiresBuildTools: true } : {}),
    });
    grouped.set(entry.type, current);
  }

  const results = [...grouped.values()];

  if (!filter?.type && !filter?.version) {
    results.push(
      buildProxySearchResult("velocity"),
      buildProxySearchResult("bungeecord"),
    );
  }

  return results;
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
      ...(entry.modVersion ? { modVersion: entry.modVersion } : {}),
      ...(entry.validation ? { validation: entry.validation } : {}),
      ...(entry.notes ? { notes: entry.notes } : {}),
    });
    grouped.set(entry.minecraftVersion, current);
  }

  return [...grouped.values()];
}
