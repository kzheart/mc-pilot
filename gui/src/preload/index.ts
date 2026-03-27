import { contextBridge, ipcRenderer } from "electron";

const IPC = {
  GET_SERVER_STATE: "get-server-state",
  GET_CLIENT_STATE: "get-client-state",
  GET_PROJECTS: "get-projects",
  GET_CLIENT_INSTANCES: "get-client-instances",
  EXEC_MCT: "exec-mct",
  STATE_CHANGED: "state-changed",
  TAIL_LOG: "tail-log",
  SELECT_FILE: "select-file"
} as const;

const api = {
  getServerState: () => ipcRenderer.invoke(IPC.GET_SERVER_STATE),
  getClientState: () => ipcRenderer.invoke(IPC.GET_CLIENT_STATE),
  getProjects: () => ipcRenderer.invoke(IPC.GET_PROJECTS),
  getClientInstances: () => ipcRenderer.invoke(IPC.GET_CLIENT_INSTANCES),
  execMct: (args: string[]) => ipcRenderer.invoke(IPC.EXEC_MCT, args),
  tailLog: (logPath: string, maxLines?: number) =>
    ipcRenderer.invoke(IPC.TAIL_LOG, logPath, maxLines),
  selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke(IPC.SELECT_FILE, options) as Promise<string | null>,
  onStateChange: (callback: (type: "servers" | "clients") => void) => {
    const handler = (_: unknown, type: "servers" | "clients") => callback(type);
    ipcRenderer.on(IPC.STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.STATE_CHANGED, handler);
  }
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld("electronAPI", api);
