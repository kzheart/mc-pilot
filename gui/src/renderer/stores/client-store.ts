import { create } from "zustand";

interface ClientRuntimeEntry {
  pid: number;
  name: string;
  wsPort: number;
  startedAt: string;
  logPath: string;
  instanceDir: string;
}

interface ClientInstanceMeta {
  name: string;
  loader: string;
  mcVersion: string;
  wsPort: number;
  account?: string;
  headless?: boolean;
  createdAt: string;
}

interface ClientStore {
  runtime: Record<string, ClientRuntimeEntry>;
  instances: ClientInstanceMeta[];
  loading: boolean;
  fetch: () => Promise<void>;
  execClientAction: (
    action: string,
    name: string,
    extraArgs?: string[]
  ) => Promise<{ success: boolean; error?: unknown }>;
}

export const useClientStore = create<ClientStore>((set) => ({
  runtime: {},
  instances: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    const [stateResult, instances] = await Promise.all([
      window.electronAPI.getClientState(),
      window.electronAPI.getClientInstances()
    ]);
    set({
      runtime: stateResult.clients ?? {},
      instances: instances ?? [],
      loading: false
    });
  },

  execClientAction: async (action, name, extraArgs = []) => {
    const result = await window.electronAPI.execMct([
      "client",
      action,
      name,
      ...extraArgs
    ]);
    if (result.success) {
      const [stateResult, instances] = await Promise.all([
        window.electronAPI.getClientState(),
        window.electronAPI.getClientInstances()
      ]);
      set({ runtime: stateResult.clients ?? {}, instances: instances ?? [] });
    }
    return result;
  }
}));
