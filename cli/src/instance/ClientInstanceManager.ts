import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { GlobalStateStore } from "../util/global-state.js";
import type {
  ClientInstanceMeta,
  ClientRuntimeEntry,
  GlobalClientState,
  LoaderType,
  ResourcePackPolicy,
} from "../util/instance-types.js";
import {
  resolveMctHome,
  resolveClientInstanceDir,
  resolveClientsDir,
} from "../util/paths.js";
import { MctError } from "../util/errors.js";
import {
  getListeningPids,
  isInProcessTree,
  isProcessRunning,
  killProcessTree,
} from "../util/process.js";
import { WebSocketClient } from "../client/WebSocketClient.js";

const INSTANCE_FILE = "instance.json";
const DEFAULT_CLIENT_MUTE = true;
const CLIENT_STOP_TIMEOUT_MS = 15_000;
const CLIENT_PORT_RELEASE_TIMEOUT_MS = 10_000;
const CLIENT_STOP_POLL_MS = 250;
/** How many times wait-ready may re-issue a reconnect within one window. */
const WAIT_READY_MAX_RECONNECTS = 3;
const WAIT_READY_RECONNECT_BACKOFF_MS = 4_000;
/**
 * Visible titles of screens a client never leaves without being told to
 * reconnect. Used as a fallback because the mod classifies screens by class
 * name, which is obfuscated on production clients.
 */
const STUCK_SCREEN_TITLES = [
  "disconnect",
  "failed to connect",
  "can't connect",
  "cannot connect",
  "connection lost",
  "connection failed",
  "无法连接",
  "连接失败",
  "连接丢失",
  "断开",
  "已断开",
  "minecraft", // vanilla title screen
];

function getLaunchScriptPath() {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/instance/ClientInstanceManager.js -> scripts/launch-fabric-client.mjs
  return path.resolve(
    path.dirname(thisFile),
    "..",
    "..",
    "scripts",
    "launch-fabric-client.mjs",
  );
}

export interface CreateClientOptions {
  name: string;
  loader?: LoaderType;
  version: string;
  wsPort?: number;
  account?: string;
  headless?: boolean;
  mute?: boolean;
  resourcePackPolicy?: ResourcePackPolicy;
  launchArgs?: string[];
  env?: Record<string, string>;
  javaCommand?: string;
  javaVersion?: number;
}

export interface LaunchClientOptions {
  server?: string;
  account?: string;
  wsPort?: number;
  headless?: boolean;
  mute?: boolean;
  resourcePackPolicy?: ResourcePackPolicy;
  force?: boolean;
}

export interface WaitReadyOptions {
  requireWorld?: boolean;
  reconnectAddress?: string;
}

interface ResourcePackStatus {
  policy?: ResourcePackPolicy;
  state?: string;
  pending?: boolean;
  loaded?: boolean;
  lifecycleSupported?: boolean;
  required?: boolean;
  error?: string;
}

function isResourcePackPending(status: ResourcePackStatus | undefined) {
  return (
    status?.pending === true ||
    ["prompt", "accepted", "downloading", "applying"].includes(
      status?.state ?? "",
    )
  );
}

export class ClientInstanceManager {
  constructor(private readonly globalState: GlobalStateStore) {}

