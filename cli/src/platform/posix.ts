/**
 * POSIX (macOS/Linux) platform adapter: ps/lsof/process groups for process
 * control, a filesystem FIFO plus bash wrapper for the server stdin channel.
 */
import { execFile, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { MctError } from "../util/errors.js";
import type {
  PlatformAdapter,
  ProcessControl,
  ServerSpawnSpec,
  ServerStdinChannel,
} from "./types.js";

const execFileAsync = promisify(execFile);

const OPEN_RETRY_INTERVAL_MS = 50;
const DEFAULT_SEND_TIMEOUT_MS = 5_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const processes: ProcessControl = {
  killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      process.kill(pid, signal);
    }
  },

  isInProcessTree(pid: number, rootPid: number): boolean {
    if (pid === rootPid) return true;

    const result = spawnSync("ps", ["-Ao", "pid=,ppid="], {
      encoding: "utf8",
    });
    if (result.status !== 0 || !result.stdout) {
      return false;
    }

    const parentOf = new Map<number, number>();
    for (const line of result.stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 2) continue;
      const child = Number(parts[0]);
      const parent = Number(parts[1]);
      if (Number.isInteger(child) && Number.isInteger(parent)) {
        parentOf.set(child, parent);
      }
    }

    let current = pid;
    // walk up the tree; depth cap guards against ppid cycles in a stale snapshot
    for (let depth = 0; depth < 128; depth++) {
      const parent = parentOf.get(current);
      if (parent === undefined || parent <= 1) return false;
      if (parent === rootPid) return true;
      current = parent;
    }
    return false;
  },

  getListeningPids(port: number): number[] {
    const result = spawnSync(
      "lsof",
      ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
      {
        encoding: "utf8",
      },
    );
    if (result.status !== 0 || !result.stdout) {
      return [];
    }

    return result.stdout
      .split(/\s+/)
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isInteger(entry) && entry > 0);
  },

  findPidsByCommandLine(fragment: string): number[] {
    const result = spawnSync("pgrep", ["-f", fragment], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) {
      return [];
    }
    return result.stdout
      .split(/\s+/)
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isInteger(entry) && entry > 0);
  },
};

const serverStdin: ServerStdinChannel = {
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
  },

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
  },

  async cleanup(stdinPipe: string): Promise<void> {
    try {
      await unlink(stdinPipe);
    } catch {
      /* ignore */
    }
  },

  buildServerSpawn(spec: {
    stdinChannel: string;
    javaCommand: string;
    launchArgs: string[];
  }): ServerSpawnSpec {
    // Use bash wrapper: hold FIFO open in read-write mode (fd 3 <>) to prevent EOF
    // without blocking (write-only > would block until a reader opens the other end),
    // then exec java with stdin reading from the FIFO
    return {
      command: "bash",
      args: [
        "-c",
        'exec 3<>"$MCT_STDIN_PIPE"; exec "$MCT_SERVER_JAVA" "$@" 0<&3',
        "mct-server",
        ...spec.launchArgs,
      ],
      env: {
        MCT_STDIN_PIPE: spec.stdinChannel,
        MCT_SERVER_JAVA: spec.javaCommand,
      },
    };
  },
};

export const posixAdapter: PlatformAdapter = { processes, serverStdin };
