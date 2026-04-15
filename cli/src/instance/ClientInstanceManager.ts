import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { GlobalStateStore } from "../util/global-state.js";
import type { ClientInstanceMeta, ClientRuntimeEntry, LoaderType } from "../util/instance-types.js";
import { resolveMctHome, resolveClientInstanceDir, resolveClientsDir } from "../util/paths.js";
import { MctError } from "../util/errors.js";
import { getListeningPids, isProcessRunning, killProcessTree } from "../util/process.js";
import { WebSocketClient } from "../client/WebSocketClient.js";

const INSTANCE_FILE = "instance.json";

function getLaunchScriptPath() {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/instance/ClientInstanceManager.js -> scripts/launch-fabric-client.mjs
  return path.resolve(path.dirname(thisFile), "..", "..", "scripts", "launch-fabric-client.mjs");
}

export interface CreateClientOptions {
  name: string;
  loader?: LoaderType;
  version: string;
  wsPort?: number;
  account?: string;
  headless?: boolean;
  launchArgs?: string[];
  env?: Record<string, string>;
}

export interface LaunchClientOptions {
  server?: string;
  account?: string;
  wsPort?: number;
  headless?: boolean;
  force?: boolean;
}

export interface WaitReadyOptions {
  requireWorld?: boolean;
}

export class ClientInstanceManager {
  constructor(private readonly globalState: GlobalStateStore) {}

  async create(options: CreateClientOptions): Promise<ClientInstanceMeta> {
    const instanceDir = resolveClientInstanceDir(options.name);
    await mkdir(instanceDir, { recursive: true });

    const wsPort = options.wsPort ?? (await this.findAvailablePort());

    const meta: ClientInstanceMeta = {
      name: options.name,
      loader: options.loader ?? "fabric",
      mcVersion: options.version,
      wsPort,
      account: options.account,
      headless: options.headless,
      launchArgs: options.launchArgs,
      env: options.env,
      createdAt: new Date().toISOString()
    };

    await writeFile(path.join(instanceDir, INSTANCE_FILE), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return meta;
  }

  async launch(clientName: string, options: LaunchClientOptions = {}): Promise<ClientRuntimeEntry> {
    let state = await this.globalState.readClientState();
    const existing = state.clients[clientName];

    if (existing && isProcessRunning(existing.pid)) {
      if (options.force) {
        await this.stop(clientName);
        state = await this.globalState.readClientState();
      } else {
        throw new MctError(
          {
            code: "CLIENT_ALREADY_RUNNING",
            message: `Client ${clientName} is already running. Pass --force to kill and relaunch.`,
            details: existing
          },
          3
        );
      }
    }

    const meta = await this.loadMeta(clientName);
    const instanceDir = resolveClientInstanceDir(clientName);
    const wsPort = options.wsPort ?? meta.wsPort;

    if (!meta.launchArgs || meta.launchArgs.length === 0) {
      throw new MctError(
        { code: "INVALID_PARAMS", message: `Client ${clientName} has no launchArgs configured` },
        4
      );
    }

    // Kill any existing processes on the port
    const listeningPids = getListeningPids(wsPort);
    for (const pid of listeningPids) {
      killProcessTree(pid);
    }
    if (listeningPids.length > 0) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (getListeningPids(wsPort).length === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const launchCommand = [process.execPath, getLaunchScriptPath(), ...meta.launchArgs];
    const minecraftDir = path.join(instanceDir, "minecraft");

    const logsDir = path.join(resolveMctHome(), "logs");
    mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `client-${clientName}.log`);
    const stdout = openSync(logPath, "a");

    const child = spawn(launchCommand[0], launchCommand.slice(1), {
      cwd: minecraftDir,
      detached: true,
      stdio: ["ignore", stdout, stdout],
      env: {
        ...process.env,
        ...meta.env,
        MCT_CLIENT_NAME: clientName,
        MCT_CLIENT_VERSION: meta.mcVersion,
        MCT_CLIENT_ACCOUNT: options.account ?? meta.account ?? "",
        MCT_CLIENT_SERVER: options.server ?? "",
        MCT_CLIENT_WS_PORT: String(wsPort),
        MCT_CLIENT_HEADLESS: String(options.headless ?? meta.headless ?? false)
      }
    });

    child.unref();

    const entry: ClientRuntimeEntry = {
      pid: child.pid ?? 0,
      name: clientName,
      wsPort,
      startedAt: new Date().toISOString(),
      logPath,
      instanceDir
    };

    state.defaultClient ??= clientName;
    state.clients[clientName] = entry;
    await this.globalState.writeClientState(state);

    return entry;
  }

  async stop(clientName: string) {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];

    if (!entry) {
      return { stopped: false, alreadyStopped: true, name: clientName };
    }

    if (isProcessRunning(entry.pid)) {
      killProcessTree(entry.pid);
    }

    for (const pid of getListeningPids(entry.wsPort)) {
      if (pid !== entry.pid) {
        killProcessTree(pid);
      }
    }

    delete state.clients[clientName];
    if (state.defaultClient === clientName) {
      state.defaultClient = Object.keys(state.clients)[0];
    }
    await this.globalState.writeClientState(state);

    return { stopped: true, name: clientName, pid: entry.pid };
  }

