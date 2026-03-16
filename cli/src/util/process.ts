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