  async create(options: CreateClientOptions): Promise<ClientInstanceMeta> {
    return this.globalState.withClientLock(async () => {
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
        mute: options.mute ?? DEFAULT_CLIENT_MUTE,
        resourcePackPolicy: options.resourcePackPolicy,
        launchArgs: options.launchArgs,
        env: options.env,
        javaCommand: options.javaCommand,
        javaVersion: options.javaVersion,
        createdAt: new Date().toISOString(),
      };

      await writeFile(
        path.join(instanceDir, INSTANCE_FILE),
        `${JSON.stringify(meta, null, 2)}\n`,
        "utf8",
      );
      return meta;
    });
  }

  async launch(
    clientName: string,
    options: LaunchClientOptions = {},
  ): Promise<ClientRuntimeEntry> {
    return this.globalState.withClientLock(async () => {
      const state = await this.globalState.readClientState();
      const existing = state.clients[clientName];

      if (existing && isProcessRunning(existing.pid)) {
        if (options.force) {
          await this.stopTrackedClient(state, clientName, existing);
        } else {
          throw new MctError(
            {
              code: "CLIENT_ALREADY_RUNNING",
              message: `Client ${clientName} is already running. Pass --force to kill and relaunch.`,
              details: existing,
            },
            3,
          );
        }
      }

      const meta = await this.loadMeta(clientName);
      const instanceDir = resolveClientInstanceDir(clientName);
      const wsPort = options.wsPort ?? meta.wsPort;
      const mute = options.mute ?? meta.mute ?? DEFAULT_CLIENT_MUTE;
      const resourcePackPolicy =
        options.resourcePackPolicy ?? meta.resourcePackPolicy;

      if (!meta.launchArgs || meta.launchArgs.length === 0) {
        throw new MctError(
          {
            code: "INVALID_PARAMS",
            message: `Client ${clientName} has no launchArgs configured`,
          },
          4,
        );
      }

      this.requireOwnedPortListeners(wsPort, clientName);

      const launchCommand = [
        process.execPath,
        getLaunchScriptPath(),
        ...meta.launchArgs,
      ];
      const minecraftDir = path.join(instanceDir, "minecraft");

      const logsDir = path.join(resolveMctHome(), "logs");
      await mkdir(logsDir, { recursive: true });
      const logPath = path.join(logsDir, `client-${clientName}.log`);
      const stdout = await open(logPath, "a");

      const child = spawn(launchCommand[0], launchCommand.slice(1), {
        cwd: minecraftDir,
        detached: true,
        stdio: ["ignore", stdout.fd, stdout.fd],
        env: {
          ...process.env,
          ...meta.env,
          MCT_CLIENT_NAME: clientName,
          MCT_CLIENT_VERSION: meta.mcVersion,
          MCT_CLIENT_ACCOUNT: options.account ?? meta.account ?? "",
          MCT_CLIENT_SERVER: options.server ?? "",
          MCT_CLIENT_WS_PORT: String(wsPort),
          MCT_CLIENT_HEADLESS: String(
            options.headless ?? meta.headless ?? false,
          ),
          ...(meta.javaCommand ? { MCT_CLIENT_JAVA: meta.javaCommand } : {}),
          ...(mute === undefined ? {} : { MCT_CLIENT_MUTE: String(mute) }),
          ...(resourcePackPolicy === undefined
            ? {}
            : { MCT_CLIENT_RESOURCE_PACK_POLICY: resourcePackPolicy }),
        },
      });

      child.once("exit", () => {
        void stdout.close();
      });
      child.once("error", () => {
        void stdout.close();
      });
      child.unref();

      const entry: ClientRuntimeEntry = {
        pid: child.pid ?? 0,
        name: clientName,
        wsPort,
        startedAt: new Date().toISOString(),
        logPath,
        instanceDir,
      };

      state.defaultClient ??= clientName;
      state.clients[clientName] = entry;
      await this.globalState.writeClientState(state);

      return entry;
    });
  }

  async stop(clientName: string) {
    return this.globalState.withClientLock(async () => {
      const state = await this.globalState.readClientState();
      const entry = state.clients[clientName];

      if (!entry) {
        return { stopped: false, alreadyStopped: true, name: clientName };
      }

      await this.stopTrackedClient(state, clientName, entry);
      await this.globalState.writeClientState(state);

      return { stopped: true, name: clientName, pid: entry.pid };
    });
  }

  async isAlreadyRunning(clientName: string): Promise<boolean> {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];
    return Boolean(entry && isProcessRunning(entry.pid));
  }

  async reconnect(
    clientName: string,
    address: string,
    options: { resourcePackPolicy?: ResourcePackPolicy } = {},
  ) {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];

    if (!entry) {
      throw new MctError(
        {
          code: "CLIENT_NOT_FOUND",
          message: `Client ${clientName} is not running`,
        },
        3,
      );
    }

    const ws = new WebSocketClient(`ws://127.0.0.1:${entry.wsPort}`);
    const response = (await ws.send(
      "client.reconnect",
      {
        address,
        ...(options.resourcePackPolicy === undefined
          ? {}
          : { resourcePackPolicy: options.resourcePackPolicy }),
      },
      5,
    )) as {
      error?: { code: string; message?: string };
      data?: unknown;
    };

    if (response.error) {
      throw new MctError(
        {
          code: response.error.code || "INTERNAL_ERROR",
          message:
            response.error.message || `Reconnect failed for ${clientName}`,
        },
        3,
      );
    }

    return { reconnected: true, name: clientName, address };
  }

  async list() {
    const state = await this.globalState.readClientState();
    const runningClients = state.clients;

    // List all installed instances
    const clientsDir = resolveClientsDir();
    const instances: Array<
      ClientInstanceMeta & { running: boolean; pid?: number }
    > = [];

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
      clients: instances,
    };
  }

  async waitReady(
    clientName: string,
    timeoutSeconds: number,
    options: WaitReadyOptions = {},
  ) {
    const state = await this.globalState.readClientState();
    const entry = state.clients[clientName];

    if (!entry) {
      throw new MctError(
        {
          code: "CLIENT_NOT_FOUND",
          message: `Client ${clientName} is not running`,
        },
        3,
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
        lastError: lastConnectError,
      });
      throw new MctError(
        {
          code: "TIMEOUT",
          message: `Timed out after ${timeoutSeconds}s waiting for client ${clientName} (${wsUrl}). ${this.formatDiagnostics(diag)}`,
          details: diag,
        },
        2,
      );
    }

    if (!requireWorld) {
      return { connected: true, url: wsUrl };
    }

    // 阶段 B：轮询 position.get 直到不再 NOT_IN_WORLD
    //
    // 客户端停在标题屏/断开屏时不会自己进服，干等到超时只是浪费整个窗口。
    // 按 mod 上报的 screen category（版本无关）判断是否"卡住了"，卡住就立刻
    // 重连，并允许多次退避重试，而不是只在窗口末尾试一次。
    let lastErrorCode = "NOT_IN_WORLD";
    let lastStatus: unknown;
    let lastResourcePack: ResourcePackStatus | undefined;
    let inWorld = false;
    let reconnectAttempts = 0;
    let nextReconnectAt = 0;
    while (Date.now() < deadline) {
      try {
        const ws = new WebSocketClient(wsUrl);
        const response = (await ws.send("position.get", {}, 1)) as {
          error?: string | { code?: string; message?: string };
          data?: unknown;
        };
        inWorld = !response.error;
        // Pack loading can continue after a player exists. Never call a
        // connection ready, or reconnect it, while vanilla is applying a pack.
        const resourcePackResponse = await this.readResourcePackStatus(wsUrl);
        if (resourcePackResponse) {
          lastResourcePack = resourcePackResponse;
        }
        const packState = lastResourcePack?.state;
        const requiredRejected =
          packState === "rejected" && lastResourcePack?.required === true;
        if (
          packState === "prompt" ||
          packState === "failed" ||
          requiredRejected
        ) {
          lastStatus = await this.readClientStatus(wsUrl);
          const code =
            packState === "prompt"
              ? "RESOURCE_PACK_PROMPT"
              : requiredRejected
                ? "RESOURCE_PACK_REQUIRED_REJECTED"
                : "RESOURCE_PACK_FAILED";
          const diag = this.buildDiagnostics(entry.pid, entry.wsPort, {
            wsConnected: true,
            inWorld,
            lastError: code,
            status: lastStatus,
            resourcePack: lastResourcePack,
            reconnectAttempts,
            reconnectAttempted: reconnectAttempts > 0,
            reconnectAddress: options.reconnectAddress,
          });
          throw new MctError(
            {
              code,
              message:
                packState === "prompt"
                  ? `Client ${clientName} is waiting for a server resource-pack decision. Run \`mct --client ${clientName} resourcepack accept\` or \`mct --client ${clientName} resourcepack reject\`, then run wait-ready again. To accept automatically, reconnect with --resource-pack accept.`
                  : requiredRejected
                    ? `Client ${clientName} rejected a required server resource pack. To join this server, reconnect with \`mct --client ${clientName} client reconnect --resource-pack accept\`.`
                    : `Client ${clientName} failed to download or apply the server resource pack${lastResourcePack?.error ? `: ${lastResourcePack.error}` : "."} Run \`mct --client ${clientName} resourcepack status\` and check the client log before retrying.`,
              details: diag,
            },
            3,
          );
        }
        const packPending = isResourcePackPending(lastResourcePack);
        if (inWorld && !packPending && resourcePackResponse) {
          return {
            connected: true,
            url: wsUrl,
            inWorld: true,
            position: response.data,
            resourcePack: lastResourcePack,
            // Older mods expose acceptance only, not actual pack application.
            resourcePackReadinessVerified:
              typeof packState === "string" &&
              lastResourcePack?.lifecycleSupported !== false,
            ...(reconnectAttempts > 0 ? { reconnectAttempts } : {}),
          };
        }
        lastErrorCode = !resourcePackResponse
          ? "RESOURCE_PACK_STATUS_UNAVAILABLE"
          : packPending
            ? "RESOURCE_PACK_PENDING"
            : this.errorCode(response.error, lastErrorCode);
        if (
          lastErrorCode === "NOT_IN_WORLD" ||
          packPending ||
          !resourcePackResponse
        ) {
          lastStatus = await this.readClientStatus(wsUrl);
          const screen = this.readScreenState(lastStatus);
          const stuck = this.isStuckScreen(screen);
          const now = Date.now();
          if (
            options.reconnectAddress &&
            resourcePackResponse &&
            !packPending &&
            packState !== "rejected" &&
            reconnectAttempts < WAIT_READY_MAX_RECONNECTS &&
            now >= nextReconnectAt &&
            // 卡在非游戏界面就立刻重连；否则（还在加载地形）留到窗口末尾兜底
            (stuck || now > deadline - Math.max(5_000, timeoutSeconds * 250))
          ) {
            reconnectAttempts += 1;
            // 退避，避免在客户端还没处理完上一次重连时反复捅它
            nextReconnectAt =
              now + WAIT_READY_RECONNECT_BACKOFF_MS * reconnectAttempts;
            await this.requestReconnect(wsUrl, options.reconnectAddress);
          }
        }
        if (
          ![
            "NOT_IN_WORLD",
            "RESOURCE_PACK_PENDING",
            "RESOURCE_PACK_STATUS_UNAVAILABLE",
          ].includes(lastErrorCode)
        ) {
          break;
        }
      } catch (err) {
        if (
          err instanceof MctError &&
          [
            "RESOURCE_PACK_PROMPT",
            "RESOURCE_PACK_FAILED",
            "RESOURCE_PACK_REQUIRED_REJECTED",
          ].includes(err.code)
        ) {
          throw err;
        }
        lastErrorCode =
          err instanceof Error ? `WS_ERROR(${err.message})` : "WS_ERROR";
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const diag = this.buildDiagnostics(entry.pid, entry.wsPort, {
      wsConnected: true,
      inWorld,
      lastError: lastErrorCode,
      status: lastStatus,
      resourcePack: lastResourcePack,
      reconnectAttempted: reconnectAttempts > 0,
      reconnectAttempts,
      reconnectAddress: options.reconnectAddress,
    });
    throw new MctError(
      {
        code: "TIMEOUT",
        message:
          isResourcePackPending(lastResourcePack) ||
          lastErrorCode === "RESOURCE_PACK_STATUS_UNAVAILABLE"
            ? `Timed out after ${timeoutSeconds}s waiting for client ${clientName}'s server resource-pack readiness (${wsUrl}). ${this.formatDiagnostics(diag)} Check \`mct --client ${clientName} resourcepack status\` and the client log, or increase --timeout while a large pack downloads or applies.`
            : `Timed out after ${timeoutSeconds}s waiting for client ${clientName} to join a world (${wsUrl}). ${this.formatDiagnostics(diag)} Tip: if the client is still at the main menu, run \`mct client reconnect --address <server>\` or relaunch with \`mct client launch --server <address>\` (inside a project, plain \`mct client launch\` uses the active profile server). If it keeps bouncing back to a disconnect screen, check the server's log and \`online-mode\`: test clients use offline accounts and an authenticating server rejects them with "Failed to login: Invalid session" (set online-mode=false in the server's config, then restart it).`,
        details: diag,
      },
      2,
    );
  }

  /**
   * Pull the version-independent screen classification out of a `status.all`
   * payload. The mod reports `category` (game/title/disconnected/multiplayer/
   * screen); the obfuscated `type` (class_442, ...) shifts between Minecraft
   * versions and must never be matched on.
   */
  private readScreenState(status: unknown): {
    category?: string;
    type?: string;
    title?: string;
    disconnectReason?: string;
  } {
    const typed = status as
      | {
          screenCategory?: string;
          disconnectReason?: string;
          screen?: {
            type?: string;
            title?: string;
            category?: string;
            disconnectReason?: string;
          };
        }
      | undefined;
    return {
      category: typed?.screenCategory ?? typed?.screen?.category,
      type: typed?.screen?.type,
      title: typed?.screen?.title,
      disconnectReason:
        typed?.disconnectReason ?? typed?.screen?.disconnectReason,
    };
  }

  /**
   * Whether the client is parked on a screen it will never leave on its own.
   *
   * The mod's `category` is authoritative when it says so, but its screen
   * classification matches on class names, which are obfuscated on production
   * clients (`class_419`), so a real disconnect can arrive as `screen`. Fall
   * back to the visible title, which stays meaningful across builds.
   */
  private isStuckScreen(screen: {
    category?: string;
    title?: string;
  }): boolean {
    if (
      screen.category === "disconnected" ||
      screen.category === "title" ||
      screen.category === "multiplayer"
    ) {
      return true;
    }
    if (screen.category === "game" || !screen.title) {
      return false;
    }
    const title = screen.title.toLowerCase();
    return STUCK_SCREEN_TITLES.some((needle) => title.includes(needle));
  }

  private buildDiagnostics(
    pid: number,
    wsPort: number,
    extras: {
      wsConnected: boolean;
      inWorld: boolean;
      lastError?: string;
      status?: unknown;
      resourcePack?: ResourcePackStatus;
      reconnectAttempted?: boolean;
      reconnectAttempts?: number;
      reconnectAddress?: string;
    },
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
      lastError: extras.lastError,
      status: extras.status,
      resourcePack: extras.resourcePack,
      reconnectAttempted: extras.reconnectAttempted ?? false,
      reconnectAttempts: extras.reconnectAttempts ?? 0,
      reconnectAddress: extras.reconnectAddress,
    };
  }

  private formatDiagnostics(diag: {
    processAlive: boolean;
    portListening: boolean;
    wsConnected: boolean;
    inWorld: boolean;
    lastError?: string;
    status?: unknown;
    resourcePack?: ResourcePackStatus;
    reconnectAttempted?: boolean;
    reconnectAttempts?: number;
    reconnectAddress?: string;
  }): string {
    const parts = [
      `processAlive=${diag.processAlive}`,
      `portListening=${diag.portListening}`,
      `wsConnected=${diag.wsConnected}`,
      `inWorld=${diag.inWorld}`,
    ];
    if (diag.lastError) {
      parts.push(`lastError=${diag.lastError}`);
    }
    if (diag.resourcePack?.state) {
      parts.push(`resourcePackState=${diag.resourcePack.state}`);
    }
    if (diag.resourcePack?.policy) {
      parts.push(`resourcePackPolicy=${diag.resourcePack.policy}`);
    }
    const {
      category: screenCategory,
      type: screenType,
      title: screenTitle,
      disconnectReason,
    } = this.readScreenState(diag.status);
    if (screenCategory) {
      parts.push(`screenCategory=${screenCategory}`);
    }
    if (screenType) {
      parts.push(`screenType=${screenType}`);
    }
    if (screenTitle) {
      parts.push(`screenTitle=${screenTitle}`);
    }
    if (disconnectReason) {
      parts.push(`disconnectReason=${disconnectReason}`);
    }
    if (diag.reconnectAttempted) {
      parts.push(`reconnectAttempts=${diag.reconnectAttempts ?? 1}`);
    }
    if (diag.reconnectAddress) {
      parts.push(`reconnectAddress=${diag.reconnectAddress}`);
    }
    return `Diagnostics: ${parts.join(", ")}.`;
  }

  private async readClientStatus(wsUrl: string) {
    try {
      const response = (await new WebSocketClient(wsUrl).send(
        "status.all",
        {},
        1,
      )) as {
        error?: string | { code?: string; message?: string };
        data?: unknown;
      };
      return response.error
        ? { error: this.errorCode(response.error, "UNKNOWN") }
        : response.data;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async readResourcePackStatus(
    wsUrl: string,
  ): Promise<ResourcePackStatus | undefined> {
    try {
      const response = (await new WebSocketClient(wsUrl).send(
        "resourcepack.status",
        {},
        1,
      )) as { error?: unknown; data?: ResourcePackStatus };
      return response.error ||
        !response.data ||
        typeof response.data !== "object"
        ? undefined
        : response.data;
    } catch {
      // A missing observation must not erase a previously observed pending pack.
      return undefined;
    }
  }

  private async requestReconnect(wsUrl: string, address: string) {
    try {
      await new WebSocketClient(wsUrl).send("client.reconnect", { address }, 2);
    } catch {
      // wait-ready diagnostics still record that the active reconnect was attempted.
    }
  }

  private errorCode(
    error: string | { code?: string } | undefined,
    fallback: string,
  ) {
    if (!error) {
      return fallback;
    }
    return typeof error === "string" ? error : (error.code ?? fallback);
  }

  async getClient(name?: string): Promise<ClientRuntimeEntry> {
    const state = await this.globalState.readClientState();
    const resolvedName = name ?? state.defaultClient;

    if (!resolvedName) {
      throw new MctError(
        {
          code: "CLIENT_NOT_FOUND",
          message: "No client is configured or running",
        },
        3,
      );
    }

    const entry = state.clients[resolvedName];
    if (!entry) {
      throw new MctError(
        {
          code: "CLIENT_NOT_FOUND",
          message: `Client ${resolvedName} was not found`,
        },
        3,
      );
    }

    if (
      !isProcessRunning(entry.pid) &&
      !(await this.isWsReachable(entry.wsPort, 1))
    ) {
      throw new MctError(
        {
          code: "CLIENT_NOT_RUNNING",
          message: `Client ${resolvedName} is not running`,
        },
        3,
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
        {
          code: "INSTANCE_NOT_FOUND",
          message: `Client instance ${clientName} not found`,
        },
        3,
      );
    }
  }

  async updateMeta(
    clientName: string,
    updates: Partial<ClientInstanceMeta>,
  ): Promise<ClientInstanceMeta> {
    const meta = await this.loadMeta(clientName);
    const updated = { ...meta, ...updates };
    const instanceDir = resolveClientInstanceDir(clientName);
    await writeFile(
      path.join(instanceDir, INSTANCE_FILE),
      `${JSON.stringify(updated, null, 2)}\n`,
      "utf8",
    );
    return updated;
  }

  private async isWsReachable(
    wsPort: number,
    timeoutSeconds: number,
  ): Promise<boolean> {
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
    const usedPorts = new Set(
      Object.values(state.clients).map((c) => c.wsPort),
    );

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

  /** Refuse unknown listeners; a port number alone never authorizes termination. */
  private requireOwnedPortListeners(
    wsPort: number,
    clientName: string,
    entry?: ClientRuntimeEntry,
    ownedPids = new Set<number>(),
  ): number[] {
    // A child can be reparented after its launcher exits. Remember ownership
    // proved during this stop operation, but discard PIDs observed to exit.
    for (const pid of ownedPids) {
      if (!isProcessRunning(pid)) ownedPids.delete(pid);
    }
    const listeningPids = getListeningPids(wsPort);
    const conflictingPids = listeningPids.filter(
      (pid) =>
        !entry || (!ownedPids.has(pid) && !isInProcessTree(pid, entry.pid)),
    );
    if (conflictingPids.length > 0) {
      throw new MctError(
        {
          code: "PORT_CONFLICT",
          message: `Client ${clientName}'s WebSocket port ${wsPort} is held by unrelated process(es) ${conflictingPids.join(", ")}. Stop that process yourself or choose a different --ws-port; --force only replaces the tracked client.`,
          details: {
            name: clientName,
            wsPort,
            ...(entry ? { pid: entry.pid } : {}),
            listeningPids,
            conflictingPids,
          },
        },
        5,
      );
    }
    for (const pid of listeningPids) ownedPids.add(pid);
    return listeningPids;
  }

  private async stopTrackedClient(
    state: GlobalClientState,
    clientName: string,
    entry: ClientRuntimeEntry,
  ) {
    const ownedPids = new Set<number>();
    // Check every listener before signalling anything, even the launcher.
    this.requireOwnedPortListeners(entry.wsPort, clientName, entry, ownedPids);
    if (isProcessRunning(entry.pid)) {
      killProcessTree(entry.pid);
    }

    for (const pid of this.requireOwnedPortListeners(
      entry.wsPort,
      clientName,
      entry,
      ownedPids,
    )) {
      if (pid !== entry.pid && isProcessRunning(pid)) {
        killProcessTree(pid);
      }
    }

    await this.waitForTrackedClientExit(entry, ownedPids);

    delete state.clients[clientName];
    if (state.defaultClient === clientName) {
      state.defaultClient = Object.keys(state.clients)[0];
    }
  }

  private async waitForTrackedClientExit(
    entry: ClientRuntimeEntry,
    ownedPids: Set<number>,
  ) {
    const deadline = Date.now() + CLIENT_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const listeners = this.requireOwnedPortListeners(
        entry.wsPort,
        entry.name,
        entry,
        ownedPids,
      );
      if (!isProcessRunning(entry.pid) && listeners.length === 0) {
        return;
      }
      await sleep(CLIENT_STOP_POLL_MS);
    }

    // A different process may bind while we wait. Recheck before escalation.
    const listeners = this.requireOwnedPortListeners(
      entry.wsPort,
      entry.name,
      entry,
      ownedPids,
    );
    for (const pid of listeners) {
      if (pid !== entry.pid && isProcessRunning(pid)) {
        killProcessTree(pid, "SIGKILL");
      }
    }
    if (isProcessRunning(entry.pid)) {
      killProcessTree(entry.pid, "SIGKILL");
    }
    await this.waitForWsPortRelease(entry, ownedPids);
  }

  private async waitForWsPortRelease(
    entry: ClientRuntimeEntry,
    ownedPids: Set<number>,
  ) {
    const deadline = Date.now() + CLIENT_PORT_RELEASE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (
        this.requireOwnedPortListeners(
          entry.wsPort,
          entry.name,
          entry,
          ownedPids,
        ).length === 0
      ) {
        return;
      }
      await sleep(CLIENT_STOP_POLL_MS);
    }

    const pids = this.requireOwnedPortListeners(
      entry.wsPort,
      entry.name,
      entry,
      ownedPids,
    );
    throw new MctError(
      {
        code: "CLIENT_PORT_BUSY",
        message: `Timed out waiting for client WebSocket port ${entry.wsPort} to become free`,
        details: { wsPort: entry.wsPort, pids },
      },
      3,
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
