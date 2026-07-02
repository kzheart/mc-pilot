import { open, readFile, stat, writeFile } from "node:fs/promises";

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export interface ServerStartupSnapshot {
  phase: string;
  logPath: string;
  recentLines: string[];
  lastLine: string | null;
}

export interface ServerLogReadOptions {
  tail?: number;
  grep?: string;
  since?: number;
  sinceStart?: boolean;
  afterMarker?: string;
  rawColors?: boolean;
}

export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

export class ServerLogManager {
  async describeStartup(logPath: string): Promise<ServerStartupSnapshot> {
    const raw = await readFile(logPath, "utf8").catch(() => "");
    const recentLines = raw
      .split(/\r?\n/)
      .map((line) => stripAnsiCodes(line).trim())
      .filter((line) => line.length > 0)
      .slice(-10);
    const lastLine = recentLines[recentLines.length - 1] ?? null;

    return {
      phase: detectServerStartupPhase(recentLines),
      logPath,
      recentLines,
      lastLine,
    };
  }

  async read(
    logPath: string,
    options: ServerLogReadOptions = {},
    logStartOffset?: number,
  ): Promise<{
    logPath: string;
    totalLines: number;
    returnedLines: number;
    lines: string[];
  }> {
    let raw = await readFile(logPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );

    if (options.sinceStart && logStartOffset && logStartOffset > 0) {
      raw = raw.slice(logStartOffset);
    }

    let lines = raw.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "")
      lines = lines.slice(0, -1);
    const total = lines.length;

    if (!options.rawColors) {
      lines = lines.map((line) => stripAnsiCodes(line));
    }

    if (options.since !== undefined && options.since > 0) {
      lines = lines.slice(Math.max(0, options.since));
    }

    if (options.afterMarker) {
      let markerIndex = -1;
      for (let index = lines.length - 1; index >= 0; index--) {
        if (lines[index]!.includes(options.afterMarker)) {
          markerIndex = index;
          break;
        }
      }
      if (markerIndex >= 0) {
        lines = lines.slice(markerIndex + 1);
      }
    }

    if (options.grep) {
      const re = new RegExp(options.grep);
      lines = lines.filter((line) => re.test(line));
    }

    if (
      options.tail !== undefined &&
      options.tail > 0 &&
      lines.length > options.tail
    ) {
      lines = lines.slice(lines.length - options.tail);
    }

    return { logPath, totalLines: total, returnedLines: lines.length, lines };
  }

  async mark(
    logPath: string,
    label?: string,
  ): Promise<{ logPath: string; marker: string }> {
    const marker = `MCT_MARK ${new Date().toISOString()} ${label ?? ""}`.trim();
    await writeFile(logPath, `\n${marker}\n`, { flag: "a", encoding: "utf8" });
    return { logPath, marker };
  }

  async follow(
    logPath: string,
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
    const re = options.grep ? new RegExp(options.grep) : null;

    let offset = 0;
    try {
      offset = (await stat(logPath)).size;
    } catch {
      /* file may not exist yet */
    }

    const matches: string[] = [];
    let buffer = "";
    let done = false;

    return await new Promise((resolve) => {
      let timer: NodeJS.Timeout;
      let poll: NodeJS.Timeout;

      const finish = (timedOut: boolean) => {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        resolve({ logPath, matched: matches.length > 0, matches, timedOut });
      };

      const drain = async () => {
        if (done) return;
        let currentSize: number;
        try {
          currentSize = (await stat(logPath)).size;
        } catch {
          return;
        }
        if (currentSize < offset) {
          offset = 0;
          buffer = "";
        }
        if (currentSize === offset) return;

        const fh = await open(logPath, "r");
        try {
          const length = currentSize - offset;
          const buf = Buffer.allocUnsafe(length);
          await fh.read(buf, 0, length, offset);
          offset = currentSize;
          buffer += buf.toString("utf8");
        } finally {
          await fh.close();
        }

        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const rendered = options.rawColors ? line : stripAnsiCodes(line);
          if (!re || re.test(rendered)) {
            matches.push(rendered);
            if (options.firstMatchOnly) return finish(false);
          }
        }
      };

      timer = setTimeout(() => finish(true), options.timeoutSeconds * 1000);
      poll = setInterval(() => {
        void drain();
      }, 300);
    });
  }
}

function detectServerStartupPhase(lines: string[]) {
  const joined = lines.join("\n");
  if (/Done \(.+\)! For help, type "help"/.test(joined)) {
    return "ready";
  }
  if (/Preparing start region|Preparing level/.test(joined)) {
    return "initializing-world";
  }
  if (/Starting Minecraft server on/.test(joined)) {
    return "binding-port";
  }
  if (
    /Loading libraries, please wait|Starting org\.bukkit\.craftbukkit\.Main|Starting minecraft server version/.test(
      joined,
    )
  ) {
    return "bootstrapping";
  }
  if (/Downloading |Applying patches/.test(joined)) {
    return "downloading";
  }
  if (lines.length > 0) {
    return "starting";
  }
  return "waiting-for-log";
}
