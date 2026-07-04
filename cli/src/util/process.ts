import { spawnSync } from "node:child_process";
import process from "node:process";

export function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
) {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    process.kill(pid, signal);
  }
}

/**
 * Check whether `pid` is `rootPid` itself or one of its descendants.
 * Used to verify a listening socket actually belongs to a server we spawned
 * (the port could be occupied by an unrelated process).
 */
export function isInProcessTree(pid: number, rootPid: number): boolean {
  if (pid === rootPid) return true;

  const result = spawnSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return false;
  }

  const parentOf = new Map<number, number>();
  for (const line of result.stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) continue;
    const child = Number(parts[0]);
    const parent = Number(parts[1]);
    if (Number.isInteger(child) && Number.isInteger(parent)) {
      parentOf.set(child, parent);
    }
  }

  let current = pid;
  // walk up the tree; depth cap guards against ppid cycles in a stale snapshot
  for (let depth = 0; depth < 128; depth++) {
    const parent = parentOf.get(current);
    if (parent === undefined || parent <= 1) return false;
    if (parent === rootPid) return true;
    current = parent;
  }
  return false;
}

export function getListeningPids(port: number) {
  const result = spawnSync(
    "lsof",
    ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split(/\s+/)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}
