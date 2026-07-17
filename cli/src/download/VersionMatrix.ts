import { loadModVariantCatalogSync } from "./ModVariantCatalog.js";

export type ServerType =
  | "paper"
  | "purpur"
  | "spigot"
  | "vanilla"
  | "velocity"
  | "bungeecord";
export type ClientLoader = "fabric" | "forge" | "neoforge";
export type CompatibilityValidation = "verified" | "limited" | "planned";

export interface VerifiedClientInfo {
  minecraftVersion: string;
  loader: ClientLoader;
  build?: number;
}

export interface ServerSupportInfo {
  supported: boolean;
  latestBuild?: number;
  requiresBuildTools?: boolean;
  verifiedClients?: readonly VerifiedClientInfo[];
}

export type ProxyType = "velocity" | "bungeecord";

export interface ProxySupportInfo {
  defaultVersion: string;
  latestBuild?: number;
  javaVersion: string;
}

// Proxy 软件独立于 MC 版本矩阵:一个 jar 兼容全部后端版本
export const PROXY_MATRIX: Record<ProxyType, ProxySupportInfo> = {
  velocity: { defaultVersion: "3.4.0", latestBuild: 566, javaVersion: "17+" },
  bungeecord: { defaultVersion: "latest", javaVersion: "8+" },
};

export function isProxyType(type: ServerType): type is ProxyType {
  return type === "velocity" || type === "bungeecord";
}

export interface ClientLoaderSupportInfo {
  supported: boolean;
  loaderVersion?: string;
  modVersion?: string;
  validation?: CompatibilityValidation;
  notes?: string;
}

export interface MinecraftSupportEntry {
  minecraftVersion: string;
  javaVersion: string;
  servers: Record<Exclude<ServerType, ProxyType>, ServerSupportInfo>;
  clients: Record<ClientLoader, ClientLoaderSupportInfo>;
}

interface ResolvedMinecraftSupportEntry {
  minecraftVersion: string;
  javaVersion: string;
  servers: Record<ServerType, ServerSupportInfo>;
  clients: Record<ClientLoader, ClientLoaderSupportInfo>;
}

const UNSUPPORTED_PROXY_SERVER: ServerSupportInfo = { supported: false };

export interface ServerSearchResult {
  type: ServerType;
  minecraftVersion: string;
  supported: boolean;
  latestBuild?: number;
  requiresBuildTools?: boolean;
  verifiedClients?: readonly VerifiedClientInfo[];
}

export interface ServerCatalogEntry {
  version: string;
  build?: string;
  requiresBuildTools?: boolean;
}

export interface ClientSearchResult {
  loader: ClientLoader;
  minecraftVersion: string;
  supported: boolean;
  loaderVersion?: string;
  modVersion?: string;
  validation?: CompatibilityValidation;
  notes?: string;
  javaVersion: string;
  verifiedServers?: readonly VerifiedServerInfo[];
}

export interface VerifiedServerInfo {
  type: Exclude<ServerType, ProxyType>;
  minecraftVersion: string;
  build?: number;
}

