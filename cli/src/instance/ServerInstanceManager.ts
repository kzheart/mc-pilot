import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
  unlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import type { GlobalStateStore } from "../util/global-state.js";
import type {
  ServerInstanceMeta,
  ServerRuntimeEntry,
  ServerType,
} from "../util/instance-types.js";
import {
  resolveMctHome,
  resolveProjectDir,
  resolveServerInstanceDir,
} from "../util/paths.js";
import { MctError } from "../util/errors.js";
import { isTcpPortReachable } from "../util/net.js";
import { isProcessRunning, killProcessTree } from "../util/process.js";
import { copyFileIfMissing } from "../download/DownloadUtils.js";
import { ServerCommandPipe } from "./ServerCommandPipe.js";
import {
  ServerLogManager,
  stripAnsiCodes,
  type ServerLogReadOptions,
} from "./ServerLogManager.js";

const INSTANCE_FILE = "instance.json";
const SERVER_READY_POLL_MS = 500;

export { stripAnsiCodes };

export async function ensureServerPortProperty(
  instanceDir: string,
  port: number,
): Promise<void> {
  const filePath = path.join(instanceDir, "server.properties");
  let lines: string[] = [];

  try {
    const raw = await readFile(filePath, "utf8");
    lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
  } catch {
    // initialize from scratch
  }

  let updated = false;
  lines = lines.map((line) => {
    if (/^\s*server-port\s*=/.test(line)) {
      updated = true;
      return `server-port=${port}`;
    }
    return line;
  });

  if (!updated) {
    lines.push(`server-port=${port}`);
  }

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

export interface CreateServerOptions {
  name: string;
  project: string;
  type: ServerType;
  version: string;
  port?: number;
  jvmArgs?: string[];
  javaCommand?: string;
  javaVersion?: number;
  eula?: boolean;
  cachedJarPath?: string;
}

export interface StartServerOptions {
  eula?: boolean;
  jvmArgs?: string[];
}

export class ServerInstanceManager {
  private readonly commandPipe = new ServerCommandPipe();
  private readonly logs = new ServerLogManager();

  constructor(
    private readonly globalState: GlobalStateStore,
    private readonly project: string,
  ) {}

  async create(options: CreateServerOptions): Promise<ServerInstanceMeta> {
    const instanceDir = resolveServerInstanceDir(options.project, options.name);
    await mkdir(instanceDir, { recursive: true });

    const port = options.port ?? (await this.findAvailablePort());
    const jarPath = options.cachedJarPath;

    if (jarPath) {
      const targetJar = path.join(instanceDir, path.basename(jarPath));
      await copyFileIfMissing(jarPath, targetJar);
    }

    if (options.eula) {
      await writeFile(
        path.join(instanceDir, "eula.txt"),
        "eula=true\n",
        "utf8",
      );
    }

    await mkdir(path.join(instanceDir, "plugins"), { recursive: true });
    await ensureServerPortProperty(instanceDir, port);

    const meta: ServerInstanceMeta = {
      name: options.name,
      project: options.project,
      type: options.type,
      mcVersion: options.version,
      port,
      jvmArgs: options.jvmArgs ?? [],
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
  }

  async start(
    serverName: string,
    options: StartServerOptions = {},
  ): Promise<ServerRuntimeEntry & { running: true }> {
    const stateKey = `${this.project}/${serverName}`;
    const state = await this.globalState.readServerState();
    const existing = state.servers[stateKey];

    if (existing && isProcessRunning(existing.pid)) {
      throw new MctError(
        {
          code: "SERVER_ALREADY_RUNNING",
          message: `Server ${stateKey} is already running`,
          details: existing,
        },
        5,
      );
    }

    const meta = await this.loadMeta(serverName);
    const instanceDir = resolveServerInstanceDir(this.project, serverName);
    const jarFile = await this.findJarFile(instanceDir);

    if (!jarFile) {
      throw new MctError(
        {
          code: "INVALID_PARAMS",
          message: `No server jar found in ${instanceDir}`,
        },
        4,
      );
    }

    if (options.eula) {
      await writeFile(
        path.join(instanceDir, "eula.txt"),
        "eula=true\n",
        "utf8",
      );
    }
    await ensureServerPortProperty(instanceDir, meta.port);

    const mctHome = resolveMctHome();
    const logsDir = path.join(mctHome, "logs");
    const stateDir = path.join(mctHome, "state");
    await mkdir(logsDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    const logPath = path.join(
      logsDir,
      `server-${this.project}-${serverName}.log`,
    );
    const logStartOffset = await stat(logPath)
      .then((value) => value.size)
      .catch(() => 0);
    const stdout = await open(logPath, "a");

    const jvmArgs = options.jvmArgs ?? meta.jvmArgs;
    const javaCommand = meta.javaCommand ?? "java";

    const stdinPipe = await this.commandPipe.create(
      stateDir,
      this.project,
      serverName,
    );

    // Use bash wrapper: hold FIFO open in read-write mode (fd 3 <>) to prevent EOF
    // without blocking (write-only > would block until a reader opens the other end),
    // then exec java with stdin reading from the FIFO
    const child = spawn(
      "bash",
      [
        "-c",
        'exec 3<>"$MCT_STDIN_PIPE"; exec "$MCT_SERVER_JAVA" "$@" 0<&3',
        "mct-server",
        ...jvmArgs,
        "-jar",
        jarFile,
        "nogui",
      ],
      {
        cwd: instanceDir,
        detached: true,
        stdio: ["ignore", stdout.fd, stdout.fd],
        env: {
          ...process.env,
          MCT_SERVER_PORT: String(meta.port),
          MCT_STDIN_PIPE: stdinPipe,
          MCT_SERVER_JAVA: javaCommand,
        },
      },
    );

    child.once("exit", () => {
      void stdout.close();
    });
    child.once("error", () => {
      void stdout.close();
    });
    child.unref();

    const entry: ServerRuntimeEntry = {
      pid: child.pid ?? 0,
      project: this.project,
      name: serverName,
      port: meta.port,
      startedAt: new Date().toISOString(),
      logPath,
      instanceDir,
      logStartOffset,
      stdinPipe,
    };

    state.servers[stateKey] = entry;
    await this.globalState.writeServerState(state);

    return { running: true, ...entry };
  }

  async stop(serverName: string) {
    const stateKey = `${this.project}/${serverName}`;
    const state = await this.globalState.readServerState();
    const entry = state.servers[stateKey];

    if (!entry) {
      return { running: false, stopped: false, alreadyStopped: true };
    }

    if (isProcessRunning(entry.pid)) {
      killProcessTree(entry.pid);
    }

    // Clean up FIFO
    if (entry.stdinPipe) {
      try {
        await unlink(entry.stdinPipe);
      } catch {
        /* ignore */
      }
    }

    delete state.servers[stateKey];
    await this.globalState.writeServerState(state);

    return { running: false, stopped: true, pid: entry.pid };
  }

  async status(serverName?: string) {
    const state = await this.globalState.readServerState();

    if (serverName) {
      const stateKey = `${this.project}/${serverName}`;
      const entry = state.servers[stateKey];
      if (!entry) {
        return { running: false };
      }

      const running = isProcessRunning(entry.pid);
      if (!running) {
        delete state.servers[stateKey];
        await this.globalState.writeServerState(state);
        return { running: false, stale: true, ...entry };
      }

      return { running: true, ...entry };
    }

    const results: Array<{ running: boolean; [key: string]: unknown }> = [];
    for (const [key, entry] of Object.entries(state.servers)) {
      if (entry.project === this.project) {
        const running = isProcessRunning(entry.pid);
        if (!running) {
          delete state.servers[key];
        }
        results.push({ running, ...entry });
      }
    }
    await this.globalState.writeServerState(state);
    return results;
  }

  static async statusAll(globalState: GlobalStateStore) {
    const state = await globalState.readServerState();
    const results: Array<{ running: boolean; [key: string]: unknown }> = [];

    for (const [key, entry] of Object.entries(state.servers)) {
      const running = isProcessRunning(entry.pid);
      if (!running) {
        delete state.servers[key];
      }
      results.push({ running, ...entry });
    }

    await globalState.writeServerState(state);
    return results;
  }

  async waitReady(serverName: string, timeoutSeconds: number) {
    const stateKey = `${this.project}/${serverName}`;
    const state = await this.globalState.readServerState();
    const entry = state.servers[stateKey];

    if (!entry) {
      throw new MctError(
        {
          code: "SERVER_NOT_RUNNING",
          message: `Server ${stateKey} is not running`,
        },
        5,
      );
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let snapshot = await this.logs.describeStartup(entry.logPath);

    while (Date.now() < deadline) {
      if (!isProcessRunning(entry.pid)) {
        throw new MctError(
          {
            code: "SERVER_EXITED",
            message: `Server ${stateKey} exited before becoming ready (${snapshot.phase})`,
            details: {
              pid: entry.pid,
              host: "127.0.0.1",
              port: entry.port,
              phase: snapshot.phase,
              logPath: snapshot.logPath,
              lastLine: snapshot.lastLine,
              recentLines: snapshot.recentLines,
            },
          },
          5,
        );
      }

      if (await isTcpPortReachable("127.0.0.1", entry.port)) {
        snapshot = await this.logs.describeStartup(entry.logPath);
        return {
          reachable: true,
          host: "127.0.0.1",
          port: entry.port,
          phase: snapshot.phase,
          signals: {
            processAlive: true,
            portReachable: true,
            readyLineSeen: snapshot.phase === "ready",
          },
          logPath: snapshot.logPath,
          lastLine: snapshot.lastLine,
          recentLines: snapshot.recentLines,
        };
      }

      snapshot = await this.logs.describeStartup(entry.logPath);
      await new Promise((resolve) => setTimeout(resolve, SERVER_READY_POLL_MS));
    }

    throw new MctError(
      {
        code: "TIMEOUT",
        message: `Timed out waiting for 127.0.0.1:${entry.port} (${snapshot.phase})`,
        details: {
          host: "127.0.0.1",
          port: entry.port,
          phase: snapshot.phase,
          signals: {
            processAlive: isProcessRunning(entry.pid),
            portReachable: false,
            readyLineSeen: snapshot.phase === "ready",
          },
          logPath: snapshot.logPath,
          lastLine: snapshot.lastLine,
          recentLines: snapshot.recentLines,
        },
      },
      2,
    );
  }

  async exec(
    serverName: string,
    command: string,
  ): Promise<{ sent: boolean; command: string; stdinPipe: string }> {
    const entry = await this.requireRunning(serverName);
    if (!entry.stdinPipe) {
      throw new MctError(
        {
          code: "SERVER_STDIN_UNAVAILABLE",
          message: `Server ${this.project}/${serverName} has no stdin FIFO (detached mode?)`,
        },
        5,
      );
    }

    const trimmed = command.trim();
    if (!trimmed) {
      throw new MctError(
        { code: "INVALID_PARAMS", message: "Command is required" },
        4,
      );
    }

    await this.commandPipe.send(entry.stdinPipe, trimmed.replace(/^\//, ""));

    return { sent: true, command: trimmed, stdinPipe: entry.stdinPipe };
  }

  async readLogs(
    serverName: string,
    options: ServerLogReadOptions = {},
  ): Promise<{
    logPath: string;
    totalLines: number;
    returnedLines: number;
    lines: string[];
  }> {
    const entry = await this.requireRuntimeEntry(serverName);
    return this.logs.read(entry.logPath, options, entry.logStartOffset);
  }

  async markLogs(
    serverName: string,
    label?: string,
  ): Promise<{ logPath: string; marker: string }> {
    const entry = await this.requireRuntimeEntry(serverName);
    return this.logs.mark(entry.logPath, label);
  }

  async followLogs(
    serverName: string,
    options: {
      grep?: string;
      timeoutSeconds: number;
      firstMatchOnly?: boolean;
      rawColors?: boolean;
    },
  ): Promise<{
    logPath: string;
    matched: boolean;
    matches: string[];
    timedOut: boolean;
  }> {
    const entry = await this.requireRuntimeEntry(serverName);
    return this.logs.follow(entry.logPath, options);
  }

  private async requireRuntimeEntry(
    serverName: string,
  ): Promise<ServerRuntimeEntry> {
    const stateKey = `${this.project}/${serverName}`;
    const state = await this.globalState.readServerState();
    const entry = state.servers[stateKey];
    if (!entry) {
      throw new MctError(
        {
          code: "SERVER_NOT_RUNNING",
          message: `Server ${stateKey} is not running`,
        },
        5,
      );
    }
    return entry;
  }

  async readiness(serverName: string) {
    const entry = await this.requireRuntimeEntry(serverName);
    const processAlive = isProcessRunning(entry.pid);
    const portReachable = await isTcpPortReachable("127.0.0.1", entry.port);
    const snapshot = await this.logs.describeStartup(entry.logPath);
    return {
      process: { alive: processAlive, pid: entry.pid },
      port: { reachable: portReachable, host: "127.0.0.1", port: entry.port },
      log: {
        phase: snapshot.phase,
        readyLineSeen: snapshot.phase === "ready",
        lastLine: snapshot.lastLine,
        recentLines: snapshot.recentLines,
        path: snapshot.logPath,
      },
    };
  }

  private async requireRunning(
    serverName: string,
  ): Promise<ServerRuntimeEntry> {
    const entry = await this.requireRuntimeEntry(serverName);
    if (!isProcessRunning(entry.pid)) {
      throw new MctError(
        {
          code: "SERVER_NOT_RUNNING",
          message: `Server ${this.project}/${serverName} PID ${entry.pid} is not alive`,
        },
        5,
      );
    }
    return entry;
  }

  async list(): Promise<ServerInstanceMeta[]> {
    const projectDir = resolveProjectDir(this.project);
    try {
      const entries = await readdir(projectDir, { withFileTypes: true });
      const results: ServerInstanceMeta[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const meta = await this.loadMeta(entry.name);
            results.push(meta);
          } catch {
            // not a valid instance
          }
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  static async listAll(
    globalState: GlobalStateStore,
  ): Promise<ServerInstanceMeta[]> {
    const { resolveProjectsDir } = await import("../util/paths.js");
    const projectsDir = resolveProjectsDir();
    const results: ServerInstanceMeta[] = [];

    try {
      const projects = await readdir(projectsDir, { withFileTypes: true });
      for (const project of projects) {
        if (project.isDirectory()) {
          const manager = new ServerInstanceManager(globalState, project.name);
          const instances = await manager.list();
          results.push(...instances);
        }
      }
    } catch {
      // projects dir doesn't exist yet
    }

    return results;
  }

  async deploy(
    serverName: string,
    jarPaths: string[],
    cwd: string,
  ): Promise<string[]> {
    const instanceDir = resolveServerInstanceDir(this.project, serverName);
    const pluginsDir = path.join(instanceDir, "plugins");
    await mkdir(pluginsDir, { recursive: true });

    const deployed: string[] = [];
    for (const jarPath of jarPaths) {
      const resolved = path.resolve(cwd, jarPath);
      const target = path.join(pluginsDir, path.basename(resolved));
      await copyFile(resolved, target);
      deployed.push(target);
    }

    return deployed;
  }

  async loadMeta(serverName: string): Promise<ServerInstanceMeta> {
    const instanceDir = resolveServerInstanceDir(this.project, serverName);
    const metaPath = path.join(instanceDir, INSTANCE_FILE);

    try {
      const raw = await readFile(metaPath, "utf8");
      return JSON.parse(raw) as ServerInstanceMeta;
    } catch {
      throw new MctError(
        {
          code: "INSTANCE_NOT_FOUND",
          message: `Server instance ${this.project}/${serverName} not found`,
        },
        3,
      );
    }
  }

  private async findJarFile(instanceDir: string): Promise<string | null> {
    try {
      const entries = await readdir(instanceDir);
      const jar = entries.find((e) => e.endsWith(".jar"));
      return jar ? path.join(instanceDir, jar) : null;
    } catch {
      return null;
    }
  }

  private async findAvailablePort(): Promise<number> {
    const state = await this.globalState.readServerState();
    const usedPorts = new Set(Object.values(state.servers).map((s) => s.port));

    let port = 25565;
    while (usedPorts.has(port)) {
      port += 1;
    }

    return port;
  }
}
