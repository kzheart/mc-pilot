import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_WS_PORT_BASE = 25580;

export interface MctConfig {
  server: {
    jar?: string;
    dir: string;
    port: number;
    jvmArgs: string[];
  };
  clients: Record<string, {
    version?: string;
    account?: string;
    wsPort?: number;
    server?: string;
    headless?: boolean;
    launchCommand?: string[];
    launchArgs?: string[];
    workingDir?: string;
    env?: Record<string, string>;
  }>;
  screenshot: {
    outputDir: string;
  };
  timeout: {
    serverReady: number;
    clientReady: number;
    default: number;
  };
}

function createDefaultConfig(): MctConfig {
  return {
    server: {
      dir: "./server",
      port: 25565,
      jvmArgs: []
    },
    clients: {},
    screenshot: {
      outputDir: "./screenshots"
    },
    timeout: {
      serverReady: 120,
      clientReady: 60,
      default: 10
    }
  };
}

export function resolveConfigPath(configPath: string | undefined, cwd: string) {
  if (!configPath) {
    return path.join(cwd, "mct.config.json");
  }

  return path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);
}

export async function loadConfig(configPath: string | undefined, cwd: string): Promise<MctConfig> {
  const resolvedPath = resolveConfigPath(configPath, cwd);
  const defaultConfig = createDefaultConfig();

  try {
    await access(resolvedPath);
  } catch {
    return defaultConfig;
  }

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<MctConfig>;

  return {
    server: {
      ...defaultConfig.server,
      ...parsed.server
    },
    clients: parsed.clients ?? defaultConfig.clients,
    screenshot: {
      ...defaultConfig.screenshot,
      ...parsed.screenshot
    },
    timeout: {
      ...defaultConfig.timeout,
      ...parsed.timeout
    }
  };
}

export async function writeConfig(configPath: string | undefined, cwd: string, config: MctConfig) {
  const resolvedPath = resolveConfigPath(configPath, cwd);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
