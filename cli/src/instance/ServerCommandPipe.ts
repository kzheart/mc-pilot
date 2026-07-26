import { platform } from "../platform/index.js";

/**
 * Console-command channel into a detached server process.
 *
 * Facade over the platform adapter's ServerStdinChannel: a filesystem FIFO
 * held open by a bash wrapper on POSIX, a named pipe served by a bridge
 * process on Windows. See cli/src/platform/.
 */
export class ServerCommandPipe {
  async create(
    stateDir: string,
    project: string,
    serverName: string,
  ): Promise<string> {
    return platform.serverStdin.create(stateDir, project, serverName);
  }

  async send(
    stdinPipe: string,
    command: string,
    timeoutMs?: number,
  ): Promise<void> {
    return platform.serverStdin.send(stdinPipe, command, timeoutMs);
  }

  async cleanup(stdinPipe: string): Promise<void> {
    return platform.serverStdin.cleanup(stdinPipe);
  }
}
