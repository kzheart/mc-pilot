import { create } from "zustand";

export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  jarFile: string;
  dependencies: string[];
  tags: string[];
  addedAt: string;
}

interface PluginStore {
  plugins: PluginEntry[];
  loading: boolean;
  searchQuery: string;

  fetch: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  addPlugin: (jarPath: string) => Promise<{ success: boolean; error?: unknown }>;
  updatePlugin: (id: string, fields: Record<string, string>) => Promise<{ success: boolean; error?: unknown }>;
  removePlugin: (id: string) => Promise<{ success: boolean; error?: unknown }>;
  installPlugin: (id: string, project: string, server: string) => Promise<{ success: boolean; error?: unknown }>;
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  loading: false,
  searchQuery: "",

  fetch: async () => {
    set({ loading: true });
    const result = await window.electronAPI.execMct(["plugin", "list"]);
    if (result.success && result.data) {
      const data = result.data as { plugins: PluginEntry[] };
      set({ plugins: data.plugins ?? [], loading: false });
    } else {
      set({ plugins: [], loading: false });
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  addPlugin: async (jarPath) => {
    const result = await window.electronAPI.execMct(["plugin", "add", jarPath]);
    if (result.success) await get().fetch();
    return result;
  },

  updatePlugin: async (id, fields) => {
    const args = ["plugin", "update", id];
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        const flag = `--${key}`;
        args.push(flag, value);
      }
    }
    const result = await window.electronAPI.execMct(args);
    if (result.success) await get().fetch();
    return result;
  },

  removePlugin: async (id) => {
    const result = await window.electronAPI.execMct(["plugin", "remove", id]);
    if (result.success) await get().fetch();
    return result;
  },

  installPlugin: async (id, project, server) => {
    return window.electronAPI.execMct([
      "plugin", "install", id, "--server", server, "--project", project
    ]);
  }
}));
