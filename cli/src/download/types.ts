export type LoaderType = "fabric" | "forge" | "neoforge";
export type ServerType = "paper" | "purpur" | "spigot" | "vanilla";
export type SupportLevel = "ready" | "configured" | "planned" | "unsupported";
export type ValidationLevel = "verified" | "limited" | "planned";

export interface ModVariant {
  id: string;
  minecraftVersion: string;
  loader: LoaderType;
  support: SupportLevel;
  validation: ValidationLevel;
  modVersion?: string;
  fabricLoaderVersion?: string;
  yarnMappings?: string;
  forgeVersion?: string;
  neoforgeVersion?: string;
  javaVersion?: number;
  notes?: string;
}

export interface ModVariantCatalog {
  defaultVariant: string;
  variants: ModVariant[];
}

export interface ServerVersionSupport {
  type: ServerType;
  version: string;
  support: Exclude<SupportLevel, "unsupported">;
  notes?: string;
}

export interface ClientVersionSupport {
  version: string;
  loader: LoaderType;
  support: SupportLevel;
  validation: ValidationLevel;
  loaderVersion?: string;
  modVersion?: string;
  notes?: string;
}
