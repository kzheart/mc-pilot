import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseCliOptions(argv, handlers) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const handler = handlers[arg];
    if (!handler) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (handler.takesValue === false) {
      handler.apply();
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue) {
      throw new Error(`Missing value for ${arg}`);
    }
    handler.apply(nextValue);
    index += 1;
  }
}

export async function runCommand(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      timeout: options.timeoutMs,
      killSignal: "SIGTERM",
    });

    return {
      ok: true,
      command,
      args,
      startedAt,
      durationMs: Date.now() - started,
      exitCode: 0,
      stdout,
      stderr,
      json: parseJsonMaybe(stdout),
    };
  } catch (error) {
    const failure = error;
    const result = {
      ok: false,
      command,
      args,
      startedAt,
      durationMs: Date.now() - started,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
      json:
        parseJsonMaybe(String(failure.stdout ?? "")) ??
        parseJsonMaybe(String(failure.stderr ?? "")),
    };

    if (options.allowFailure) {
      return result;
    }

    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stderr || result.stdout || JSON.stringify(result.json),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

export async function runCommandWithRetry(
  command,
  args,
  options = {},
  retryOptions = {},
) {
  const attempts = retryOptions.attempts ?? 3;
  const delayMs = retryOptions.delayMs ?? 2_000;
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runCommand(command, args, {
      ...options,
      allowFailure: true,
    });
    lastResult = result;
    if (result.ok) {
      return result;
    }
    if (attempt < attempts) {
      await sleep(delayMs * attempt);
    }
  }

  return lastResult;
}

export function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForLogEntry(filePath, text, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(filePath, "utf8");
      if (content.includes(text)) {
        return true;
      }
    } catch {}
    await sleep(500);
  }

  throw new Error(`Did not find log entry within ${timeoutSeconds}s: ${text}`);
}

export async function findAvailablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Failed to resolve an ephemeral port")),
        );
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function findDistinctPorts(count) {
  const ports = new Set();
  while (ports.size < count) {
    ports.add(await findAvailablePort());
  }
  return [...ports];
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function slugifyProjectId(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}
