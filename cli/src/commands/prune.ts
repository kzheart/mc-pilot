import type { Dirent } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { invalidParams } from "../util/errors.js";
import { resolveProjectDir, resolveProjectsDir } from "../util/paths.js";
import { wrapCommand } from "../util/command.js";

const DEFAULT_OLDER_THAN = "7d";

const DURATION_UNITS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDuration(raw: string): number {
  const match = /^(\d+)([hdw])$/.exec(raw.trim());
  if (!match) {
    throw invalidParams(
      `Invalid --older-than value: ${raw}. Use a count plus h, d or w (e.g. 12h, 7d, 2w).`,
    );
  }
  return Number(match[1]) * DURATION_UNITS[match[2]];
}

/** Total bytes and newest mtime under a directory, walked once. */
async function measure(
  dir: string,
): Promise<{ bytes: number; lastUsedMs: number }> {
  let bytes = 0;
  let lastUsedMs = 0;

  async function walk(current: string) {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      try {
        const info = await stat(full);
        bytes += info.size;
        lastUsedMs = Math.max(lastUsedMs, info.mtimeMs);
      } catch {
        // Raced with another process removing the file; ignore.
      }
    }
  }

  await walk(dir);
  return { bytes, lastUsedMs };
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

export function createPruneCommand() {
  return new Command("prune")
    .description(
      "Reclaim disk space by deleting idle server test projects under ~/.mct/projects",
    )
    .option(
      "--older-than <duration>",
      `Only consider projects untouched for at least this long (default: ${DEFAULT_OLDER_THAN})`,
      DEFAULT_OLDER_THAN,
    )
    .option(
      "--yes",
      "Actually delete. Without it prune only reports what it would remove.",
    )
    .option("--keep <ids...>", "Project IDs to always keep")
    .action(
      wrapCommand(
        async (
          context,
          {
            options,
          }: {
            options: { olderThan: string; yes?: boolean; keep?: string[] };
          },
        ) => {
          const maxAgeMs = parseDuration(options.olderThan);
          const cutoffMs = Date.now() - maxAgeMs;
          const keep = new Set(options.keep ?? []);
          // Never touch the project the caller is standing in.
          if (context.projectId) {
            keep.add(context.projectId);
          }

          const projectsDir = resolveProjectsDir();
          let projectIds: string[];
          try {
            projectIds = (await readdir(projectsDir, { withFileTypes: true }))
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name);
          } catch {
            return {
              projectsDir,
              scanned: 0,
              candidates: [],
              kept: [],
              deleted: [],
              reclaimedBytes: 0,
              dryRun: !options.yes,
            };
          }

          // A project whose server is up must survive regardless of mtime:
          // deleting a live instance's directory corrupts the running world.
          const running = new Set(
            (await ServerInstanceManager.statusAll(context.globalState))
              .filter((entry) => entry.running)
              .map((entry) => String(entry.project ?? ""))
              .filter(Boolean),
          );

          const candidates: Array<{
            projectId: string;
            bytes: number;
            size: string;
            lastUsed: string | null;
          }> = [];
          const kept: Array<{ projectId: string; reason: string }> = [];

          for (const projectId of projectIds) {
            if (keep.has(projectId)) {
              kept.push({ projectId, reason: "explicitly kept" });
              continue;
            }
            if (running.has(projectId)) {
              kept.push({ projectId, reason: "server running" });
              continue;
            }
            const { bytes, lastUsedMs } = await measure(
              resolveProjectDir(projectId),
            );
            if (lastUsedMs > cutoffMs) {
              kept.push({
                projectId,
                reason: `used within ${options.olderThan}`,
              });
              continue;
            }
            candidates.push({
              projectId,
              bytes,
              size: formatBytes(bytes),
              lastUsed: lastUsedMs ? new Date(lastUsedMs).toISOString() : null,
            });
          }

          candidates.sort((a, b) => b.bytes - a.bytes);
          const reclaimableBytes = candidates.reduce(
            (sum, entry) => sum + entry.bytes,
            0,
          );

          if (!options.yes) {
            return {
              projectsDir,
              dryRun: true,
              scanned: projectIds.length,
              candidates,
              kept,
              reclaimableBytes,
              reclaimable: formatBytes(reclaimableBytes),
              message:
                candidates.length === 0
                  ? "Nothing to prune."
                  : `Would delete ${candidates.length} project(s), reclaiming ${formatBytes(reclaimableBytes)}. Re-run with --yes to apply. This is not recoverable from the Trash.`,
            };
          }

          const deleted: string[] = [];
          const failed: Array<{ projectId: string; error: string }> = [];
          for (const candidate of candidates) {
            try {
              await rm(resolveProjectDir(candidate.projectId), {
                recursive: true,
                force: true,
              });
              deleted.push(candidate.projectId);
            } catch (error) {
              failed.push({
                projectId: candidate.projectId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          const reclaimedBytes = candidates
            .filter((candidate) => deleted.includes(candidate.projectId))
            .reduce((sum, entry) => sum + entry.bytes, 0);

          return {
            projectsDir,
            dryRun: false,
            scanned: projectIds.length,
            deleted,
            kept,
            ...(failed.length > 0 ? { failed } : {}),
            reclaimedBytes,
            reclaimed: formatBytes(reclaimedBytes),
          };
        },
      ),
    );
}
