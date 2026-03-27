import { watch, type FSWatcher } from "chokidar";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { getStateDir } from "./data-reader";
import { IPC_CHANNELS } from "./ipc-channels";

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startStateWatcher(win: BrowserWindow): void {
  const stateDir = getStateDir();
  const serversFile = join(stateDir, "servers.json");
  const clientsFile = join(stateDir, "clients.json");

  watcher = watch([serversFile, clientsFile], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 }
  });

  watcher.on("change", (filePath) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const type = filePath.endsWith("servers.json") ? "servers" : "clients";
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.STATE_CHANGED, type);
      }
    }, 100);
  });
}

export function stopStateWatcher(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
