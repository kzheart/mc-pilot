import process from "node:process";

import { platform } from "../platform/index.js";

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
  platform.processes.killProcessTree(pid, signal);
}

/**
 * Check whether `pid` is `rootPid` itself or one of its descendants.
 * Used to verify a listening socket actually belongs to a server we spawned
 * (the port could be occupied by an unrelated process).
 */
export function isInProcessTree(pid: number, rootPid: number): boolean {
  return platform.processes.isInProcessTree(pid, rootPid);
}

export function getListeningPids(port: number) {
  return platform.processes.getListeningPids(port);
}

/** PIDs of processes whose command line contains `fragment`. */
export function findPidsByCommandLine(fragment: string) {
  return platform.processes.findPidsByCommandLine(fragment);
}
