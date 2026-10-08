import { open, readFile, stat } from "node:fs/promises";

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const POLL_INTERVAL_MS = 100;

export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export interface LogLine {
  text: string;
  /** Byte offset right after this line, usable as a cursor. */
  end: number;
}

/**
 * Read complete lines written after byte offset `cursor`.
 *
 * The returned cursor points past the last complete line, so a partially
 * flushed line is picked up whole by the next read. A file shorter than the
 * cursor was rotated (the server restarted), so reading restarts at 0.
 */
export async function readLinesFrom(
  filePath: string,
  cursor: number,
): Promise<{ lines: LogLine[]; cursor: number }> {
  const size = await fileSize(filePath);
  const start = size < cursor ? 0 : cursor;
  if (size === start) {
    return { lines: [], cursor: start };
  }

  const handle = await open(filePath, "r");
  const chunk = Buffer.alloc(size - start);
  try {
    await handle.read(chunk, 0, chunk.length, start);
  } finally {
    await handle.close();
  }

  const lines: LogLine[] = [];
  let lineStart = 0;
  for (let index = 0; index < chunk.length; index++) {
    if (chunk[index] !== 0x0a) continue;
    const raw = chunk.subarray(lineStart, index).toString("utf8");
    lines.push({
      text: stripAnsiCodes(raw.replace(/\r$/, "")),
      end: start + index + 1,
    });
    lineStart = index + 1;
  }
  return { lines, cursor: start + lineStart };
}

export async function tailLines(
  filePath: string,
  count: number,
): Promise<string[]> {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .map((line) => stripAnsiCodes(line).trimEnd())
    .filter((line) => line.length > 0)
    .slice(-count);
}

/**
 * Collect the output a console command produces: lines appended after
 * `cursor`, returned once the log has been quiet for `quietMs` after the first
 * new line, or when `maxMs` elapses.
 */
export async function collectOutput(
  filePath: string,
  cursor: number,
  options: { maxMs: number; quietMs: number },
): Promise<string[]> {
  const deadline = Date.now() + options.maxMs;
  const lines: string[] = [];
  let position = cursor;
  let lastOutputAt = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const read = await readLinesFrom(filePath, position);
    position = read.cursor;
    if (read.lines.length > 0) {
      lines.push(...read.lines.map((line) => line.text));
      lastOutputAt = Date.now();
    } else if (
      lastOutputAt > 0 &&
      Date.now() - lastOutputAt >= options.quietMs
    ) {
      break;
    }
  }

  return lines;
}

export async function waitForLine(
  filePath: string,
  pattern: RegExp,
  cursor: number,
  timeoutMs: number,
): Promise<{ line: string; cursor: number } | null> {
  const deadline = Date.now() + timeoutMs;
  let position = cursor;

  while (true) {
    const read = await readLinesFrom(filePath, position);
    for (const line of read.lines) {
      if (pattern.test(line.text)) {
        return { line: line.text, cursor: line.end };
      }
    }
    position = read.cursor;

    if (Date.now() >= deadline) {
      return null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function detectServerStartupPhase(lines: string[]) {
  const joined = lines.join("\n");
  if (
    /Done \(.+\)! For help, type "help"/.test(joined) ||
    /Done \(\d+\.\d+s?\)!/.test(joined) ||
    /Listening on \//.test(joined)
  ) {
    return "ready";
  }
  if (/Preparing start region|Preparing level/.test(joined)) {
    return "initializing-world";
  }
  if (/Starting Minecraft server on/.test(joined)) {
    return "binding-port";
  }
  if (
    /Loading libraries, please wait|Starting org\.bukkit\.craftbukkit\.Main|Starting minecraft server version|Booting up|Enabled BungeeCord/.test(
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
