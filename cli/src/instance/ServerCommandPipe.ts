import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { MctError } from "../util/errors.js";

const execFileAsync = promisify(execFile);

const OPEN_RETRY_INTERVAL_MS = 50;
const DEFAULT_SEND_TIMEOUT_MS = 5_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ServerCommandPipe {
  async create(
    stateDir: string,
    project: string,
    serverName: string,
  ): Promise<string> {
    const stdinPipe = path.join(
      stateDir,
      `stdin-${project}-${serverName}.fifo`,
    );
    try {
      await unlink(stdinPipe);
    } catch {
      // stale pipe may not exist
    }
    await execFileAsync("mkfifo", [stdinPipe]);
    return stdinPipe;
  }

  async send(
    stdinPipe: string,
    command: string,
    timeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  ): Promise<void> {
    const line = `${command}\n`;
    const deadline = Date.now() + timeoutMs;

    // A plain blocking open(fifo, "w") parks a libuv threadpool thread until a
    // reader appears; with no reader it never returns, and a few of these
    // exhaust the pool and stall every fs operation in the process. Open
    // non-blocking instead: ENXIO (no reader yet) is retried until the timeout.
    let handle: FileHandle;
    for (;;) {
      try {
        handle = await open(
          stdinPipe,
          constants.O_WRONLY | constants.O_NONBLOCK,
        );
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENXIO" && Date.now() < deadline) {
          await wait(OPEN_RETRY_INTERVAL_MS);
          continue;
        }
        throw new MctError(
          {
            code: "SERVER_STDIN_OPEN_FAILED",
            message:
              code === "ENXIO"
                ? `No reader on stdin FIFO after ${timeoutMs}ms (server process not consuming stdin?)`
                : `Failed to open stdin FIFO: ${(error as Error).message}`,
            details: { stdinPipe },
          },
          5,
        );
      }
    }

    try {
      // Command lines are far below PIPE_BUF, so a write either succeeds
      // atomically or fails with EAGAIN when the pipe buffer is full; retry
      // EAGAIN until the deadline.
      for (;;) {
        try {
          await handle.writeFile(line);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EAGAIN" && Date.now() < deadline) {
            await wait(OPEN_RETRY_INTERVAL_MS);
            continue;
          }
          throw new MctError(
            {
              code: "SERVER_STDIN_WRITE_FAILED",
              message: `Failed to write to stdin FIFO: ${(error as Error).message}`,
              details: { stdinPipe },
            },
            5,
          );
        }
      }
    } finally {
      await handle.close();
    }
  }
}
