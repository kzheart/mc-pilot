import { loadModVariantCatalogSync } from "./ModVariantCatalog.js";

export type ClientLoader = "fabric" | "forge" | "neoforge";
export type CompatibilityValidation = "verified" | "limited" | "planned";

export interface ClientLoaderSupportInfo {
  supported: boolean;
  loaderVersion?: string;
  loaderVersions?: readonly string[];
  modVersion?: string;
  validation?: CompatibilityValidation;
  notes?: string;
}

export interface MinecraftSupportEntry {
  minecraftVersion: string;
  javaVersion: string;
  clients: Record<ClientLoader, ClientLoaderSupportInfo>;
}

export interface ClientSearchResult {
  loader: ClientLoader;
  minecraftVersion: string;
  supported: boolean;
  loaderVersion?: string;
  loaderVersions?: readonly string[];
  modVersion?: string;
  validation?: CompatibilityValidation;
  notes?: string;
  javaVersion: string;
}

const VERSION_MATRIX: readonly MinecraftSupportEntry[] = [
  {
    minecraftVersion: "26.2",
    javaVersion: "25+",
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
    clients: {
      fabric: { supported: false, notes: "使用已验证兼容的 26.1 客户端" },
      forge: { supported: false, notes: "未提供精确 26.1.2 客户端变体" },
      neoforge: { supported: false, notes: "未提供精确 26.1.2 客户端变体" },
    },
  },
  {
    minecraftVersion: "26.1.1",
    javaVersion: "25+",
    clients: {
      fabric: { supported: false, notes: "使用已验证兼容的 26.1 客户端" },
      forge: { supported: false, notes: "未提供精确 26.1.1 客户端变体" },
      neoforge: { supported: false, notes: "未提供精确 26.1.1 客户端变体" },
    },
  },
  {
    minecraftVersion: "26.1",
    javaVersion: "25+",
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
    clients: {
      fabric: { supported: false, notes: "当前未接入此版本 mod" },
      forge: { supported: true, loaderVersion: "36.x", modVersion: "0.9.1" },
      neoforge: { supported: false, notes: "不支持此版本" },
    },
  },
  {
    minecraftVersion: "1.12.2",
    javaVersion: "8",
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
    ...(variant.forgeVersions?.length
      ? { loaderVersions: variant.forgeVersions }
      : {}),
    modVersion: variant.modVersion,
    validation: variant.validation,
    notes: variant.notes,
  };
}

function overlayMinecraftSupport(
  entry: MinecraftSupportEntry,
): MinecraftSupportEntry {
  return {
    minecraftVersion: entry.minecraftVersion,
    javaVersion: entry.javaVersion,
    clients: {
      fabric: overlayClientSupport(entry, "fabric"),
      forge: overlayClientSupport(entry, "forge"),
      neoforge: overlayClientSupport(entry, "neoforge"),
    },
  };
}

export function getVersionMatrix(): MinecraftSupportEntry[] {
  return VERSION_MATRIX.map((entry) => overlayMinecraftSupport(entry));
}

export function getSupportedMinecraftVersions() {
  return VERSION_MATRIX.map((entry) => entry.minecraftVersion);
}

export function getMinecraftSupport(
  version: string,
): MinecraftSupportEntry | undefined {
  const entry = VERSION_MATRIX.find(
    (candidate) => candidate.minecraftVersion === version,
  );
  return entry ? overlayMinecraftSupport(entry) : undefined;
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
      return {
        loader,
        minecraftVersion: entry.minecraftVersion,
        supported: support.supported,
        ...(support.loaderVersion
          ? { loaderVersion: support.loaderVersion }
          : {}),
        ...(support.loaderVersions?.length
          ? { loaderVersions: support.loaderVersions }
          : {}),
        ...(support.modVersion ? { modVersion: support.modVersion } : {}),
        ...(support.validation ? { validation: support.validation } : {}),
        ...(support.notes ? { notes: support.notes } : {}),
        javaVersion: entry.javaVersion,
      };
    }),
  );
}

export function getClientVersionMatrix() {
  return searchClientVersions();
}

export function getClientLoaders(): ClientLoader[] {
  return ["fabric", "forge", "neoforge"];
}
