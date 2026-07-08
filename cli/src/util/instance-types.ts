export type ServerType =
  | "paper"
  | "purpur"
  | "spigot"
  | "vanilla"
  | "velocity"
  | "bungeecord";
export type LoaderType = "fabric" | "forge" | "neoforge";

export interface ServerInstanceMeta {
  name: string;
  project: string;
  type: ServerType;
  mcVersion: string;
  port: number;
  jvmArgs: string[];
  javaCommand?: string;
  javaVersion?: number;
  /** Synced to server.properties on start. Defaults to false (offline test clients). */
  onlineMode?: boolean;
  /** Proxy topology (only present on velocity/bungeecord instances). */
  proxy?: {
    /** backend name -> "host:port" */
    servers: Record<string, string>;
    try: string[];
    forwarding: "modern" | "legacy";
  };
  createdAt: string;
}

export interface ClientInstanceMeta {
  name: string;
  loader: LoaderType;
  mcVersion: string;
  wsPort: number;
  account?: string;
  headless?: boolean;
  mute?: boolean;
  launchArgs?: string[];
  env?: Record<string, string>;
  javaCommand?: string;
  javaVersion?: number;
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
  logStartOffset?: number;
  stdinPipe?: string;
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
