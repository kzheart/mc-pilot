import * as pty from "node-pty";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type {
  ServerInstanceMeta,
  ServerRuntimeEntry,
  GlobalServerState
} from "../../../cli/src/util/instance-types";

const MCT_HOME = process.env.MCT_HOME || join(homedir(), ".mct");
const STATE_DIR = join(MCT_HOME, "state");
const PROJECTS_DIR = join(MCT_HOME, "projects");

interface PtySession {
  pty: pty.IPty;
  project: string;
  name: string;
  stateKey: string;
}

const sessions = new Map<string, PtySession>();

function stateKey(project: string, name: string): string {
  return `${project}/${name}`;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function findJarFile(instanceDir: string): Promise<string | null> {
  try {
    const entries = await readdir(instanceDir);
    const jar = entries.find((e) => e.endsWith(".jar"));
    return jar ?? null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
}

/**
 * Spawn a server in a PTY. If the server is already running (CLI-started),
 * kill it first and then restart with PTY for full interactive access.
 */
export async function ptySpawn(
  project: string,
  name: string,
  win: BrowserWindow
): Promise<{ success: boolean; error?: string }> {
  const key = stateKey(project, name);
  if (sessions.has(key)) {
    return { success: false, error: "Console session already exists" };
  }

  const instanceDir = join(PROJECTS_DIR, project, name);
  const meta = await readJsonFile<ServerInstanceMeta | null>(
    join(instanceDir, "instance.json"),
    null
  );
  if (!meta) {
    return { success: false, error: `Instance not found: ${key}` };
  }

  const jarFile = await findJarFile(instanceDir);
  if (!jarFile) {
    return { success: false, error: `No server jar found in ${instanceDir}` };
  }

  // Kill existing CLI-started process if running
  const currentState = await readJsonFile<GlobalServerState>(
    join(STATE_DIR, "servers.json"),
    { servers: {} }
  );
  const existing = currentState.servers[key];
  if (existing && isProcessRunning(existing.pid)) {
    killProcessTree(existing.pid);
    // Wait briefly for process to die
    await new Promise((r) => setTimeout(r, 500));
  }

  const jvmArgs = meta.jvmArgs ?? [];
  const args = [...jvmArgs, "-jar", jarFile, "nogui"];

  const ptyProcess = pty.spawn("java", args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: instanceDir,
    env: {
      ...process.env,
      MCT_SERVER_PORT: String(meta.port)
    } as Record<string, string>
  });

  const session: PtySession = { pty: ptyProcess, project, name, stateKey: key };
  sessions.set(key, session);

  // Update state file
  const logsDir = join(MCT_HOME, "logs");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });

  const logPath = join(logsDir, `server-${project}-${name}.log`);
  const entry: ServerRuntimeEntry = {
    pid: ptyProcess.pid,
    project,
    name,
    port: meta.port,
    startedAt: new Date().toISOString(),
    logPath,
    instanceDir
  };

  const state = await readJsonFile<GlobalServerState>(
    join(STATE_DIR, "servers.json"),
    { servers: {} }
  );
  state.servers[key] = entry;
  await writeFile(join(STATE_DIR, "servers.json"), JSON.stringify(state, null, 2) + "\n");

  // Stream PTY data to renderer
  ptyProcess.onData((data) => {
    if (!win.isDestroyed()) {
      win.webContents.send("pty-data", key, data);
    }
  });

  ptyProcess.onExit(async () => {
    sessions.delete(key);
    try {
      const s = await readJsonFile<GlobalServerState>(
        join(STATE_DIR, "servers.json"),
        { servers: {} }
      );
      delete s.servers[key];
      await writeFile(join(STATE_DIR, "servers.json"), JSON.stringify(s, null, 2) + "\n");
    } catch {
      // ignore
    }
    if (!win.isDestroyed()) {
      win.webContents.send("pty-exit", key);
    }
  });

  return { success: true };
}

export function ptyWrite(key: string, data: string): void {
  sessions.get(key)?.pty.write(data);
}

export function ptyResize(key: string, cols: number, rows: number): void {
  sessions.get(key)?.pty.resize(cols, rows);
}

export function ptyKill(key: string): void {
  const session = sessions.get(key);
  if (session) {
    session.pty.kill();
    sessions.delete(key);
  }
}

export function hasSession(key: string): boolean {
  return sessions.has(key);
}

export function killAllSessions(): void {
  for (const [, session] of sessions) {
    session.pty.kill();
  }
  sessions.clear();
}
