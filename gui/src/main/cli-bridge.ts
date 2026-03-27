import { execFile } from "node:child_process";

export interface CliResult {
  success: boolean;
  data?: unknown;
  error?: { code?: string; message: string; details?: unknown };
}

export function execMct(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile("mct", args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        try {
          const parsed = JSON.parse(stderr);
          resolve({ success: false, error: parsed.error ?? parsed });
        } catch {
          resolve({
            success: false,
            error: { message: stderr.trim() || error.message }
          });
        }
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ success: true, data: stdout.trim() });
      }
    });
  });
}
