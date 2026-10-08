import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { MctError } from "../util/errors.js";
import { resolveServerTarget, ServerManager } from "./ServerManager.js";

// Stands in for a Paper server: writes logs/latest.log, listens on
// server-port, and answers a few console commands from stdin.
const FAKE_SERVER = `
import fs from "node:fs";
import net from "node:net";
import readline from "node:readline";

fs.writeFileSync("launch-args.json", JSON.stringify(process.argv.slice(2)));
const props = fs.existsSync("server.properties") ? fs.readFileSync("server.properties", "utf8") : "";
const port = Number(props.match(/^server-port=(\\d+)/m)?.[1] ?? 25565);
fs.mkdirSync("logs", { recursive: true });
fs.writeFileSync("logs/latest.log", "");
const log = (message) => {
  const line = "[00:00:00 INFO]: " + message + "\\n";
  fs.appendFileSync("logs/latest.log", line);
  process.stdout.write(line);
};

const mode = process.env.FAKE_SERVER_MODE ?? "normal";
log("Starting minecraft server version 1.21.1");
if (mode === "crash") {
  log("Failed to start the minecraft server: boom");
  process.exit(1);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  // late-done mimics Paper: the port opens while spawn chunks still load.
  const doneDelay = mode === "late-done" ? 1500 : 0;
  net.createServer((socket) => socket.destroy()).listen(port, "127.0.0.1", () => {
    log("Preparing start region for dimension minecraft:overworld");
    setTimeout(() => log('Done (0.1s)! For help, type "help"'), doneDelay);
  });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "stop") {
    log("Stopping server");
    process.exit(0);
  }
  if (line.startsWith("say ")) log("[Server] " + line.slice(4));
  else if (line.startsWith("data get")) log("Steve has the following entity data: 20.0f");
  else log("Unknown command: " + line);
});
`;

