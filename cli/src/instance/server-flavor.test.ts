import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  detectServerFlavor,
  ensureServerProperties,
  getServerFlavor,
} from "./server-flavor.js";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "mct-flavor-"));
}

test("launch args: game servers get nogui, proxies do not", () => {
  assert.deepEqual(
    getServerFlavor("game").buildLaunchArgs(["-Xmx2G"], "/tmp/s.jar"),
    ["-Xmx2G", "-jar", "/tmp/s.jar", "nogui"],
  );
  assert.deepEqual(
    getServerFlavor("velocity").buildLaunchArgs(["-Xmx2G"], "/tmp/s.jar"),
    ["-Xmx2G", "-jar", "/tmp/s.jar"],
  );
});

test("detectServerFlavor recognizes proxies by jar name or config", async () => {
  const dir = await tempDir();
  assert.equal(
    (await detectServerFlavor(dir, path.join(dir, "paper-1.21.1-119.jar")))
      .kind,
    "game",
  );
  assert.equal(
    (await detectServerFlavor(dir, path.join(dir, "velocity-3.4.0.jar"))).kind,
    "velocity",
  );
  assert.equal(
    (await detectServerFlavor(dir, path.join(dir, "Waterfall.jar"))).kind,
    "bungeecord",
  );

  const renamedVelocity = await tempDir();
  await writeFile(
    path.join(renamedVelocity, "velocity.toml"),
    'bind = "0.0.0.0:25600"\n',
  );
  const flavor = await detectServerFlavor(
    renamedVelocity,
    path.join(renamedVelocity, "proxy.jar"),
  );
  assert.equal(flavor.kind, "velocity");
  assert.equal(await flavor.readPort(renamedVelocity), 25600);
});

test("game flavor reads port and online-mode from server.properties", async () => {
  const dir = await tempDir();
  const flavor = getServerFlavor("game");

  assert.equal(await flavor.readOnlineMode(dir), undefined);
  assert.equal(await flavor.readPort(dir), 25565);

  await writeFile(path.join(dir, "server.properties"), "motd=x\n");
  assert.equal(
    await flavor.readOnlineMode(dir),
    true,
    "a missing key means vanilla's default online-mode=true",
  );

  await ensureServerProperties(dir, {
    "online-mode": "false",
    "server-port": "25570",
  });
  assert.equal(await flavor.readOnlineMode(dir), false);
  assert.equal(await flavor.readPort(dir), 25570);
  assert.match(
    await readFile(path.join(dir, "server.properties"), "utf8"),
    /^motd=x$/m,
  );
});

test("bungeecord flavor reads listener port and online_mode", async () => {
  const dir = await tempDir();
  await writeFile(
    path.join(dir, "config.yml"),
    "listeners:\n- host: 0.0.0.0:25590\n  motd: x\nonline_mode: false\n",
  );
  const flavor = getServerFlavor("bungeecord");
  assert.equal(await flavor.readPort(dir), 25590);
  assert.equal(await flavor.readOnlineMode(dir), false);
  assert.equal(flavor.logFile, "proxy.log.0");
});
