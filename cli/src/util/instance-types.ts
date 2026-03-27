export type ServerType = "paper" | "purpur" | "vanilla" | "spigot";
export type LoaderType = "fabric" | "forge" | "neoforge";

export interface ServerInstanceMeta {
  name: string;
  project: string;
  type: ServerType;
  mcVersion: string;
  port: number;
  jvmArgs: string[];
  createdAt: string;
}

export interface ClientInstanceMeta {
  name: string;
  loader: LoaderType;
  mcVersion: string;
  wsPort: number;
  account?: string;
  headless?: boolean;
  launchArgs?: string[];
  env?: Record<string, string>;
  createdAt: string;
}

export interface ServerRuntimeEntry {
  pid: number;
  project: string;
  name: string;
  port: number;
  startedAt: string;
  logPath: string;
  instanceDir: string;
}

export interface ClientRuntimeEntry {
  pid: number;
  name: string;
  wsPort: number;
  startedAt: string;
  logPath: string;
  instanceDir: string;
}

export interface GlobalServerState {
  servers: Record<string, ServerRuntimeEntry>;
}

export interface GlobalClientState {
  defaultClient?: string;
  clients: Record<string, ClientRuntimeEntry>;
}
