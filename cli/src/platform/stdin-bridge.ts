/**
 * Windows stdin bridge for detached Minecraft servers.
 *
 * POSIX builds hold a FIFO open via a bash wrapper so later CLI invocations
 * can write console commands into the server's stdin. Windows named pipes
 * only exist while a process serves them, so this small wrapper plays that
 * role: it spawns the server with a piped stdin, serves the named pipe, and
 * forwards every pipe connection's data into the server.
 *
 * Usage: node stdin-bridge.js <pipeName> <command> [args...]
 * stdout/stderr are inherited (the CLI points them at the server log file).
 */
import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const [pipeName, command, ...args] = process.argv.slice(2);

if (!pipeName || !command) {
  console.error("usage: stdin-bridge <pipeName> <command> [args...]");
  process.exit(2);
}

// Node refuses to spawn .cmd/.bat directly (CVE-2024-27980); route batch
// wrappers through cmd.exe with each argument quoted.
const isBatchCommand =
  process.platform === "win32" && /\.(cmd|bat)$/i.test(command);

const child = isBatchCommand
  ? spawn(
      [command, ...args]
        .map((arg) => `"${String(arg).replace(/"/g, '""')}"`)
        .join(" "),
      {
        stdio: ["pipe", "inherit", "inherit"],
        shell: true,
      },
    )
  : spawn(command, args, {
      stdio: ["pipe", "inherit", "inherit"],
    });

child.stdin?.on("error", () => {
  // The server closed stdin (or died); connections below still drain.
});

const server = net.createServer((socket) => {
  socket.on("error", () => {});
  if (child.stdin && !child.stdin.destroyed) {
    socket.pipe(child.stdin, { end: false });
  } else {
    socket.destroy();
  }
});

server.on("error", () => {
  // A stale bridge already owns the pipe name; commands will reach that
  // instance instead. Keep running so the server itself stays managed.
});

server.listen(pipeName);

child.on("exit", (code, signal) => {
  server.close();
  process.exit(signal ? 1 : (code ?? 0));
});

child.on("error", () => {
  server.close();
  process.exit(1);
});