  async isAlreadyRunning(clientName: string): Promise<boolean> {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];
    return Boolean(entry && isProcessRunning(entry.pid));
  }

  async reconnect(clientName: string, address: string) {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];

    if (!entry) {
      throw new MctError(
        { code: "CLIENT_NOT_FOUND", message: `Client ${clientName} is not running` },
        3
      );
    }

    const ws = new WebSocketClient(`ws://127.0.0.1:${entry.wsPort}`);
    const response = (await ws.send("client.reconnect", { address }, 5)) as {
      error?: { code: string; message?: string };
      data?: unknown;
    };

    if (response.error) {
      throw new MctError(
        {
          code: response.error.code || "INTERNAL_ERROR",
          message: response.error.message || `Reconnect failed for ${clientName}`
        },
        3
      );
    }

    return { reconnected: true, name: clientName, address };
  }

  async list() {
    const state = await this.globalState.readClientState();
    const runningClients = state.clients;

    // List all installed instances
    const clientsDir = resolveClientsDir();
    const instances: Array<ClientInstanceMeta & { running: boolean; pid?: number }> = [];

    try {
      const entries = await readdir(clientsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const meta = await this.loadMeta(entry.name);
            const runtime = runningClients[entry.name];
            const running = runtime ? isProcessRunning(runtime.pid) : false;
            instances.push({ ...meta, running, pid: runtime?.pid });
          } catch {
            // not a valid instance
          }
        }
      }
    } catch {
      // clients dir doesn't exist yet
    }

    return {
      defaultClient: state.defaultClient,
      clients: instances
    };
  }

  async waitReady(clientName: string, timeoutSeconds: number, options: WaitReadyOptions = {}) {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];

    if (!entry) {
      throw new MctError(
        { code: "CLIENT_NOT_FOUND", message: `Client ${clientName} is not running` },
        3
      );
    }

    const wsUrl = `ws://127.0.0.1:${entry.wsPort}`;
    const deadline = Date.now() + timeoutSeconds * 1000;
    const requireWorld = options.requireWorld ?? true;

    // 阶段 A：等 WS 连通
    let connected = false;
    let lastConnectError: string | undefined;
    while (Date.now() < deadline) {
      try {
        const ws = new WebSocketClient(wsUrl);
        await ws.ping(1);
        connected = true;
        break;
      } catch (err) {
        lastConnectError = err instanceof Error ? err.message : String(err);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (!connected) {
      const diag = this.buildDiagnostics(entry.pid, entry.wsPort, {
        wsConnected: false,
        inWorld: false,
        lastError: lastConnectError
      });
      throw new MctError(
        {
          code: "TIMEOUT",
          message: `Timed out after ${timeoutSeconds}s waiting for client ${clientName} (${wsUrl}). ${this.formatDiagnostics(diag)}`,
          details: diag
        },
        2
      );
    }

    if (!requireWorld) {
      return { connected: true, url: wsUrl };
    }

    // 阶段 B：轮询 position.get 直到不再 NOT_IN_WORLD
    let lastErrorCode = "NOT_IN_WORLD";
    while (Date.now() < deadline) {
      try {
        const ws = new WebSocketClient(wsUrl);
        const response = (await ws.send("position.get", {}, 1)) as {
          error?: { code: string; message?: string };
          data?: unknown;
        };
        if (!response.error) {
          return { connected: true, url: wsUrl, inWorld: true, position: response.data };
        }
        lastErrorCode = response.error.code || lastErrorCode;
        if (lastErrorCode !== "NOT_IN_WORLD") {
          break;
        }
      } catch (err) {
        lastErrorCode = err instanceof Error ? `WS_ERROR(${err.message})` : "WS_ERROR";
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const diag = this.buildDiagnostics(entry.pid, entry.wsPort, {
      wsConnected: true,
      inWorld: false,
      lastError: lastErrorCode
    });
    throw new MctError(
      {
        code: "TIMEOUT",
        message: `Timed out after ${timeoutSeconds}s waiting for client ${clientName} to join a world (${wsUrl}). ${this.formatDiagnostics(diag)} Tip: try \`mct client reconnect --address <server>\` or \`mct client launch --force\`.`,
        details: diag
      },
      2
    );
  }

  private buildDiagnostics(
    pid: number,
    wsPort: number,
    extras: { wsConnected: boolean; inWorld: boolean; lastError?: string }
  ) {
    const processAlive = isProcessRunning(pid);
    const portListening = getListeningPids(wsPort).length > 0;
    return {
      pid,
      processAlive,
      wsPort,
      portListening,
      wsConnected: extras.wsConnected,
      inWorld: extras.inWorld,
      lastError: extras.lastError
    };
  }

  private formatDiagnostics(diag: {
    processAlive: boolean;
    portListening: boolean;
    wsConnected: boolean;
    inWorld: boolean;
    lastError?: string;
  }): string {
    const parts = [
      `processAlive=${diag.processAlive}`,
      `portListening=${diag.portListening}`,
      `wsConnected=${diag.wsConnected}`,
      `inWorld=${diag.inWorld}`
    ];
    if (diag.lastError) {
      parts.push(`lastError=${diag.lastError}`);
    }
    return `Diagnostics: ${parts.join(", ")}.`;
  }

  async getClient(name?: string): Promise<ClientRuntimeEntry> {
    const state = await this.globalState.readClientState();
    const resolvedName = name ?? state.defaultClient;

    if (!resolvedName) {
      throw new MctError(
        { code: "CLIENT_NOT_FOUND", message: "No client is configured or running" },
        3
      );
    }

    const entry = state.clients[resolvedName];
    if (!entry) {
      throw new MctError(
        { code: "CLIENT_NOT_FOUND", message: `Client ${resolvedName} was not found` },
        3
      );
    }

    if (!isProcessRunning(entry.pid) && !(await this.isWsReachable(entry.wsPort, 1))) {
      throw new MctError(
        { code: "CLIENT_NOT_RUNNING", message: `Client ${resolvedName} is not running` },
        3
      );
    }

    return entry;
  }

  async loadMeta(clientName: string): Promise<ClientInstanceMeta> {
    const instanceDir = resolveClientInstanceDir(clientName);
    const metaPath = path.join(instanceDir, INSTANCE_FILE);

    try {
      const raw = await readFile(metaPath, "utf8");
      return JSON.parse(raw) as ClientInstanceMeta;
    } catch {
      throw new MctError(
        { code: "INSTANCE_NOT_FOUND", message: `Client instance ${clientName} not found` },
        3
      );
    }
  }

  async updateMeta(clientName: string, updates: Partial<ClientInstanceMeta>): Promise<ClientInstanceMeta> {
    const meta = await this.loadMeta(clientName);
    const updated = { ...meta, ...updates };
    const instanceDir = resolveClientInstanceDir(clientName);
    await writeFile(path.join(instanceDir, INSTANCE_FILE), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    return updated;
  }

  private async isWsReachable(wsPort: number, timeoutSeconds: number): Promise<boolean> {
    try {
      const ws = new WebSocketClient(`ws://127.0.0.1:${wsPort}`);
      await ws.ping(timeoutSeconds);
      return true;
    } catch {
      return false;
    }
  }

  private async findAvailablePort(): Promise<number> {
    const state = await this.globalState.readClientState();
    const usedPorts = new Set(Object.values(state.clients).map((c) => c.wsPort));

    // Also check installed instances
    const clientsDir = resolveClientsDir();
    try {
      const entries = await readdir(clientsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const meta = await this.loadMeta(entry.name);
            usedPorts.add(meta.wsPort);
          } catch {}
        }
      }
    } catch {}

    let port = 25580;
    while (usedPorts.has(port)) {
      port += 1;
    }

    return port;
  }
}
