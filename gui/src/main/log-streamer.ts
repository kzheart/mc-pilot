import { watch, type FSWatcher } from "chokidar";
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import type { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "./ipc-channels";

interface LogStream {
  watcher: FSWatcher;
  offset: number;
  filePath: string;
}

const streams = new Map<string, LogStream>();

export async function startLogStream(
  key: string,
  logPath: string,
  win: BrowserWindow
): Promise<void> {
  stopLogStream(key);

  // Read existing content first
  const initialLines: string[] = [];
  try {
    const rl = createInterface({
      input: createReadStream(logPath, { encoding: "utf-8" })
    });
    for await (const line of rl) {
      initialLines.push(line);
    }
  } catch {
    // file may not exist yet
  }

  // Send initial content
  if (initialLines.length > 0 && !win.isDestroyed()) {
    const text = initialLines.join("\r\n") + "\r\n";
    win.webContents.send(IPC_CHANNELS.LOG_STREAM_DATA, key, text);
  }

  // Track file size for incremental reads
  let currentSize = 0;
  try {
    currentSize = statSync(logPath).size;
  } catch {
    // ignore
  }

  // Watch for changes
  const watcher = watch(logPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 }
  });

  const stream: LogStream = { watcher, offset: currentSize, filePath: logPath };
  streams.set(key, stream);

  watcher.on("change", () => {
    try {
      const newSize = statSync(logPath).size;
      if (newSize <= stream.offset) {
        // File was truncated, reset
        stream.offset = 0;
      }

      const readStream = createReadStream(logPath, {
        encoding: "utf-8",
        start: stream.offset
      });

      let newData = "";
      readStream.on("data", (chunk: string) => {
        newData += chunk;
      });
      readStream.on("end", () => {
        stream.offset = newSize;
        if (newData && !win.isDestroyed()) {
          // Convert \n to \r\n for xterm
          const formatted = newData.replace(/\n/g, "\r\n");
          win.webContents.send(IPC_CHANNELS.LOG_STREAM_DATA, key, formatted);
        }
      });
    } catch {
      // ignore read errors
    }
  });
}

export function stopLogStream(key: string): void {
  const stream = streams.get(key);
  if (stream) {
    stream.watcher.close();
    streams.delete(key);
  }
}

export function stopAllLogStreams(): void {
  for (const [, stream] of streams) {
    stream.watcher.close();
  }
  streams.clear();
}
