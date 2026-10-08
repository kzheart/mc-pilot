import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { resolveCacheRoot } from "../download/CacheManager.js";
import { invalidParams } from "../util/errors.js";
import { GlobalStateStore } from "../util/global-state.js";
import { wrapCommand } from "../util/command.js";
import { resolveClientsDir } from "../util/paths.js";
import { isProcessRunning } from "../util/process.js";

interface Candidate {
  kind: "server-cache" | "client-runtime" | "client";
  path: string;
  bytes: number;
  reason: string;
}

const DURATION_UNITS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+)([mhd])$/);
  if (!match) {
    throw invalidParams(
      `Invalid duration '${value}'; use a number followed by m, h or d (e.g. 30d)`,
    );
  }
  return Number(match[1]) * DURATION_UNITS[match[2]];
}

function diskUsage(target: string): number {
  const result = spawnSync("du", ["-sk", target], { encoding: "utf8" });
  const kib = Number(result.stdout?.split(/\s+/)[0]);
  return Number.isFinite(kib) ? kib * 1024 : 0;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

interface ClientInfo {
  name: string;
  dir: string;
  mcVersion?: string;
  launchArgs: string[];
  lastUsedMs: number;
}

async function readClients(): Promise<ClientInfo[]> {
  const clientsDir = resolveClientsDir();
  const clients: ClientInfo[] = [];
  for (const name of await listDirs(clientsDir)) {
    const dir = path.join(clientsDir, name);
    let meta: { mcVersion?: string; launchArgs?: string[] } = {};
    try {
      meta = JSON.parse(
        await readFile(path.join(dir, "instance.json"), "utf8"),
      );
    } catch {
      // still counts as a client directory; it just pins no runtime
    }
    // The client rewrites its latest.log on every launch, so its mtime is
    // the last time the instance was used.
    const latestLog = path.join(dir, "minecraft", "logs", "latest.log");
    const lastUsedMs = await stat(latestLog)
      .then((info) => info.mtimeMs)
      .catch(() => stat(dir).then((info) => info.mtimeMs));
    clients.push({
      name,
      dir,
      mcVersion: meta.mcVersion,
      launchArgs: meta.launchArgs ?? [],
      lastUsedMs,
    });
  }
  return clients;
}

async function readRunningClientPids(): Promise<Map<string, number>> {
  const state = await new GlobalStateStore().readClientState();
  return new Map(
    Object.entries(state.clients).map(([name, entry]) => [name, entry.pid]),
  );
}

export function createCacheCommand() {
  const command = new Command("cache").description(
    "Manage the shared download cache under ~/.mct/cache",
  );

  command
    .command("clean")
    .description(
      "Reclaim disk space: drop the obsolete server-jar cache and client runtimes no client uses. Dry run unless --yes.",
    )
    .option(
      "--clients-idle <duration>",
      "Also delete client instances unused for this long (e.g. 30d), then the runtimes they pinned",
    )
    .option("--yes", "Actually delete (default: only report)")
    .action(
      wrapCommand(
        async (
          _context,
          { options }: { options: { clientsIdle?: string; yes?: boolean } },
        ) => {
          const cacheRoot = resolveCacheRoot();
          const candidates: Candidate[] = [];

          const serverCache = path.join(cacheRoot, "server");
          if ((await listDirs(cacheRoot)).includes("server")) {
            candidates.push({
              kind: "server-cache",
              path: serverCache,
              bytes: diskUsage(serverCache),
              reason: "server jars are no longer downloaded by mct",
            });
          }

          const clients = await readClients();
          const running = await readRunningClientPids();
          const removedClients = new Set<string>();
          if (options.clientsIdle) {
            const cutoff = Date.now() - parseDuration(options.clientsIdle);
            for (const client of clients) {
              const pid = running.get(client.name);
              if (pid && isProcessRunning(pid)) continue;
              if (client.lastUsedMs >= cutoff) continue;
              removedClients.add(client.name);
              candidates.push({
                kind: "client",
                path: client.dir,
                bytes: diskUsage(client.dir),
                reason: `unused since ${new Date(client.lastUsedMs).toISOString()}`,
              });
            }
          }

          const runtimeRoot = path.join(cacheRoot, "client", "runtime");
          const keptClients = clients.filter(
            (client) => !removedClients.has(client.name),
          );
          for (const version of await listDirs(runtimeRoot)) {
            const runtimeDir = path.join(runtimeRoot, version);
            const users = keptClients.filter(
              (client) =>
                client.mcVersion === version ||
                client.launchArgs.includes(runtimeDir),
            );
            if (users.length > 0) continue;
            candidates.push({
              kind: "client-runtime",
              path: runtimeDir,
              bytes: diskUsage(runtimeDir),
              reason: `no client uses Minecraft ${version}`,
            });
          }

          const deleted: string[] = [];
          const failed: Array<{ path: string; error: string }> = [];
          if (options.yes) {
            for (const candidate of candidates) {
              try {
                await rm(candidate.path, { recursive: true, force: true });
                deleted.push(candidate.path);
              } catch (error) {
                failed.push({
                  path: candidate.path,
                  error: (error as Error).message,
                });
              }
            }
          }

          const totalBytes = candidates.reduce(
            (sum, candidate) => sum + candidate.bytes,
            0,
          );
          return {
            dryRun: !options.yes,
            cacheRoot,
            candidates: candidates.map((candidate) => ({
              ...candidate,
              size: formatBytes(candidate.bytes),
            })),
            reclaimable: formatBytes(totalBytes),
            ...(options.yes ? { deleted, failed } : {}),
          };
        },
      ),
    );

  return command;
}
