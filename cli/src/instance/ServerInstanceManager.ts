import { access, copyFile, mkdir, readdir, readFile, symlink, writeFile, unlink } from "node:fs/promises";
import { mkdirSync, openSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import path from "node:path";

import type { GlobalStateStore } from "../util/global-state.js";
import type { ServerInstanceMeta, ServerRuntimeEntry, ServerType } from "../util/instance-types.js";
import { resolveMctHome, resolveProjectDir, resolveServerInstanceDir } from "../util/paths.js";
import { MctError } from "../util/errors.js";
import { waitForTcpPort } from "../util/net.js";
import { isProcessRunning, killProcessTree } from "../util/process.js";
import { CacheManager } from "../download/CacheManager.js";
import { copyFileIfMissing } from "../download/DownloadUtils.js";

const INSTANCE_FILE = "instance.json";

export interface CreateServerOptions {
  name: string;
  project: string;
  type: ServerType;
  version: string;
  port?: number;
  jvmArgs?: string[];
  eula?: boolean;
  cachedJarPath?: string;
}

export interface StartServerOptions {
  eula?: boolean;
  jvmArgs?: string[];
}

export class ServerInstanceManager {
  constructor(
    private readonly globalState: GlobalStateStore,
    private readonly project: string
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
      await writeFile(path.join(instanceDir, "eula.txt"), "eula=true\n", "utf8");
    }

    await mkdir(path.join(instanceDir, "plugins"), { recursive: true });

    const meta: ServerInstanceMeta = {
      name: options.name,
      project: options.project,
      type: options.type,
      mcVersion: options.version,
      port,
      jvmArgs: options.jvmArgs ?? [],
      createdAt: new Date().toISOString()
    };

    await writeFile(path.join(instanceDir, INSTANCE_FILE), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return meta;
  }

  async start(serverName: string, options: StartServerOptions = {}): Promise<ServerRuntimeEntry & { running: true }> {
    const stateKey = `${this.project}/${serverName}`;
    const state = await this.globalState.readServerState();
    const existing = state.servers[stateKey];

    if (existing && isProcessRunning(existing.pid)) {
      throw new MctError(
        { code: "SERVER_ALREADY_RUNNING", message: `Server ${stateKey} is already running`, details: existing },
        5
      );
    }

    const meta = await this.loadMeta(serverName);
    const instanceDir = resolveServerInstanceDir(this.project, serverName);
    const jarFile = await this.findJarFile(instanceDir);

    if (!jarFile) {
      throw new MctError(
        { code: "INVALID_PARAMS", message: `No server jar found in ${instanceDir}` },
        4
      );
    }

    if (options.eula) {
      await writeFile(path.join(instanceDir, "eula.txt"), "eula=true\n", "utf8");
    }

    const mctHome = resolveMctHome();
    const logsDir = path.join(mctHome, "logs");
    const stateDir = path.join(mctHome, "state");
    mkdirSync(logsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const logPath = path.join(logsDir, `server-${this.project}-${serverName}.log`);
    const stdout = openSync(logPath, "a");

    const jvmArgs = options.jvmArgs ?? meta.jvmArgs;

    // Create a named pipe (FIFO) for stdin so external tools (GUI) can send commands
    const stdinPipe = path.join(stateDir, `stdin-${this.project}-${serverName}.fifo`);
    try { await unlink(stdinPipe); } catch { /* ignore */ }
    execSync(`mkfifo "${stdinPipe}"`);

    // Use bash wrapper: hold FIFO open in read-write mode (fd 3 <>) to prevent EOF
    // without blocking (write-only > would block until a reader opens the other end),
    // then exec java with stdin reading from the FIFO
    const child = spawn("bash", [
      "-c",
      'exec 3<>"$MCT_STDIN_PIPE"; exec java "$@" <"$MCT_STDIN_PIPE"',
      "mct-server",
      ...jvmArgs, "-jar", jarFile, "nogui"
    ], {
      cwd: instanceDir,
      detached: true,
      stdio: ["ignore", stdout, stdout],
      env: {
        ...process.env,
        MCT_SERVER_PORT: String(meta.port),
        MCT_STDIN_PIPE: stdinPipe
      }
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
      stdinPipe
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
      return { running: false, stopped: false };
    }

    if (isProcessRunning(entry.pid)) {
      killProcessTree(entry.pid);
    }

    // Clean up FIFO
    if (entry.stdinPipe) {
      try { await unlink(entry.stdinPipe); } catch { /* ignore */ }
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

  async waitReady(serverName: string, timeoutSeconds: number) {
    const stateKey = `${this.project}/${serverName}`;
    const state = await this.globalState.readServerState();
    const entry = state.servers[stateKey];

    if (!entry) {
      throw new MctError(
        { code: "SERVER_NOT_RUNNING", message: `Server ${stateKey} is not running` },
        5
      );
    }

    return waitForTcpPort("127.0.0.1", entry.port, timeoutSeconds);
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

  static async listAll(globalState: GlobalStateStore): Promise<ServerInstanceMeta[]> {
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

  async deploy(serverName: string, jarPaths: string[], cwd: string): Promise<string[]> {
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
        { code: "INSTANCE_NOT_FOUND", message: `Server instance ${this.project}/${serverName} not found` },
        3
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
