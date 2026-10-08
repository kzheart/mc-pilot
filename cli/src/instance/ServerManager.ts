import { spawn } from "node:child_process";
import {
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { MctError } from "../util/errors.js";
import { isTcpPortReachable } from "../util/net.js";
import { resolveProjectRunDir } from "../util/paths.js";
import {
  getListeningPids,
  isInProcessTree,
  isProcessRunning,
  killProcessTree,
} from "../util/process.js";
import type { MctServerConfig } from "../util/project.js";
import { ServerCommandPipe } from "./ServerCommandPipe.js";
import {
  detectServerFlavor,
  ensureServerProperties,
  getServerFlavor,
  pathExists,
  type ServerFlavor,
  type ServerKind,
} from "./server-flavor.js";
import {
  collectOutput,
  detectServerStartupPhase,
  fileSize,
  isReadyLine,
  readLinesFrom,
  tailLines,
  waitForLine,
} from "./server-log.js";

const RUNTIME_FILE = ".mct-runtime.json";
const CONSOLE_LOG_FILE = ".mct-console.log";
const READY_POLL_MS = 500;
// A server stopped right before start() may still be releasing its port.
const START_PORT_GRACE_MS = 3000;
const DIAGNOSTIC_LINES = 30;
const KNOWN_SERVER_JAR =
  /paper|purpur|spigot|folia|leaf|pufferfish|craftbukkit|velocity|bungee|waterfall|flamecord|travertine|minecraft_server|server/i;

export interface ServerTarget {
  name: string;
  dir: string;
  config: MctServerConfig;
}

interface ServerRuntime {
  pid: number;
  port: number;
  kind: ServerKind;
  jar: string;
  startedAt: string;
  stdinPipe: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function readRuntime(dir: string): Promise<ServerRuntime | null> {
  try {
    return JSON.parse(
      await readFile(path.join(dir, RUNTIME_FILE), "utf8"),
    ) as ServerRuntime;
  } catch {
    return null;
  }
}

async function clearRuntime(dir: string, runtime: ServerRuntime | null) {
  await unlink(path.join(dir, RUNTIME_FILE)).catch(() => {});
  if (runtime?.stdinPipe) {
    await new ServerCommandPipe().cleanup(runtime.stdinPipe).catch(() => {});
  }
}

/** Server directories under `<project>/run`: any subdirectory holding a jar. */
export async function listProjectServers(projectRoot: string) {
  const runDir = resolveProjectRunDir(projectRoot);
  let entries: string[];
  try {
    entries = (await readdir(runDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  const servers: string[] = [];
  for (const name of entries) {
    const files = await readdir(path.join(runDir, name)).catch(() => []);
    if (files.some((file) => file.endsWith(".jar"))) {
      servers.push(name);
    }
  }
  return servers;
}

/**
 * Map a server name or directory to its location.
 *
 * Names resolve to `<project>/run/<name>`; anything else is treated as a
 * directory path relative to the cwd, so servers outside a project work too.
 */
export async function resolveServerTarget(
  context: {
    cwd: string;
    projectRootDir: string | null;
    projectFile: { servers?: Record<string, MctServerConfig> } | null;
  },
  nameOrDir: string,
): Promise<ServerTarget> {
  const candidates: string[] = [];
  if (context.projectRootDir) {
    candidates.push(
      path.join(resolveProjectRunDir(context.projectRootDir), nameOrDir),
    );
  }
  candidates.push(path.resolve(context.cwd, nameOrDir));

  for (const dir of candidates) {
    if (await isDirectory(dir)) {
      const name = path.basename(dir);
      return {
        name,
        dir,
        config: context.projectFile?.servers?.[name] ?? {},
      };
    }
  }

  const available = context.projectRootDir
    ? await listProjectServers(context.projectRootDir)
    : [];
  throw new MctError(
    {
      code: "SERVER_NOT_FOUND",
      message: context.projectRootDir
        ? `No server directory '${nameOrDir}' (looked in ${candidates.join(" and ")}). Put the server under run/${nameOrDir}/ with its jar inside.`
        : `Server directory '${nameOrDir}' does not exist`,
      details: { looked: candidates, available },
    },
    3,
  );
}

async function findJar(target: ServerTarget): Promise<string> {
  if (target.config.jar) {
    const jarPath = path.resolve(target.dir, target.config.jar);
    if (!(await pathExists(jarPath))) {
      throw new MctError(
        {
          code: "SERVER_JAR_NOT_FOUND",
          message: `Configured jar ${jarPath} does not exist`,
        },
        4,
      );
    }
    return jarPath;
  }

  const jars = (await readdir(target.dir).catch(() => [] as string[]))
    .filter((file) => file.endsWith(".jar"))
    .sort();
  const candidates =
    jars.length > 1 ? jars.filter((jar) => KNOWN_SERVER_JAR.test(jar)) : jars;
  if (candidates.length === 1) {
    return path.join(target.dir, candidates[0]);
  }

  throw new MctError(
    {
      code: jars.length === 0 ? "SERVER_JAR_NOT_FOUND" : "SERVER_JAR_AMBIGUOUS",
      message:
        jars.length === 0
          ? `No server jar in ${target.dir}. Download one (e.g. Paper from https://fill.papermc.io) into this directory.`
          : `Multiple jars in ${target.dir}; set "servers": { "${target.name}": { "jar": "<file>" } } in mct.json`,
      details: { dir: target.dir, jars },
    },
    4,
  );
}

/** Pick a free port for a fresh server, skipping ports its siblings use. */
async function findFreePort(dir: string): Promise<number> {
  const used = new Set<number>();
  const parent = path.dirname(dir);
  const siblings = await readdir(parent, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of siblings) {
    const siblingDir = path.join(parent, entry.name);
    if (!entry.isDirectory() || siblingDir === dir) continue;
    const props = await readFile(
      path.join(siblingDir, "server.properties"),
      "utf8",
    ).catch(() => "");
    const port = Number(props.match(/^server-port=(\d+)/m)?.[1]);
    if (port) used.add(port);
  }

  let port = 25565;
  while (used.has(port) || (await isTcpPortReachable("127.0.0.1", port))) {
    port += 1;
  }
  return port;
}

async function waitPortReleased(port: number, graceMs: number) {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!(await isTcpPortReachable("127.0.0.1", port))) return;
    await sleep(200);
  }
}

async function waitProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await sleep(200);
  }
  return !isProcessRunning(pid);
}

function notRunningError(target: ServerTarget) {
  return new MctError(
    {
      code: "SERVER_NOT_RUNNING",
      message: `Server ${target.name} is not running. Start it with \`mct server start ${target.name}\`.`,
      details: { name: target.name, dir: target.dir },
    },
    5,
  );
}

export class ServerManager {
  private readonly commandPipe = new ServerCommandPipe();

  async start(
    target: ServerTarget,
    options: { eula?: boolean; wait?: boolean; timeoutSeconds: number },
  ) {
    const existing = await readRuntime(target.dir);
    if (existing && isProcessRunning(existing.pid)) {
      throw new MctError(
        {
          code: "SERVER_ALREADY_RUNNING",
          message: `Server ${target.name} is already running (PID ${existing.pid})`,
          details: { name: target.name, dir: target.dir, ...existing },
        },
        5,
      );
    }
    await clearRuntime(target.dir, existing);

    const jar = await findJar(target);
    const flavor = await detectServerFlavor(target.dir, jar);
    await this.prepareConfig(target, flavor, options.eula);

    const port = await flavor.readPort(target.dir);
    await waitPortReleased(port, START_PORT_GRACE_MS);
    if (await isTcpPortReachable("127.0.0.1", port)) {
      const listeningPids = getListeningPids(port);
      throw new MctError(
        {
          code: "PORT_IN_USE",
          message:
            `Port ${port} is already in use` +
            (listeningPids.length > 0
              ? ` by PID ${listeningPids.join(", ")}`
              : "") +
            `. Stop that process or change the port in ${target.name}'s config.`,
          details: { port, listeningPids },
        },
        5,
      );
    }

    const stdinPipe = await this.commandPipe.create(target.dir);
    const consoleLogPath = path.join(target.dir, CONSOLE_LOG_FILE);
    const stdout = await open(consoleLogPath, "w");

    const spawnSpec = this.commandPipe.buildServerSpawn({
      stdinChannel: stdinPipe,
      javaCommand: target.config.java ?? "java",
      launchArgs: flavor.buildLaunchArgs(target.config.jvmArgs ?? [], jar),
    });
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: target.dir,
      detached: true,
      stdio: ["ignore", stdout.fd, stdout.fd],
      env: { ...process.env, ...spawnSpec.env },
    });
    child.once("exit", () => void stdout.close());
    child.once("error", () => void stdout.close());
    child.unref();

    const runtime: ServerRuntime = {
      pid: child.pid ?? 0,
      port,
      kind: flavor.kind,
      jar: path.basename(jar),
      startedAt: new Date().toISOString(),
      stdinPipe,
    };
    await writeFile(
      path.join(target.dir, RUNTIME_FILE),
      `${JSON.stringify(runtime, null, 2)}\n`,
      "utf8",
    );

    const result = {
      name: target.name,
      dir: target.dir,
      running: true,
      pid: runtime.pid,
      port,
      kind: flavor.kind,
      jar: runtime.jar,
      logPath: path.join(target.dir, flavor.logFile),
      consoleLogPath,
    };
    if (options.wait === false) {
      return result;
    }
    return {
      ...result,
      ...(await this.waitReady(target, options.timeoutSeconds)),
    };
  }

  /** Validate and bootstrap config so a misconfigured server fails before launch. */
  private async prepareConfig(
    target: ServerTarget,
    flavor: ServerFlavor,
    eula?: boolean,
  ) {
    if (flavor.supportsEula) {
      const eulaPath = path.join(target.dir, "eula.txt");
      if (eula) {
        await writeFile(eulaPath, "eula=true\n", "utf8");
      }
      const accepted = /^\s*eula\s*=\s*true\s*$/m.test(
        await readFile(eulaPath, "utf8").catch(() => ""),
      );
      if (!accepted) {
        throw new MctError(
          {
            code: "EULA_NOT_ACCEPTED",
            message: `Minecraft EULA not accepted for ${target.name}. Re-run with --eula to write eula=true.`,
            details: { eulaPath },
          },
          4,
        );
      }
    }

    // A fresh vanilla-like server would default to online-mode=true and port
    // 25565; seed offline mode and a free port before its first boot.
    if (
      flavor.kind === "game" &&
      !(await pathExists(path.join(target.dir, "server.properties")))
    ) {
      await ensureServerProperties(target.dir, {
        "online-mode": "false",
        "server-port": String(await findFreePort(target.dir)),
      });
    }

    if ((await flavor.readOnlineMode(target.dir)) === true) {
      throw new MctError(
        {
          code: "ONLINE_MODE_ENABLED",
          message: `${target.name} runs with online-mode=true, but mct test clients use offline accounts and would be rejected with "Invalid session". Set online-mode to false in ${path.join(target.dir, flavor.onlineModeFile)}.`,
          details: {
            name: target.name,
            file: path.join(target.dir, flavor.onlineModeFile),
          },
        },
        4,
      );
    }
  }

  async waitReady(target: ServerTarget, timeoutSeconds: number) {
    // Not requireRuntime(): a process that already died must still report
    // SERVER_EXITED with its console output rather than a bare "not running".
    const runtime = await readRuntime(target.dir);
    if (!runtime) {
      throw notRunningError(target);
    }
    const consoleLogPath = path.join(target.dir, CONSOLE_LOG_FILE);
    const deadline = Date.now() + timeoutSeconds * 1000;
    // Paper opens its port while spawn chunks are still loading, so a
    // reachable port alone is not "ready"; also wait for the Done line.
    let consoleCursor = 0;
    let readyLineSeen = false;

    const diagnostics = async () => {
      const recentLines = await tailLines(consoleLogPath, DIAGNOSTIC_LINES);
      return {
        phase: detectServerStartupPhase(recentLines),
        consoleLogPath,
        recentLines,
      };
    };

    while (Date.now() < deadline) {
      const read = await readLinesFrom(consoleLogPath, consoleCursor);
      consoleCursor = read.cursor;
      readyLineSeen ||= read.lines.some((line) => isReadyLine(line.text));

      if (!isProcessRunning(runtime.pid)) {
        const info = await diagnostics();
        await clearRuntime(target.dir, runtime);
        throw new MctError(
          {
            code: "SERVER_EXITED",
            message: `Server ${target.name} exited before becoming ready (${info.phase})`,
            details: {
              name: target.name,
              pid: runtime.pid,
              port: runtime.port,
              ...info,
            },
          },
          5,
        );
      }

      if (await isTcpPortReachable("127.0.0.1", runtime.port)) {
        // A reachable port alone could be an unrelated squatter while our
        // server crashes on bind; require the listener to be in our tree.
        const listeningPids = getListeningPids(runtime.port);
        const ownedByUs =
          listeningPids.length === 0 ||
          listeningPids.some((pid) => isInProcessTree(pid, runtime.pid));
        if (!ownedByUs) {
          throw new MctError(
            {
              code: "PORT_CONFLICT",
              message: `Port ${runtime.port} is held by unrelated process(es) ${listeningPids.join(", ")}, not server ${target.name} (PID ${runtime.pid})`,
              details: {
                port: runtime.port,
                listeningPids,
                ...(await diagnostics()),
              },
            },
            5,
          );
        }
        if (readyLineSeen) {
          return { ready: true, phase: "ready" };
        }
      }

      await sleep(READY_POLL_MS);
    }

    throw new MctError(
      {
        code: "TIMEOUT",
        message: `Server ${target.name} not ready after ${timeoutSeconds}s (port ${runtime.port} reachable: ${await isTcpPortReachable("127.0.0.1", runtime.port)}, Done line seen: ${readyLineSeen})`,
        details: {
          name: target.name,
          port: runtime.port,
          processAlive: isProcessRunning(runtime.pid),
          readyLineSeen,
          ...(await diagnostics()),
        },
      },
      2,
    );
  }

  async stop(target: ServerTarget, timeoutSeconds = 30) {
    const runtime = await readRuntime(target.dir);
    if (!runtime || !isProcessRunning(runtime.pid)) {
      await clearRuntime(target.dir, runtime);
      return { name: target.name, stopped: false, alreadyStopped: true };
    }

    // Ask the server to shut down so worlds are saved; escalate if it hangs.
    let graceful = false;
    try {
      const flavor = getServerFlavor(runtime.kind);
      await this.commandPipe.send(runtime.stdinPipe, flavor.stopCommand, 2000);
      graceful = await waitProcessExit(runtime.pid, timeoutSeconds * 1000);
    } catch {
      graceful = false;
    }
    if (!graceful) {
      killProcessTree(runtime.pid, "SIGTERM");
      if (!(await waitProcessExit(runtime.pid, 5000))) {
        killProcessTree(runtime.pid, "SIGKILL");
        await waitProcessExit(runtime.pid, 2000);
      }
    }

    await clearRuntime(target.dir, runtime);
    return { name: target.name, stopped: true, graceful, pid: runtime.pid };
  }

  async status(target: ServerTarget) {
    const runtime = await readRuntime(target.dir);
    const jar = await findJar(target).catch(() => null);
    const flavor = jar ? await detectServerFlavor(target.dir, jar) : null;
    const logPath = flavor ? path.join(target.dir, flavor.logFile) : null;
    const base = {
      name: target.name,
      dir: target.dir,
      kind: flavor?.kind ?? null,
      port: flavor ? await flavor.readPort(target.dir) : null,
      logPath,
      logCursor: logPath ? await fileSize(logPath) : null,
    };

    if (!runtime) {
      return { ...base, running: false };
    }
    if (!isProcessRunning(runtime.pid)) {
      // The process died on its own: surface why before forgetting it.
      const recentLines = await tailLines(
        path.join(target.dir, CONSOLE_LOG_FILE),
        DIAGNOSTIC_LINES,
      );
      await clearRuntime(target.dir, runtime);
      return {
        ...base,
        running: false,
        crashed: true,
        pid: runtime.pid,
        recentLines,
      };
    }
    return {
      ...base,
      running: true,
      pid: runtime.pid,
      port: runtime.port,
      startedAt: runtime.startedAt,
      reachable: await isTcpPortReachable("127.0.0.1", runtime.port),
    };
  }

  async exec(target: ServerTarget, command: string, waitMs: number) {
    const trimmed = command.trim().replace(/^\//, "");
    if (!trimmed) {
      throw new MctError(
        { code: "INVALID_PARAMS", message: "Command is required" },
        4,
      );
    }

    const runtime = await this.requireRuntime(target);
    const logPath = path.join(
      target.dir,
      getServerFlavor(runtime.kind).logFile,
    );
    const cursor = await fileSize(logPath);
    await this.commandPipe.send(runtime.stdinPipe, trimmed);
    const output = await collectOutput(logPath, cursor, {
      maxMs: waitMs,
      quietMs: 300,
    });

    return { name: target.name, command: trimmed, output, cursor, logPath };
  }

  async waitLog(
    target: ServerTarget,
    options: { pattern: RegExp; after?: number; timeoutSeconds: number },
  ) {
    const jar = await findJar(target);
    const flavor = await detectServerFlavor(target.dir, jar);
    const logPath = path.join(target.dir, flavor.logFile);
    const from = options.after ?? (await fileSize(logPath));
    const match = await waitForLine(
      logPath,
      options.pattern,
      from,
      options.timeoutSeconds * 1000,
    );

    if (!match) {
      throw new MctError(
        {
          code: "TIMEOUT",
          message: `No log line matching /${options.pattern.source}/ in ${target.name} within ${options.timeoutSeconds}s`,
          details: {
            name: target.name,
            logPath,
            after: from,
            cursor: await fileSize(logPath),
            recentLines: await tailLines(logPath, 10),
          },
        },
        2,
      );
    }
    return {
      name: target.name,
      matched: true,
      line: match.line,
      cursor: match.cursor,
      logPath,
    };
  }

  async readPort(target: ServerTarget): Promise<number> {
    const runtime = await readRuntime(target.dir);
    if (runtime && isProcessRunning(runtime.pid)) {
      return runtime.port;
    }
    const flavor = await detectServerFlavor(target.dir, await findJar(target));
    return flavor.readPort(target.dir);
  }

  async readOnlineMode(target: ServerTarget) {
    const flavor = await detectServerFlavor(target.dir, await findJar(target));
    return flavor.readOnlineMode(target.dir);
  }

  private async requireRuntime(target: ServerTarget): Promise<ServerRuntime> {
    const runtime = await readRuntime(target.dir);
    if (!runtime || !isProcessRunning(runtime.pid)) {
      throw notRunningError(target);
    }
    return runtime;
  }
}
