import { ipcMain, dialog, BrowserWindow } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { IPC_CHANNELS } from "./ipc-channels";
import {
  readServerState,
  readClientState,
  listProjects,
  listClientInstances
} from "./data-reader";
import { execMct } from "./cli-bridge";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, hasSession } from "./pty-manager";
import { startLogStream, stopLogStream } from "./log-streamer";

export function registerIpcHandlers(win: BrowserWindow): void {
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

  // PTY handlers
  ipcMain.handle(IPC_CHANNELS.PTY_SPAWN, async (_, project: string, name: string) => {
    return ptySpawn(project, name, win);
  });

  ipcMain.handle(IPC_CHANNELS.PTY_WRITE, (_, key: string, data: string) => {
    ptyWrite(key, data);
  });

  ipcMain.handle(IPC_CHANNELS.PTY_RESIZE, (_, key: string, cols: number, rows: number) => {
    ptyResize(key, cols, rows);
  });

  ipcMain.handle(IPC_CHANNELS.PTY_KILL, (_, key: string) => {
    ptyKill(key);
  });

  ipcMain.handle(IPC_CHANNELS.PTY_HAS_SESSION, (_, key: string) => {
    return hasSession(key);
  });

  // Log stream handlers
  ipcMain.handle(IPC_CHANNELS.LOG_STREAM_START, async (_, key: string, logPath: string) => {
    await startLogStream(key, logPath, win);
  });

  ipcMain.handle(IPC_CHANNELS.LOG_STREAM_STOP, (_, key: string) => {
    stopLogStream(key);
  });

  // Write to server stdin via FIFO
  ipcMain.handle(IPC_CHANNELS.WRITE_SERVER_STDIN, (_, pipePath: string, data: string) => {
    return new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(pipePath, { flags: "a" });
      ws.write(data, (err) => {
        ws.end();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
