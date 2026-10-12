import {
  compareMinecraftVersions,
  loadModVariantCatalogSync,
} from "./ModVariantCatalog.js";
import type {
  LoaderType,
  ModVariant,
  ModVariantCatalog,
  ValidationLevel,
} from "./types.js";

export type ClientLoader = LoaderType;
export type CompatibilityValidation = ValidationLevel;

export interface ClientLoaderSupportInfo {
  /** A configured client variant exists; runtime evidence is in validation. */
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

export interface ClientSearchResult extends ClientLoaderSupportInfo {
  loader: ClientLoader;
  minecraftVersion: string;
  javaVersion: string;
}

// These discovery rows explain versions without an exact client artifact. They
// never grant support or duplicate variant versions/validation. Server provider
// compatibility is a separate concern and must not imply client availability.
const COMPATIBILITY_NOTES: Readonly<
  Record<
    string,
    { javaVersion: string; clientNotes?: Partial<Record<ClientLoader, string>> }
  >
> = {
  "26.1.2": {
    javaVersion: "25+",
    clientNotes: { fabric: "使用已验证兼容的 26.1 客户端" },
  },
  "26.1.1": {
    javaVersion: "25+",
    clientNotes: { fabric: "使用已验证兼容的 26.1 客户端" },
  },
  "1.20.3": { javaVersion: "17+" },
  "1.16.5": { javaVersion: "8+" },
};

function describeJavaRequirement(variants: readonly ModVariant[]): string {
  // A version-level requirement must satisfy every loader's bounds. The default
  // minimum matches ClientDownloader for catalogs without explicit Java data.
  const minimum = Math.max(
    ...variants.map((variant) => variant.javaVersion ?? 17),
  );
  const maximum = Math.min(
    ...variants.map((variant) => variant.javaVersionMax ?? Infinity),
  );
  if (maximum < minimum) {
    throw new Error(
      `Conflicting Java bounds for ${variants[0]?.minecraftVersion}`,
    );
  }
  if (maximum === minimum) return String(minimum);
  return maximum === Infinity ? `${minimum}+` : `${minimum}-${maximum}`;
}

function describeClientSupport(
  minecraftVersion: string,
  loader: ClientLoader,
  variant?: ModVariant,
): ClientLoaderSupportInfo {
  if (!variant) {
    const metadata = COMPATIBILITY_NOTES[minecraftVersion];
    return {
      supported: false,
      notes:
        metadata?.clientNotes?.[loader] ??
        (metadata
          ? `未提供精确 ${minecraftVersion} 客户端变体`
          : "不支持此版本"),
    };
  }

  return {
    supported: variant.support === "ready" || variant.support === "configured",
    loaderVersion:
      variant.fabricLoaderVersion ??
      variant.forgeVersion ??
      variant.neoforgeVersion,
    ...(variant.forgeVersions?.length
      ? { loaderVersions: [...variant.forgeVersions] }
      : {}),
    modVersion: variant.modVersion,
    validation: variant.validation,
    notes: variant.notes,
  };
}

export function getVersionMatrix(
  catalog: ModVariantCatalog = loadModVariantCatalogSync(),
): MinecraftSupportEntry[] {
  const variantsByVersion = new Map<string, ModVariant[]>();
  for (const variant of catalog.variants) {
    const variants = variantsByVersion.get(variant.minecraftVersion) ?? [];
    variants.push(variant);
    variantsByVersion.set(variant.minecraftVersion, variants);
  }
  const versions = new Set([
    ...variantsByVersion.keys(),
    ...Object.keys(COMPATIBILITY_NOTES),
  ]);

  return [...versions]
    .sort((left, right) => compareMinecraftVersions(right, left))
    .map((minecraftVersion) => {
      const variants = variantsByVersion.get(minecraftVersion) ?? [];
      const clients = Object.fromEntries(
        getClientLoaders().map((loader) => [
          loader,
          describeClientSupport(
            minecraftVersion,
            loader,
            variants.find((variant) => variant.loader === loader),
          ),
        ]),
      ) as Record<ClientLoader, ClientLoaderSupportInfo>;
      return {
        minecraftVersion,
        javaVersion: variants.length
          ? describeJavaRequirement(variants)
          : COMPATIBILITY_NOTES[minecraftVersion]!.javaVersion,
        clients,
      };
    });
}

export function getSupportedMinecraftVersions(
  catalog: ModVariantCatalog = loadModVariantCatalogSync(),
) {
  return getVersionMatrix(catalog).map((entry) => entry.minecraftVersion);
}

export function getMinecraftSupport(
  version: string,
  catalog: ModVariantCatalog = loadModVariantCatalogSync(),
): MinecraftSupportEntry | undefined {
  return getVersionMatrix(catalog).find(
    (entry) => entry.minecraftVersion === version,
  );
}

export function searchClientVersions(
  filter?: { loader?: ClientLoader; version?: string },
  catalog: ModVariantCatalog = loadModVariantCatalogSync(),
) {
  const loaders = filter?.loader ? [filter.loader] : getClientLoaders();
  const entries = getVersionMatrix(catalog).filter(
    (entry) => !filter?.version || entry.minecraftVersion === filter.version,
  );

  return loaders.flatMap((loader) =>
    entries.map<ClientSearchResult>((entry) => {
      const support = entry.clients[loader];
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

export function getClientVersionMatrix(
  catalog: ModVariantCatalog = loadModVariantCatalogSync(),
) {
  return searchClientVersions(undefined, catalog);
}

export function getClientLoaders(): ClientLoader[] {
  return ["fabric", "forge", "neoforge"];
}
