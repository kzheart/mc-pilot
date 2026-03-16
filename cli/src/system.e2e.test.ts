import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);

async function runCli(args: string[], cwd: string) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(cwd, "dist/index.js"), ...args], {
    cwd
  });

  return JSON.parse(stdout) as {
    success: boolean;
    data: unknown;
  };
}

async function compileTempServer(tempDir: string) {
  const javaSourcePath = path.join(tempDir, "TestServer.java");
  const classPath = path.join(tempDir, "TestServer.class");
  const jarPath = path.join(tempDir, "test-server.jar");

  await writeFile(
    javaSourcePath,
    [
      "import java.io.IOException;",
      "import java.net.ServerSocket;",
      "",
      "public class TestServer {",
      "  public static void main(String[] args) throws Exception {",
      "    int port = Integer.parseInt(System.getenv().getOrDefault(\"MCT_SERVER_PORT\", \"25565\"));",
      "    try (ServerSocket serverSocket = new ServerSocket(port)) {",
      "      while (true) {",
      "        serverSocket.accept().close();",
      "      }",
      "    } catch (IOException exception) {",
      "      exception.printStackTrace();",
      "      System.exit(1);",
      "    }",
      "  }",
      "}"
    ].join("\n"),
    "utf8"
  );

  await execFileAsync("javac", [javaSourcePath]);
  await execFileAsync("jar", ["--create", "--file", jarPath, "--main-class", "TestServer", "-C", tempDir, path.basename(classPath)]);

  return jarPath;
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port"));
        return;
      }

      const { port } = address;
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

test("system e2e: CLI can orchestrate server, client and request flow", async () => {
  const cwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-e2e-"));
  const stateDir = path.join(tempDir, "state");
  const configPath = path.join(tempDir, "mct.config.json");
  const serverDir = path.join(tempDir, "server-runtime");
  const jarPath = await compileTempServer(tempDir);
  const serverPort = await getFreePort();
  const clientPort = await getFreePort();

  await mkdir(stateDir, { recursive: true });
  await mkdir(serverDir, { recursive: true });

  await writeFile(
    configPath,
    JSON.stringify(
      {
        server: {
          jar: jarPath,
          dir: serverDir,
          port: serverPort,
          jvmArgs: []
        },
        clients: {
          bot: {
            wsPort: clientPort,
            workingDir: "..",
            launchCommand: [
              "node",
              "--input-type=module",
              "-e",
              "import { WebSocketServer } from 'ws'; const port = Number(process.env.MCT_CLIENT_WS_PORT || 25560); setTimeout(() => { const server = new WebSocketServer({ port }); server.on('connection', (socket) => { socket.on('message', (raw) => { const request = JSON.parse(raw.toString()); socket.send(JSON.stringify({ id: request.id, success: true, data: { echoedAction: request.action, params: request.params } })); }); }); }, 1500); setInterval(() => {}, 1000);"
            ]
          }
        },
        timeout: {
          serverReady: 5,
          clientReady: 5,
          default: 5
        }
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const configShow = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "config-show"],
      cwd
    );
    assert.equal(configShow.success, true);
    assert.equal((configShow.data as { stateDir: string }).stateDir, stateDir);
    assert.equal((configShow.data as { config: { server: { port: number } } }).config.server.port, serverPort);

    const serverStart = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "server", "start", "--eula"],
      cwd
    );
    assert.equal(serverStart.success, true);

    const serverStatus = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "server", "status"],
      cwd
    );
    assert.equal(serverStatus.success, true);
    assert.equal((serverStatus.data as { running: boolean }).running, true);
    assert.equal((serverStatus.data as { port: number }).port, serverPort);

    const serverReady = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "server", "wait-ready", "--timeout", "5"],
      cwd
    );
    assert.equal(serverReady.success, true);

    const clientLaunch = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "client", "launch", "bot"],
      cwd
    );
    assert.equal(clientLaunch.success, true);

    const clientReady = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "client", "wait-ready", "bot", "--timeout", "5"],
      cwd
    );
    assert.equal(clientReady.success, true);

    const chatSend = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "chat", "send", "hello"],
      cwd
    );
    assert.equal((chatSend.data as { data: { echoedAction: string } }).data.echoedAction, "chat.send");

    const moveTo = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "--client", "bot", "move", "to", "1", "64", "2"],
      cwd
    );
    assert.equal((moveTo.data as { data: { echoedAction: string } }).data.echoedAction, "move.to");

    const guiClick = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "gui", "click", "13", "--button", "right"],
      cwd
    );
    assert.equal((guiClick.data as { data: { echoedAction: string } }).data.echoedAction, "gui.click");

    const waitResult = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "wait", "1"],
      cwd
    );
    assert.equal((waitResult.data as { data: { echoedAction: string } }).data.echoedAction, "wait.perform");

    const clientList = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "client", "list"],
      cwd
    );
    assert.equal((clientList.data as { clients: Array<{ running: boolean }> }).clients[0]?.running, true);

    const clientStop = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "client", "stop", "bot"],
      cwd
    );
    assert.equal(clientStop.success, true);
    assert.equal((clientStop.data as { stopped: boolean }).stopped, true);

    const clientListAfterStop = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "client", "list"],
      cwd
    );
    assert.equal((clientListAfterStop.data as { clients: Array<unknown> }).clients.length, 0);

    const serverStop = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "server", "stop"],
      cwd
    );
    assert.equal(serverStop.success, true);
    assert.equal((serverStop.data as { stopped: boolean }).stopped, true);

    const serverStatusAfterStop = await runCli(
      ["--config", configPath, "--state-dir", stateDir, "server", "status"],
      cwd
    );
    assert.equal(serverStatusAfterStop.success, true);
    assert.equal((serverStatusAfterStop.data as { running: boolean }).running, false);

    const serverLog = await readFile(path.join(stateDir, "logs", "paper-server.log"), "utf8");
    assert.equal(typeof serverLog, "string");
  } finally {
    await Promise.allSettled([
      runCli(["--config", configPath, "--state-dir", stateDir, "client", "stop", "bot"], cwd),
      runCli(["--config", configPath, "--state-dir", stateDir, "server", "stop"], cwd)
    ]);
    await rm(tempDir, { recursive: true, force: true });
  }
});
