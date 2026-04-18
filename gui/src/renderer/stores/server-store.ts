import { create } from "zustand";

interface ServerRuntimeEntry {
  pid: number;
  project: string;
  name: string;
  port: number;
  startedAt: string;
  logPath: string;
  instanceDir: string;
  stdinPipe?: string;
}

interface ServerInstanceMeta {
  name: string;
  project: string;
  type: string;
  mcVersion: string;
  port: number;
  jvmArgs: string[];
  createdAt: string;
  instanceDir?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  rootDir?: string;
  servers: ServerInstanceMeta[];
}

interface ServerStore {
  runtime: Record<string, ServerRuntimeEntry>;
  projects: ProjectInfo[];
  loading: boolean;
  fetch: () => Promise<void>;
  execServerAction: (
    action: string,
    name: string,
    extraArgs?: string[]
  ) => Promise<{ success: boolean; error?: unknown }>;
}

export const useServerStore = create<ServerStore>((set) => ({
  runtime: {},
  projects: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    const [stateResult, projects] = await Promise.all([
      window.electronAPI.getServerState(),
      window.electronAPI.getProjects()
    ]);
    set({
      runtime: stateResult.servers ?? {},
      projects: projects ?? [],
      loading: false
    });
  },

  execServerAction: async (action, name, extraArgs = []) => {
    const result = await window.electronAPI.execMct([
      "server",
      action,
      name,
      ...extraArgs
    ]);
    if (result.success) {
      // refresh after action
      const [stateResult, projects] = await Promise.all([
        window.electronAPI.getServerState(),
        window.electronAPI.getProjects()
      ]);
      set({ runtime: stateResult.servers ?? {}, projects: projects ?? [] });
    }
    return result;
  }
}));