const VERSION_MATRIX: readonly MinecraftSupportEntry[] = [
  {
    minecraftVersion: "26.2",
    javaVersion: "25+",
    servers: {
      vanilla: {
        supported: true,
        verifiedClients: [{ minecraftVersion: "26.2", loader: "fabric" }],
      },
      paper: {
        supported: true,
        latestBuild: 60,
        verifiedClients: [
          { minecraftVersion: "26.2", loader: "fabric", build: 60 },
        ],
      },
      purpur: { supported: true, latestBuild: 2607 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.19.3",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: {
        supported: true,
        loaderVersion: "65.0.3",
        modVersion: "0.9.1",
        validation: "verified",
      },
      neoforge: {
        supported: true,
        loaderVersion: "26.2.0.8-beta",
        modVersion: "0.9.1",
        validation: "verified",
      },
    },
  },
  {
    minecraftVersion: "26.1.2",
    javaVersion: "25+",
    servers: {
      vanilla: { supported: true },
      paper: {
        supported: true,
        latestBuild: 74,
        verifiedClients: [
          { minecraftVersion: "26.1", loader: "fabric", build: 74 },
        ],
      },
      purpur: { supported: false },
      spigot: { supported: false },
    },
    clients: {
      fabric: { supported: false, notes: "使用已验证兼容的 26.1 客户端" },
      forge: { supported: false, notes: "未提供精确 26.1.2 客户端变体" },
      neoforge: { supported: false, notes: "未提供精确 26.1.2 客户端变体" },
    },
  },
  {
    minecraftVersion: "26.1.1",
    javaVersion: "25+",
    servers: {
      vanilla: { supported: true },
      paper: {
        supported: true,
        latestBuild: 29,
        verifiedClients: [
          { minecraftVersion: "26.1", loader: "fabric", build: 29 },
        ],
      },
      purpur: { supported: false },
      spigot: { supported: false },
    },
    clients: {
      fabric: { supported: false, notes: "使用已验证兼容的 26.1 客户端" },
      forge: { supported: false, notes: "未提供精确 26.1.1 客户端变体" },
      neoforge: { supported: false, notes: "未提供精确 26.1.1 客户端变体" },
    },
  },
  {
    minecraftVersion: "26.1",
    javaVersion: "25+",
    servers: {
      vanilla: {
        supported: true,
        verifiedClients: [{ minecraftVersion: "26.1", loader: "fabric" }],
      },
      paper: { supported: false },
      purpur: { supported: false },
      spigot: { supported: false },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.19.3",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: {
        supported: true,
        loaderVersion: "62.0.9",
        modVersion: "0.9.1",
        validation: "verified",
      },
      neoforge: {
        supported: true,
        loaderVersion: "26.1.0.19-beta",
        modVersion: "0.9.1",
        validation: "verified",
      },
    },
  },
  {
    minecraftVersion: "1.21.11",
    javaVersion: "21+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 69 },
      purpur: { supported: true, latestBuild: 2568 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.19.2",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: { supported: false, notes: "不支持此版本" },
      neoforge: { supported: false, validation: "planned", notes: "计划中" },
    },
  },
  {
    minecraftVersion: "1.21.4",
    javaVersion: "21+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 170 },
      purpur: { supported: true, latestBuild: 2406 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: { supported: false, notes: "不支持此版本" },
      neoforge: {
        supported: true,
        loaderVersion: "21.4.x",
        modVersion: "0.9.1",
      },
    },
  },
  {
    minecraftVersion: "1.21.1",
    javaVersion: "21+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 119 },
      purpur: { supported: true, latestBuild: 2324 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: { supported: false, notes: "不支持此版本" },
      neoforge: {
        supported: true,
        loaderVersion: "21.1.x",
        modVersion: "0.9.1",
      },
    },
  },
  {
    minecraftVersion: "1.20.4",
    javaVersion: "17+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 496 },
      purpur: { supported: true, latestBuild: 2176 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
      },
      forge: {
        supported: true,
        loaderVersion: "49.0.49",
        modVersion: "0.9.1",
        validation: "limited",
      },
      neoforge: { supported: false, validation: "planned", notes: "计划中" },
    },
  },
  {
    minecraftVersion: "1.20.3",
    javaVersion: "17+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: false },
      purpur: { supported: false },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: {
        supported: true,
        loaderVersion: "48.1.0",
        modVersion: "0.9.1",
        validation: "limited",
      },
      neoforge: { supported: false, notes: "不支持此版本" },
    },
  },
  {
    minecraftVersion: "1.20.2",
    javaVersion: "17+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 318 },
      purpur: { supported: true, latestBuild: 2095 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
      },
      forge: { supported: false, notes: "当前未接入此 loader" },
      neoforge: { supported: false, validation: "planned", notes: "计划中" },
    },
  },
  {
    minecraftVersion: "1.20.1",
    javaVersion: "17+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 196 },
      purpur: { supported: true, latestBuild: 2062 },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
      },
      forge: {
        supported: true,
        loaderVersion: "47.3.0",
        modVersion: "0.9.1",
        validation: "limited",
      },
      neoforge: { supported: false, validation: "planned", notes: "计划中" },
    },
  },
  {
    minecraftVersion: "1.18.2",
    javaVersion: "17+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 388 },
      purpur: { supported: false },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: {
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
        validation: "verified",
      },
      forge: { supported: true, loaderVersion: "40.x", modVersion: "0.9.1" },
      neoforge: { supported: false, notes: "不支持此版本" },
    },
  },
  {
    minecraftVersion: "1.16.5",
    javaVersion: "8+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 794 },
      purpur: { supported: false },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: { supported: false, notes: "当前未接入此版本 mod" },
      forge: { supported: true, loaderVersion: "36.x", modVersion: "0.9.1" },
      neoforge: { supported: false, notes: "不支持此版本" },
    },
  },
  {
    minecraftVersion: "1.12.2",
    javaVersion: "8+",
    servers: {
      vanilla: { supported: true },
      paper: { supported: true, latestBuild: 1620 },
      purpur: { supported: false },
      spigot: { supported: true, requiresBuildTools: true },
    },
    clients: {
      fabric: { supported: false, notes: "不支持此版本" },
      forge: { supported: true, loaderVersion: "14.23.x", modVersion: "0.9.1" },
      neoforge: { supported: false, notes: "不支持此版本" },
    },
  },
] as const;

function overlayClientSupport(
  entry: MinecraftSupportEntry,
  loader: ClientLoader,
): ClientLoaderSupportInfo {
  const catalog = loadModVariantCatalogSync();
  const variant = catalog.variants.find(
    (candidate) =>
      candidate.minecraftVersion === entry.minecraftVersion &&
      candidate.loader === loader,
  );

  if (!variant) {
    return { ...entry.clients[loader] };
  }

  return {
    supported: variant.support === "ready" || variant.support === "configured",
    loaderVersion:
      variant.fabricLoaderVersion ??
      variant.forgeVersion ??
      variant.neoforgeVersion,
    modVersion: variant.modVersion,
    validation: variant.validation,
    notes: variant.notes,
  };
}

