import { execFile } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { MctError } from "../util/errors.js";

const execFileAsync = promisify(execFile);

export class ServerCommandPipe {
  async create(stateDir: string, project: string, serverName: string): Promise<string> {
    const stdinPipe = path.join(stateDir, `stdin-${project}-${serverName}.fifo`);
    try {
      await unlink(stdinPipe);
    } catch {
      // stale pipe may not exist
    }
    await execFileAsync("mkfifo", [stdinPipe]);
    return stdinPipe;
  }

  async send(stdinPipe: string, command: string): Promise<void> {
    const line = `${command}\n`;
    let handle;
    try {
      handle = await open(stdinPipe, "w");
    } catch (error) {
      throw new MctError(
        {
          code: "SERVER_STDIN_OPEN_FAILED",
          message: `Failed to open stdin FIFO: ${(error as Error).message}`,
          details: { stdinPipe }
        },
        5
      );
    }

    try {
      await handle.writeFile(line);
    } finally {
      await handle.close();
    }
  }
}
