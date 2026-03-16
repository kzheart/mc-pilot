import { mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import type { CommandContext } from "../util/context.js";
import { MctError } from "../util/errors.js";
import { getListeningPids, isProcessRunning, killProcessTree } from "../util/process.js";
import { WebSocketClient } from "./WebSocketClient.js";

export interface ClientRuntimeState {
  name: string;
  version?: string;
  account?: string;
  server?: string;
  wsPort: number;
  headless: boolean;
  pid: number;
  startedAt: string;
  logPath: string;
}

interface ClientStateSnapshot {
  defaultClient?: string;
  clients: Record<string, ClientRuntimeState>;
}

export interface LaunchClientOptions {
  name: string;
  version?: string;
  account?: string;
  server?: string;
  wsPort?: number;
  headless?: boolean;
}

const CLIENT_STATE_FILE = "clients.json";

function getDefaultSnapshot(): ClientStateSnapshot {
  return {
    clients: {}
  };
}

export class ClientManager {
  constructor(private readonly context: CommandContext) {}

  async launch(options: LaunchClientOptions) {
    const snapshot = await this.getSnapshot();
    const existing = snapshot.clients[options.name];
    if (existing && isProcessRunning(existing.pid)) {
      throw new MctError(
        {
          code: "CLIENT_ALREADY_RUNNING",
          message: `Client ${options.name} is already running`,
          details: existing
        },
        3
      );
    }

    const configured = this.context.config.clients[options.name] ?? {};
    const wsPort = options.wsPort ?? configured.wsPort;
    if (!wsPort) {
      throw new MctError(
        {
          code: "INVALID_PARAMS",
          message: `Client ${options.name} requires wsPort`
        },
        4
      );
    }

    const launchCommand = configured.launchCommand;
    if (!launchCommand || launchCommand.length === 0) {
      throw new MctError(
        {
          code: "INVALID_PARAMS",
          message: `Client ${options.name} requires launchCommand in config`
        },
        4
      );
    }

    const cwd = configured.workingDir
      ? path.resolve(this.context.cwd, configured.workingDir)
      : this.context.cwd;

    mkdirSync(path.join(this.context.state.getRootDir(), "logs"), { recursive: true });
    const logPath = path.join(this.context.state.getRootDir(), "logs", `client-${options.name}.log`);
    const stdout = openSync(logPath, "a");

    const child = spawn(launchCommand[0], launchCommand.slice(1), {
      cwd,
      detached: true,
      stdio: ["ignore", stdout, stdout],
      env: {
        ...process.env,
        ...configured.env,
        MCT_CLIENT_NAME: options.name,
        MCT_CLIENT_VERSION: options.version ?? configured.version ?? "",
        MCT_CLIENT_ACCOUNT: options.account ?? configured.account ?? "",
        MCT_CLIENT_SERVER: options.server ?? configured.server ?? "",
        MCT_CLIENT_WS_PORT: String(wsPort),
        MCT_CLIENT_HEADLESS: String(options.headless ?? configured.headless ?? false)
      }
    });

    child.unref();

    const clientState: ClientRuntimeState = {
      name: options.name,
      version: options.version ?? configured.version,
      account: options.account ?? configured.account,
      server: options.server ?? configured.server,
      wsPort,
      headless: options.headless ?? configured.headless ?? false,
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      logPath
    };

    snapshot.defaultClient ??= options.name;
    snapshot.clients[options.name] = clientState;
    await this.writeSnapshot(snapshot);

    return clientState;
  }

  async stop(name: string) {
    const snapshot = await this.getSnapshot();
    const client = snapshot.clients[name];

    if (!client) {
      return {
        stopped: false,
        name
      };
    }

    if (isProcessRunning(client.pid)) {
      killProcessTree(client.pid);
    }

    for (const pid of getListeningPids(client.wsPort)) {
      if (pid !== client.pid) {
        killProcessTree(pid);
      }
    }

    delete snapshot.clients[name];
    if (snapshot.defaultClient === name) {
      snapshot.defaultClient = Object.keys(snapshot.clients)[0];
    }
    await this.writeSnapshot(snapshot);

    return {
      stopped: true,
      name,
      pid: client.pid
    };
  }

  async list() {
    const snapshot = await this.getSnapshot();
    const clients = await Promise.all(
      Object.values(snapshot.clients).map(async (client) => {
        const running = isProcessRunning(client.pid);
        if (!running) {
          const wsReachable = await this.isWsReachable(client.wsPort, 1);
          if (wsReachable) {
            return {
              ...client,
              running: true,
              detached: true
            };
          }

          return {
            ...client,
            running: false,
            stale: true
          };
        }

        return {
          ...client,
          running: true
        };
      })
    );

    return {
      defaultClient: snapshot.defaultClient,
      clients
    };
  }

  async waitReady(name: string, timeoutSeconds: number) {
    const client = await this.getClient(name);
    const ws = new WebSocketClient(this.getWsUrl(client.wsPort));
    return ws.ping(timeoutSeconds);
  }

  async getClient(name?: string) {
    const snapshot = await this.getSnapshot();
    const resolvedName = name ?? snapshot.defaultClient;
    if (!resolvedName) {
      throw new MctError(
        {
          code: "CLIENT_NOT_FOUND",
          message: "No client is configured or running"
        },
        3
      );
    }

    const client = snapshot.clients[resolvedName];
    if (!client) {
      throw new MctError(
        {
          code: "CLIENT_NOT_FOUND",
          message: `Client ${resolvedName} was not found`
        },
        3
      );
    }

    if (!isProcessRunning(client.pid) && !(await this.isWsReachable(client.wsPort, 1))) {
      throw new MctError(
        {
          code: "CLIENT_NOT_RUNNING",
          message: `Client ${resolvedName} is not running`
        },
        3
      );
    }

    return client;
  }

  getWsUrl(wsPort: number) {
    return `ws://127.0.0.1:${wsPort}`;
  }

  private async getSnapshot() {
    return this.context.state.readJson<ClientStateSnapshot>(CLIENT_STATE_FILE, getDefaultSnapshot());
  }

  private async writeSnapshot(snapshot: ClientStateSnapshot) {
    await this.context.state.writeJson(CLIENT_STATE_FILE, snapshot);
  }

  private async isWsReachable(wsPort: number, timeoutSeconds: number) {
    try {
      const ws = new WebSocketClient(this.getWsUrl(wsPort));
      await ws.ping(timeoutSeconds);
      return true;
    } catch {
      return false;
    }
  }
}
