/**
 * Windows platform adapter: taskkill/CIM/netstat for process control, a named
 * pipe served by a bridge process (stdin-bridge.ts) for the server stdin
 * channel.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MctError } from "../util/errors.js";
import type {
  PlatformAdapter,
  ProcessControl,
  ServerSpawnSpec,
  ServerStdinChannel,
} from "./types.js";

const OPEN_RETRY_INTERVAL_MS = 50;
const DEFAULT_SEND_TIMEOUT_MS = 5_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStdinBridgePath() {
  // dist/platform/windows.js -> dist/platform/stdin-bridge.js
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "stdin-bridge.js",
  );
}

/**
 * Named pipe path for a server's stdin channel. The pipe object is owned by
 * the stdin-bridge process that wraps the server; it vanishes with the
 * process, so there is nothing to create or unlink on the filesystem.
 */
export function windowsStdinPipeName(project: string, serverName: string) {
  const safe = `${project}-${serverName}`.replace(/[\\/:*?"<>|]/g, "-");
  return `\\\\.\\pipe\\mct-stdin-${safe}`;
}

const processes: ProcessControl = {
  killProcessTree(pid: number) {
    // Windows has no process groups or graceful console signals for detached
    // processes; taskkill /T terminates the whole tree.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  },

  isInProcessTree(pid: number, rootPid: number): boolean {
    if (pid === rootPid) return true;

    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0 || !result.stdout) {
      return false;
    }

    const parentOf = new Map<number, number>();
    for (const line of result.stdout.split(/\r?\n/)) {
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
    // netstat ships with every Windows install; states are not localized.
    const result = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) {
      return [];
    }

    const pids = new Set<number>();
    for (const line of result.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      // TCP  0.0.0.0:25565  0.0.0.0:0  LISTENING  5076
      if (parts.length !== 5) continue;
      if (parts[0] !== "TCP" || parts[3] !== "LISTENING") continue;
      if (!parts[1].endsWith(`:${port}`)) continue;
      const pid = Number(parts[4]);
      if (Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }
    return [...pids];
  },

  findPidsByCommandLine(fragment: string): number[] {
    const escaped = fragment.replace(/'/g, "''").replace(/[[\]?*]/g, "`$&");
    // The query's own command line contains the fragment; exclude any process
    // that is itself running this CIM query (mirrors pgrep's self-exclusion).
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.CommandLine -notlike '*Get-CimInstance Win32_Process*' -and $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: "utf8" },
    );
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
    _stateDir: string,
    project: string,
    serverName: string,
  ): Promise<string> {
    return windowsStdinPipeName(project, serverName);
  },

  /**
   * Connect to the named pipe owned by the stdin-bridge process and write one
   * command line. ENOENT means the bridge has not created the pipe yet
   * (server still starting); retry until the deadline, mirroring the POSIX
   * ENXIO behavior.
   */
  async send(
    pipeName: string,
    command: string,
    timeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  ): Promise<void> {
    const line = `${command}\n`;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.connect(pipeName);
          socket.once("error", (error) => {
            socket.destroy();
            reject(error);
          });
          socket.once("connect", () => {
            socket.end(line, () => resolve());
          });
        });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const retryable =
          code === "ENOENT" || code === "EPIPE" || code === "ECONNREFUSED";
        if (retryable && Date.now() < deadline) {
          await wait(OPEN_RETRY_INTERVAL_MS);
          continue;
        }
        throw new MctError(
          {
            code: "SERVER_STDIN_OPEN_FAILED",
            message:
              code === "ENOENT"
                ? `No listener on stdin pipe (server process not running?): ${pipeName}`
                : `Failed to open stdin pipe: ${(error as Error).message}`,
            details: { stdinPipe: pipeName },
          },
          5,
        );
      }
    }
  },

  async cleanup(): Promise<void> {
    // Named pipes disappear with their owning process; nothing to remove.
  },

  buildServerSpawn(spec: {
    stdinChannel: string;
    javaCommand: string;
    launchArgs: string[];
  }): ServerSpawnSpec {
    // Windows has no filesystem FIFOs: run the server under a small bridge
    // process that serves the stdin named pipe (stdin-bridge.ts).
    return {
      command: process.execPath,
      args: [
        getStdinBridgePath(),
        spec.stdinChannel,
        spec.javaCommand,
        ...spec.launchArgs,
      ],
    };
  },
};

export const windowsAdapter: PlatformAdapter = { processes, serverStdin };
