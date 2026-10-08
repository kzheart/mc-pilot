export type LoaderType = "fabric" | "forge" | "neoforge";

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

export interface ClientRuntimeEntry {
  pid: number;
  name: string;
  wsPort: number;
  startedAt: string;
  logPath: string;
  instanceDir: string;
}

export interface GlobalClientState {
  defaultClient?: string;
  clients: Record<string, ClientRuntimeEntry>;
}
