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

export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM") {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    process.kill(pid, signal);
  }
}

export function getListeningPids(port: number) {
  const result = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8"
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split(/\s+/)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}