function overlayMinecraftSupport(
  entry: MinecraftSupportEntry,
): ResolvedMinecraftSupportEntry {
  return {
    minecraftVersion: entry.minecraftVersion,
    javaVersion: entry.javaVersion,
    servers: {
      ...entry.servers,
      velocity: UNSUPPORTED_PROXY_SERVER,
      bungeecord: UNSUPPORTED_PROXY_SERVER,
    },
    clients: {
      fabric: overlayClientSupport(entry, "fabric"),
      forge: overlayClientSupport(entry, "forge"),
      neoforge: overlayClientSupport(entry, "neoforge"),
    },
  };
}

export function getVersionMatrix(): ResolvedMinecraftSupportEntry[] {
  return VERSION_MATRIX.map((entry) => overlayMinecraftSupport(entry));
}

export function getSupportedMinecraftVersions() {
  return VERSION_MATRIX.map((entry) => entry.minecraftVersion);
}

export function getMinecraftSupport(
  version: string,
): ResolvedMinecraftSupportEntry | undefined {
  const entry = VERSION_MATRIX.find(
    (candidate) => candidate.minecraftVersion === version,
  );
  return entry ? overlayMinecraftSupport(entry) : undefined;
}

export function searchServerVersions(filter?: {
  type?: Exclude<ServerType, ProxyType>;
  version?: string;
}) {
  const types = filter?.type ? [filter.type] : getServerTypes();
  const entries = filter?.version
    ? VERSION_MATRIX.filter(
        (entry) => entry.minecraftVersion === filter.version,
      )
    : VERSION_MATRIX;

  return types.flatMap((type) =>
    entries.map<ServerSearchResult>((entry) => ({
      type,
      minecraftVersion: entry.minecraftVersion,
      supported: entry.servers[type].supported,
      latestBuild: entry.servers[type].latestBuild,
      requiresBuildTools: entry.servers[type].requiresBuildTools,
      ...(entry.servers[type].verifiedClients?.length
        ? { verifiedClients: entry.servers[type].verifiedClients }
        : {}),
    })),
  );
}

function getVerifiedServers(
  minecraftVersion: string,
  loader: ClientLoader,
): VerifiedServerInfo[] {
  return VERSION_MATRIX.flatMap((entry) =>
    getServerTypes().flatMap((type) => {
      const support = entry.servers[type];
      const verified = support.verifiedClients?.find(
        (client) =>
          client.minecraftVersion === minecraftVersion &&
          client.loader === loader,
      );
      if (!verified) {
        return [];
      }
      return [
        {
          type,
          minecraftVersion: entry.minecraftVersion,
          ...(verified.build != null ? { build: verified.build } : {}),
        },
      ];
    }),
  );
}

export function searchClientVersions(filter?: {
  loader?: ClientLoader;
  version?: string;
}) {
  const loaders = filter?.loader ? [filter.loader] : getClientLoaders();
  const entries = filter?.version
    ? VERSION_MATRIX.filter(
        (entry) => entry.minecraftVersion === filter.version,
      )
    : VERSION_MATRIX;

  return loaders.flatMap((loader) =>
    entries.map<ClientSearchResult>((entry) => {
      const support = overlayClientSupport(entry, loader);
      const verifiedServers = getVerifiedServers(
        entry.minecraftVersion,
        loader,
      );
      return {
        loader,
        minecraftVersion: entry.minecraftVersion,
        supported: support.supported,
        ...(support.loaderVersion
          ? { loaderVersion: support.loaderVersion }
          : {}),
        ...(support.modVersion ? { modVersion: support.modVersion } : {}),
        ...(support.validation ? { validation: support.validation } : {}),
        ...(support.notes ? { notes: support.notes } : {}),
        javaVersion: entry.javaVersion,
        ...(verifiedServers.length > 0 ? { verifiedServers } : {}),
      };
    }),
  );
}

export function getServerVersionMatrix() {
  return searchServerVersions();
}

export function getClientVersionMatrix() {
  return searchClientVersions();
}

export function getServerVersionCatalog(): Record<
  Exclude<ServerType, ProxyType>,
  ServerCatalogEntry[]
> {
  return getServerTypes().reduce<
    Record<Exclude<ServerType, ProxyType>, ServerCatalogEntry[]>
  >(
    (catalog, type) => {
      catalog[type] = VERSION_MATRIX.filter(
        (entry) => entry.servers[type].supported,
      ).map((entry) => ({
        version: entry.minecraftVersion,
        build:
          entry.servers[type].latestBuild != null
            ? String(entry.servers[type].latestBuild)
            : undefined,
        requiresBuildTools: entry.servers[type].requiresBuildTools,
      }));
      return catalog;
    },
    {
      vanilla: [],
      paper: [],
      purpur: [],
      spigot: [],
    },
  );
}

export function getServerTypes(): Exclude<ServerType, ProxyType>[] {
  return ["vanilla", "paper", "purpur", "spigot"];
}

export function getClientLoaders(): ClientLoader[] {
  return ["fabric", "forge", "neoforge"];
}
