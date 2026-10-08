import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkProxyForwarding, readYamlScalar } from "./proxy-check.js";

test("readYamlScalar follows direct children only", () => {
  const yaml = [
    "proxies:",
    "  bungee-cord:",
    "    online-mode: true",
    "  velocity:",
    "    enabled: true",
    "    online-mode: false",
    "    secret: 'abc'",
    "settings:",
    "  enabled: false",
  ].join("\n");

  assert.equal(
    readYamlScalar(yaml, ["proxies", "velocity", "enabled"]),
    "true",
  );
  assert.equal(readYamlScalar(yaml, ["proxies", "velocity", "secret"]), "abc");
  assert.equal(readYamlScalar(yaml, ["proxies", "enabled"]), undefined);
  assert.equal(readYamlScalar(yaml, ["settings", "enabled"]), "false");
});

async function setupVelocity(options: {
  secret: string;
  backendSecret: string;
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-proxy-"));
  const proxyDir = path.join(root, "velocity");
  const lobbyDir = path.join(root, "lobby");
  const gameDir = path.join(root, "game");
  await mkdir(proxyDir);
  await mkdir(path.join(lobbyDir, "config"), { recursive: true });
  await mkdir(path.join(gameDir, "config"), { recursive: true });

  await writeFile(
    path.join(proxyDir, "velocity.toml"),
    [
      'bind = "0.0.0.0:25577"',
      "online-mode = false",
      'player-info-forwarding-mode = "modern"',
      "[servers]",
      '"lobby" = "127.0.0.1:25565"',
      'try = ["lobby"]',
      "[forced-hosts]",
    ].join("\n"),
  );
  await writeFile(
    path.join(proxyDir, "forwarding.secret"),
    `${options.secret}\n`,
  );
  for (const dir of [lobbyDir, gameDir]) {
    await writeFile(
      path.join(dir, "config", "paper-global.yml"),
      `proxies:\n  velocity:\n    enabled: true\n    secret: '${options.backendSecret}'\n`,
    );
  }

  return {
    proxy: { name: "velocity", dir: proxyDir, kind: "velocity" as const },
    backends: [
      { name: "lobby", dir: lobbyDir, port: 25565 },
      { name: "game", dir: gameDir, port: 25566 },
    ],
  };
}

test("velocity check reports unlisted backends and secret mismatches", async () => {
  const input = await setupVelocity({ secret: "s1", backendSecret: "s2" });
  const result = await checkProxyForwarding(input);

  assert.equal(result.issues.length, 3);
  assert.match(result.issues[0], /no entry for game \(port 25566\)/);
  assert.match(result.issues[1], /lobby: .*secret.*does not match/);
  assert.match(result.issues[2], /game: .*secret.*does not match/);
});

test("velocity check passes a consistent setup", async () => {
  const input = await setupVelocity({ secret: "same", backendSecret: "same" });
  const result = await checkProxyForwarding({
    ...input,
    backends: [input.backends[0]],
  });
  assert.deepEqual(result, { issues: [], warnings: [] });
});

test("bungeecord check requires ip_forward and spigot bungeecord mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-proxy-"));
  const proxyDir = path.join(root, "bungee");
  const backendDir = path.join(root, "lobby");
  await mkdir(proxyDir);
  await mkdir(backendDir);
  await writeFile(
    path.join(proxyDir, "config.yml"),
    "servers:\n  lobby:\n    address: localhost:25565\nip_forward: false\n",
  );
  await writeFile(
    path.join(backendDir, "spigot.yml"),
    "settings:\n  bungeecord: false\n",
  );

  const result = await checkProxyForwarding({
    proxy: { name: "bungee", dir: proxyDir, kind: "bungeecord" },
    backends: [{ name: "lobby", dir: backendDir, port: 25565 }],
  });
  assert.deepEqual(result.issues, [
    "bungee: set ip_forward: true in config.yml",
    "lobby: legacy forwarding requires settings.bungeecord: true in spigot.yml",
  ]);
});
