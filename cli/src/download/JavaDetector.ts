import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface JavaDetectionResult {
  available: boolean;
  command: string;
  majorVersion?: number;
}

export function parseJavaMajorVersion(output: string) {
  const match = output.match(/version "(?<version>[^"]+)"/);
  if (!match?.groups?.version) {
    return undefined;
  }

  const [first, second] = match.groups.version.split(".");
  if (first === "1" && second) {
    return Number.parseInt(second, 10);
  }

  return Number.parseInt(first, 10);
}

export async function detectJava(command = "java"): Promise<JavaDetectionResult> {
  try {
    const result = await execFileAsync(command, ["-version"]);
    const output = `${result.stdout}\n${result.stderr}`;
    return {
      available: true,
      command,
      majorVersion: parseJavaMajorVersion(output)
    };
  } catch {
    return {
      available: false,
      command
    };
  }
}
