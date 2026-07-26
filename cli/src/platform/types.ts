/**
 * Platform abstraction layer.
 *
 * Everything that differs between POSIX (macOS/Linux) and Windows lives
 * behind these interfaces, each with a dedicated implementation in posix.ts
 * and windows.ts. index.ts performs the single platform check that selects
 * the active adapter — no other module should branch on process.platform for
 * process management or server stdin plumbing.
 */

/** OS process inspection and termination. */
export interface ProcessControl {
  /** Terminate `pid` and all of its descendants. */
  killProcessTree(pid: number, signal?: NodeJS.Signals): void;

  /**
   * Check whether `pid` is `rootPid` itself or one of its descendants.
   * Used to verify a listening socket actually belongs to a server we
   * spawned (the port could be occupied by an unrelated process).
   */
  isInProcessTree(pid: number, rootPid: number): boolean;

  /** PIDs of processes listening on the given TCP port. */
  getListeningPids(port: number): number[];

  /**
   * PIDs of processes whose command line contains `fragment`.
   * Used by the E2E harness to hunt down stray client processes.
   */
  findPidsByCommandLine(fragment: string): number[];
}

/** Spawn spec for wiring a detached server process to its stdin channel. */
export interface ServerSpawnSpec {
  command: string;
  args: string[];
  /** Extra environment entries required by the wrapper, if any. */
  env?: Record<string, string>;
}

/**
 * Console-command channel into a detached Minecraft server.
 *
 * The CLI process that starts a server exits immediately, while later CLI
 * invocations must still be able to write console commands into the server's
 * stdin. POSIX backs this with a filesystem FIFO held open by a bash
 * wrapper; Windows backs it with a named pipe served by a bridge process.
 */
export interface ServerStdinChannel {
  /**
   * Resolve (and, if necessary, materialize) the channel for a server.
   * Returns the channel identifier stored in the server's runtime state.
   */
  create(
    stateDir: string,
    project: string,
    serverName: string,
  ): Promise<string>;

  /** Write one command line into the channel. */
  send(channel: string, command: string, timeoutMs?: number): Promise<void>;

  /** Remove any filesystem artifact backing the channel (no-op if none). */
  cleanup(channel: string): Promise<void>;

  /**
   * Build the spawn spec that runs `javaCommand launchArgs...` with its
   * stdin wired to the channel. The caller adds cwd, stdio and the shared
   * environment.
   */
  buildServerSpawn(spec: {
    stdinChannel: string;
    javaCommand: string;
    launchArgs: string[];
  }): ServerSpawnSpec;
}

export interface PlatformAdapter {
  processes: ProcessControl;
  serverStdin: ServerStdinChannel;
}