/** A `java` stand-in that runs `script` with node, forwarding all arguments. */
async function writeFakeJava(dir: string, script: string) {
  if (process.platform === "win32") {
    const shim = path.join(dir, "fake-java.cmd");
    await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
    return shim;
  }
  const shim = path.join(dir, "fake-java");
  await writeFile(
    shim,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
    {
      mode: 0o755,
    },
  );
  return shim;
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === "object"
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

async function withServerDir(
  run: (ctx: {
    root: string;
    dir: string;
    port: number;
    java: string;
    manager: ServerManager;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-server-"));
  const dir = path.join(root, "run", "paper");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "paper-1.21.1.jar"), "");
  await writeFile(path.join(root, "fake-server.mjs"), FAKE_SERVER);
  const java = await writeFakeJava(root, path.join(root, "fake-server.mjs"));
  const port = await getFreePort();
  const manager = new ServerManager();

  try {
    await run({ root, dir, port, java, manager });
  } finally {
    await manager
      .stop({ name: "paper", dir, config: {} }, 2)
      .catch(() => undefined);
    delete process.env.FAKE_SERVER_MODE;
    await rm(root, { recursive: true, force: true });
  }
}

function target(dir: string, java: string, extra: object = {}) {
  return { name: "paper", dir, config: { java, ...extra } };
}

test("start refuses to boot without an accepted EULA", async () => {
  await withServerDir(async ({ dir, java, manager }) => {
    await assert.rejects(
      manager.start(target(dir, java), { timeoutSeconds: 5 }),
      (error: unknown) =>
        error instanceof MctError && error.code === "EULA_NOT_ACCEPTED",
    );
  });
});

test("start refuses an online-mode server before launching it", async () => {
  await withServerDir(async ({ dir, java, manager }) => {
    await writeFile(path.join(dir, "server.properties"), "online-mode=true\n");
    await assert.rejects(
      manager.start(target(dir, java), { eula: true, timeoutSeconds: 5 }),
      (error: unknown) =>
        error instanceof MctError && error.code === "ONLINE_MODE_ENABLED",
    );
  });
});

test("start seeds offline mode, passes jvm args, and waits for readiness", async () => {
  await withServerDir(async ({ dir, java, manager }) => {
    const started = await manager.start(
      target(dir, java, { jvmArgs: ["-Xmx1G"] }),
      { eula: true, timeoutSeconds: 10 },
    );

    assert.equal(started.running, true);
    assert.equal((started as { ready?: boolean }).ready, true);
    const props = await readFile(path.join(dir, "server.properties"), "utf8");
    assert.match(props, /^online-mode=false$/m);
    assert.match(props, new RegExp(`^server-port=${started.port}$`, "m"));
    assert.deepEqual(
      JSON.parse(await readFile(path.join(dir, "launch-args.json"), "utf8")),
      ["-Xmx1G", "-jar", path.join(dir, "paper-1.21.1.jar"), "nogui"],
    );

    await assert.rejects(
      manager.start(target(dir, java), { eula: true, timeoutSeconds: 5 }),
      (error: unknown) =>
        error instanceof MctError && error.code === "SERVER_ALREADY_RUNNING",
    );
  });
});

test("exec returns the command's log output and a cursor wait-log can resume from", async () => {
  await withServerDir(async ({ dir, java, port, manager }) => {
    await writeFile(
      path.join(dir, "server.properties"),
      `online-mode=false\nserver-port=${port}\n`,
    );
    const t = target(dir, java);
    await manager.start(t, { eula: true, timeoutSeconds: 10 });

    const result = await manager.exec(t, "/data get entity @p Health", 2000);
    assert.equal(result.command, "data get entity @p Health");
    assert.deepEqual(result.output, [
      "[00:00:00 INFO]: Steve has the following entity data: 20.0f",
    ]);

    // The line is already written; --after must still find it.
    const match = await manager.waitLog(t, {
      pattern: /entity data/,
      after: result.cursor,
      timeoutSeconds: 1,
    });
    assert.match(match.line, /20\.0f/);

    await assert.rejects(
      manager.waitLog(t, { pattern: /never/, timeoutSeconds: 0.3 }),
      (error: unknown) => error instanceof MctError && error.code === "TIMEOUT",
    );
  });
});

test("stop shuts the server down through its console", async () => {
  await withServerDir(async ({ dir, java, port, manager }) => {
    await writeFile(
      path.join(dir, "server.properties"),
      `online-mode=false\nserver-port=${port}\n`,
    );
    const t = target(dir, java);
    await manager.start(t, { eula: true, timeoutSeconds: 10 });

    const stopped = await manager.stop(t, 5);
    assert.equal(stopped.stopped, true);
    assert.equal((stopped as { graceful?: boolean }).graceful, true);
    assert.match(
      await readFile(path.join(dir, "logs", "latest.log"), "utf8"),
      /Stopping server/,
    );
    assert.equal((await manager.status(t)).running, false);
    assert.equal((await manager.stop(t)).alreadyStopped, true);
  });
});

test("a server that dies during startup reports SERVER_EXITED with its console output", async () => {
  await withServerDir(async ({ dir, java, port, manager }) => {
    await writeFile(
      path.join(dir, "server.properties"),
      `online-mode=false\nserver-port=${port}\n`,
    );
    process.env.FAKE_SERVER_MODE = "crash";

    await assert.rejects(
      manager.start(target(dir, java), { eula: true, timeoutSeconds: 10 }),
      (error: unknown) => {
        assert.ok(error instanceof MctError);
        assert.equal(error.code, "SERVER_EXITED");
        const details = error.details as { recentLines: string[] };
        assert.ok(
          details.recentLines.some((line) => line.includes("boom")),
          JSON.stringify(details),
        );
        return true;
      },
    );
  });
});

test("start waits for the Done line, not just an open port", async () => {
  await withServerDir(async ({ dir, java, port, manager }) => {
    await writeFile(
      path.join(dir, "server.properties"),
      `online-mode=false\nserver-port=${port}\n`,
    );
    process.env.FAKE_SERVER_MODE = "late-done";

    const startedAt = Date.now();
    const started = await manager.start(target(dir, java), {
      eula: true,
      timeoutSeconds: 10,
    });
    assert.equal((started as { phase?: string }).phase, "ready");
    assert.ok(Date.now() - startedAt >= 1400, "returned before Done");
  });
});

test("waitReady times out with the startup phase", async () => {
  await withServerDir(async ({ dir, java, port, manager }) => {
    await writeFile(
      path.join(dir, "server.properties"),
      `online-mode=false\nserver-port=${port}\n`,
    );
    process.env.FAKE_SERVER_MODE = "hang";

    await assert.rejects(
      manager.start(target(dir, java), { eula: true, timeoutSeconds: 1.5 }),
      (error: unknown) => {
        assert.ok(error instanceof MctError);
        assert.equal(error.code, "TIMEOUT");
        assert.equal(
          (error.details as { phase: string }).phase,
          "bootstrapping",
        );
        return true;
      },
    );
  });
});

test("start fails fast when the port is held by another process", async () => {
  await withServerDir(async ({ dir, java, port, manager }) => {
    await writeFile(
      path.join(dir, "server.properties"),
      `online-mode=false\nserver-port=${port}\n`,
    );
    const squatter = net.createServer();
    await new Promise<void>((resolve) =>
      squatter.listen(port, "127.0.0.1", () => resolve()),
    );
    try {
      await assert.rejects(
        manager.start(target(dir, java), { eula: true, timeoutSeconds: 5 }),
        (error: unknown) =>
          error instanceof MctError && error.code === "PORT_IN_USE",
      );
    } finally {
      squatter.close();
    }
  });
});

test("multiple jars need an explicit jar in mct.json", async () => {
  await withServerDir(async ({ dir, java, manager }) => {
    await writeFile(path.join(dir, "spigot-1.21.1.jar"), "");
    await assert.rejects(
      manager.start(target(dir, java), { eula: true, timeoutSeconds: 5 }),
      (error: unknown) =>
        error instanceof MctError && error.code === "SERVER_JAR_AMBIGUOUS",
    );
  });
});

test("resolveServerTarget prefers run/<name> and falls back to a path", async () => {
  await withServerDir(async ({ root, dir }) => {
    const context = {
      cwd: os.tmpdir(),
      projectRootDir: root,
      projectFile: { servers: { paper: { java: "/opt/java21" } } },
    };

    const byName = await resolveServerTarget(context, "paper");
    assert.equal(byName.dir, dir);
    assert.deepEqual(byName.config, { java: "/opt/java21" });

    const byPath = await resolveServerTarget(
      { cwd: root, projectRootDir: null, projectFile: null },
      "run/paper",
    );
    assert.equal(byPath.dir, dir);

    await assert.rejects(
      resolveServerTarget(context, "missing"),
      (error: unknown) =>
        error instanceof MctError &&
        error.code === "SERVER_NOT_FOUND" &&
        (error.details as { available: string[] }).available.includes("paper"),
    );
  });
});
