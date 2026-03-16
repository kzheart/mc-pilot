import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import type { CommandContext } from "../util/context.js";
import { MctError } from "../util/errors.js";
import { waitForTcpPort } from "../util/net.js";
import { isProcessRunning, killProcessTree } from "../util/process.js";

export interface ServerRuntimeState {
  pid: number;
  jar: string;
  dir: string;
  port: number;
  startedAt: string;
  logPath: string;
}

export interface StartServerOptions {
  jar?: string;
  dir?: string;
  port?: number;
  eula?: boolean;
}

const SERVER_STATE_FILE = "server.json";

export class ServerManager {
  constructor(private readonly context: CommandContext) {}

  async start(options: StartServerOptions) {
    const existing = await this.getState();
    if (existing && isProcessRunning(existing.pid)) {
      throw new MctError(
        {
          code: "SERVER_ALREADY_RUNNING",
          message: "Server is already running",
          details: existing
        },
        5
      );
    }

    const jar = options.jar ?? this.context.config.server.jar;
    if (!jar) {
      throw new MctError(
        {
          code: "INVALID_PARAMS",
          message: "Server jar is required"
        },
        4
      );
    }

    const dir = path.resolve(this.context.cwd, options.dir ?? this.context.config.server.dir);
    const port = options.port ?? this.context.config.server.port;

    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(this.context.state.getRootDir(), "logs"), { recursive: true });

    if (options.eula) {
      writeFileSync(path.join(dir, "eula.txt"), "eula=true\n", "utf8");
    }

    const logPath = path.join(this.context.state.getRootDir(), "logs", "paper-server.log");
    const stdout = openSync(logPath, "a");
    const child = spawn(
      "java",
      [...this.context.config.server.jvmArgs, "-jar", path.resolve(this.context.cwd, jar), "nogui"],
      {
        cwd: dir,
        detached: true,
        stdio: ["ignore", stdout, stdout],
        env: {
          ...process.env,
          MCT_SERVER_PORT: String(port)
        }
      }
    );

    child.unref();

    const state: ServerRuntimeState = {
      pid: child.pid ?? 0,
      jar: path.resolve(this.context.cwd, jar),
      dir,
      port,
      startedAt: new Date().toISOString(),
      logPath
    };

    await this.context.state.writeJson(SERVER_STATE_FILE, state);
    return {
      running: true,
      ...state
    };
  }

  async stop() {
    const state = await this.getState();
    if (!state) {
      return {
        running: false,
        stopped: false
      };
    }

    if (isProcessRunning(state.pid)) {
      killProcessTree(state.pid);
    }

    await this.context.state.remove(SERVER_STATE_FILE);
    return {
      running: false,
      stopped: true,
      pid: state.pid
    };
  }

  async status() {
    const state = await this.getState();
    if (!state) {
      return {
        running: false
      };
    }

    const running = isProcessRunning(state.pid);
    if (!running) {
      await this.context.state.remove(SERVER_STATE_FILE);
      return {
        running: false,
        stale: true,
        ...state
      };
    }

    return {
      running: true,
      ...state
    };
  }

  async waitReady(timeoutSeconds: number) {
    const state = await this.getState();
    if (!state) {
      throw new MctError(
        {
          code: "SERVER_NOT_RUNNING",
          message: "Server is not running"
        },
        5
      );
    }

    return waitForTcpPort("127.0.0.1", state.port, timeoutSeconds);
  }

  async getState() {
    return this.context.state.readJson<ServerRuntimeState | null>(SERVER_STATE_FILE, null);
  }
}
