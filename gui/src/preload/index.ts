import { contextBridge, ipcRenderer } from "electron";

const IPC = {
  GET_SERVER_STATE: "get-server-state",
  GET_CLIENT_STATE: "get-client-state",
  GET_PROJECTS: "get-projects",
  GET_CLIENT_INSTANCES: "get-client-instances",
  EXEC_MCT: "exec-mct",
  STATE_CHANGED: "state-changed",
  TAIL_LOG: "tail-log",
  SELECT_FILE: "select-file",
  PTY_SPAWN: "pty-spawn",
  PTY_WRITE: "pty-write",
  PTY_RESIZE: "pty-resize",
  PTY_KILL: "pty-kill",
  PTY_DATA: "pty-data",
  PTY_EXIT: "pty-exit",
  PTY_HAS_SESSION: "pty-has-session",
  PTY_GET_SCROLLBACK: "pty-get-scrollback",
  OPEN_PATH: "open-path"
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
  },

  // PTY
  ptySpawn: (project: string, name: string) =>
    ipcRenderer.invoke(IPC.PTY_SPAWN, project, name) as Promise<{ success: boolean; error?: string }>,
  ptyWrite: (key: string, data: string) => ipcRenderer.invoke(IPC.PTY_WRITE, key, data),
  ptyResize: (key: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC.PTY_RESIZE, key, cols, rows),
  ptyKill: (key: string) => ipcRenderer.invoke(IPC.PTY_KILL, key),
  ptyHasSession: (key: string) =>
    ipcRenderer.invoke(IPC.PTY_HAS_SESSION, key) as Promise<boolean>,
  ptyGetScrollback: (key: string) =>
    ipcRenderer.invoke(IPC.PTY_GET_SCROLLBACK, key) as Promise<string | null>,
  onPtyData: (callback: (key: string, data: string) => void) => {
    const handler = (_: unknown, key: string, data: string) => callback(key, data);
    ipcRenderer.on(IPC.PTY_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler);
  },
  onPtyExit: (callback: (key: string) => void) => {
    const handler = (_: unknown, key: string) => callback(key);
    ipcRenderer.on(IPC.PTY_EXIT, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler);
  },

  // Open path in system file manager
  openPath: (dirPath: string) => ipcRenderer.invoke(IPC.OPEN_PATH, dirPath)
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld("electronAPI", api);
