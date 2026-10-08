import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ServerKind = "game" | "velocity" | "bungeecord";

export interface ServerFlavor {
  kind: ServerKind;
  isProxy: boolean;
  supportsEula: boolean;
  /** Log file the server itself writes, relative to the server directory. */
  logFile: string;
  /** Console command that shuts the server down cleanly. */
  stopCommand: string;
  buildLaunchArgs(jvmArgs: string[], jarFile: string): string[];
  readPort(dir: string): Promise<number>;
  /** `undefined` when the config file has not been generated yet. */
  readOnlineMode(dir: string): Promise<boolean | undefined>;
  /** Config file to edit when online-mode must be turned off. */
  onlineModeFile: string;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function parseProperties(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}

export async function readServerProperties(
  dir: string,
): Promise<Record<string, string> | null> {
  const raw = await readText(path.join(dir, "server.properties"));
  return raw === null ? null : parseProperties(raw);
}

export async function ensureServerProperties(
  dir: string,
  entries: Record<string, string>,
): Promise<void> {
  const filePath = path.join(dir, "server.properties");
  const raw = await readText(filePath);
  let lines = raw === null ? [] : raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  for (const [key, value] of Object.entries(entries)) {
    const pattern = new RegExp(`^\\s*${key}\\s*=`);
    let updated = false;
    lines = lines.map((line) => {
      if (pattern.test(line)) {
        updated = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!updated) {
      lines.push(`${key}=${value}`);
    }
  }

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function parsePortFromAddress(address: string | undefined, fallback: number) {
  const match = address?.match(/:(\d+)\s*$/);
  return match ? Number(match[1]) : fallback;
}

const gameFlavor: ServerFlavor = {
  kind: "game",
  isProxy: false,
  supportsEula: true,
  logFile: path.join("logs", "latest.log"),
  stopCommand: "stop",
  onlineModeFile: "server.properties",
  buildLaunchArgs(jvmArgs, jarFile) {
    return [...jvmArgs, "-jar", jarFile, "nogui"];
  },
  async readPort(dir) {
    const props = await readServerProperties(dir);
    const port = Number(props?.["server-port"]);
    return Number.isInteger(port) && port > 0 ? port : 25565;
  },
  async readOnlineMode(dir) {
    const props = await readServerProperties(dir);
    if (!props) return undefined;
    // Vanilla defaults online-mode to true when the key is absent.
    return props["online-mode"] !== "false";
  },
};

const velocityFlavor: ServerFlavor = {
  kind: "velocity",
  isProxy: true,
  supportsEula: false,
  logFile: path.join("logs", "latest.log"),
  stopCommand: "shutdown",
  onlineModeFile: "velocity.toml",
  buildLaunchArgs(jvmArgs, jarFile) {
    return [...jvmArgs, "-jar", jarFile];
  },
  async readPort(dir) {
    const raw = await readText(path.join(dir, "velocity.toml"));
    const bind = raw?.match(/^\s*bind\s*=\s*"([^"]*)"/m)?.[1];
    return parsePortFromAddress(bind, 25577);
  },
  async readOnlineMode(dir) {
    const raw = await readText(path.join(dir, "velocity.toml"));
    if (raw === null) return undefined;
    return raw.match(/^\s*online-mode\s*=\s*(\w+)/m)?.[1] !== "false";
  },
};

const bungeecordFlavor: ServerFlavor = {
  kind: "bungeecord",
  isProxy: true,
  supportsEula: false,
  logFile: "proxy.log.0",
  stopCommand: "end",
  onlineModeFile: "config.yml",
  buildLaunchArgs(jvmArgs, jarFile) {
    return [...jvmArgs, "-jar", jarFile];
  },
  async readPort(dir) {
    const raw = await readText(path.join(dir, "config.yml"));
    const host = raw?.match(/^\s*-?\s*host:\s*(\S+)/m)?.[1];
    return parsePortFromAddress(host, 25577);
  },
  async readOnlineMode(dir) {
    const raw = await readText(path.join(dir, "config.yml"));
    if (raw === null) return undefined;
    return raw.match(/^online_mode:\s*(\w+)/m)?.[1] !== "false";
  },
};

export function getServerFlavor(kind: ServerKind): ServerFlavor {
  switch (kind) {
    case "velocity":
      return velocityFlavor;
    case "bungeecord":
      return bungeecordFlavor;
    default:
      return gameFlavor;
  }
}

export async function detectServerFlavor(
  dir: string,
  jarFile: string,
): Promise<ServerFlavor> {
  const jarName = path.basename(jarFile).toLowerCase();
  if (
    jarName.includes("velocity") ||
    (await pathExists(path.join(dir, "velocity.toml")))
  ) {
    return velocityFlavor;
  }
  if (/bungee|waterfall|flamecord|travertine/.test(jarName)) {
    return bungeecordFlavor;
  }
  if (
    !(await pathExists(path.join(dir, "server.properties"))) &&
    /^listeners:/m.test((await readText(path.join(dir, "config.yml"))) ?? "")
  ) {
    return bungeecordFlavor;
  }
  return gameFlavor;
}
