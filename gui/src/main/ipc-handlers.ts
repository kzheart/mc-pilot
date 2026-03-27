import { ipcMain, dialog } from "electron";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { IPC_CHANNELS } from "./ipc-channels";
import {
  readServerState,
  readClientState,
  listProjects,
  listClientInstances
} from "./data-reader";
import { execMct } from "./cli-bridge";

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GET_SERVER_STATE, async () => {
    return readServerState();
  });

  ipcMain.handle(IPC_CHANNELS.GET_CLIENT_STATE, async () => {
    return readClientState();
  });

  ipcMain.handle(IPC_CHANNELS.GET_PROJECTS, async () => {
    return listProjects();
  });

  ipcMain.handle(IPC_CHANNELS.GET_CLIENT_INSTANCES, async () => {
    return listClientInstances();
  });

  ipcMain.handle(IPC_CHANNELS.EXEC_MCT, async (_, args: string[]) => {
    return execMct(args);
  });

  ipcMain.handle(
    IPC_CHANNELS.TAIL_LOG,
    async (event, logPath: string, maxLines: number = 200) => {
      const lines: string[] = [];
      try {
        const stream = createReadStream(logPath, { encoding: "utf-8" });
        const rl = createInterface({ input: stream });
        for await (const line of rl) {
          lines.push(line);
          if (lines.length > maxLines) lines.shift();
        }
      } catch {
        // file may not exist
      }
      return lines;
    }
  );

  ipcMain.handle(IPC_CHANNELS.SELECT_FILE, async (_, options?: { filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showOpenDialog({
      filters: options?.filters ?? [{ name: "JAR Files", extensions: ["jar"] }],
      properties: ["openFile"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
