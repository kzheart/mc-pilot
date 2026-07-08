import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ServerInstanceMeta, ServerType } from "../util/instance-types.js";
import {
  getServerFlavor,
  renderBungeeConfigYml,
  renderVelocityToml,
} from "./server-flavor.js";

function makeMeta(
  overrides: Partial<ServerInstanceMeta> & {
    name: string;
    type: ServerType;
    port: number;
  },
): ServerInstanceMeta {
  return {
    project: "test-project",
    mcVersion: "1.20.4",
    jvmArgs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("vanilla-like flavor launch args", () => {
  const paper = getServerFlavor("paper");
  const velocity = getServerFlavor("velocity");

  assert.deepEqual(paper.buildLaunchArgs(["-Xmx2G"], "/tmp/s.jar"), [
    "-Xmx2G",
    "-jar",
    "/tmp/s.jar",
    "nogui",
  ]);
  assert.deepEqual(velocity.buildLaunchArgs(["-Xmx2G"], "/tmp/s.jar"), [
    "-Xmx2G",
    "-jar",
    "/tmp/s.jar",
  ]);
});

test("game flavors share behavior", () => {
  for (const type of ["paper", "purpur", "spigot", "vanilla"] as const) {
    const flavor = getServerFlavor(type);
    assert.equal(flavor.kind, "game");
    assert.equal(flavor.supportsEula, true);
  }

  for (const type of ["velocity", "bungeecord"] as const) {
    const flavor = getServerFlavor(type);
    assert.equal(flavor.kind, "proxy");
    assert.equal(flavor.supportsEula, false);
  }
});

test("renderVelocityToml modern with servers", () => {
  const meta = makeMeta({
    name: "velocity-1",
    type: "velocity",
    port: 25577,
    proxy: {
      servers: {
        b1: "127.0.0.1:25566",
        b2: "127.0.0.1:25567",
      },
      try: ["b1"],
      forwarding: "modern",
    },
  });

  const output = renderVelocityToml(meta);

  assert.match(output, /bind = "0\.0\.0\.0:25577"/);
  assert.match(output, /player-info-forwarding-mode = "modern"/);
  assert.match(output, /b1 = "127\.0\.0\.1:25566"/);
  assert.match(output, /try = \["b1"\]/);
});

test("renderVelocityToml legacy mode", () => {
  const meta = makeMeta({
    name: "velocity-legacy",
    type: "velocity",
    port: 25577,
    proxy: {
      servers: {},
      try: [],
      forwarding: "legacy",
    },
  });

  const output = renderVelocityToml(meta);

  assert.match(output, /player-info-forwarding-mode = "legacy"/);
});

test("renderVelocityToml without proxy meta", () => {
  const meta = makeMeta({
    name: "velocity-bare",
    type: "velocity",
    port: 25577,
  });

  const output = renderVelocityToml(meta);

  assert.match(output, /try = \[\]/);
  assert.doesNotMatch(output, /= "127\.0\.0\.1/);
});

test("renderBungeeConfigYml essentials", () => {
  const meta = makeMeta({
    name: "bungee-1",
    type: "bungeecord",
    port: 25578,
    proxy: {
      servers: {
        lobby: "127.0.0.1:25566",
      },
      try: ["lobby"],
      forwarding: "modern",
    },
  });

  const output = renderBungeeConfigYml(meta);

  assert.match(output, /host: 0\.0\.0\.0:25578/);
  assert.match(output, /ip_forward: true/);
  assert.match(output, /online_mode: false/);
  assert.match(output, /address: 127\.0\.0\.1:25566/);
});

test("syncConfig idempotent for proxies", async () => {
  const velocityMeta = makeMeta({
    name: "velocity-sync",
    type: "velocity",
    port: 25577,
    proxy: {
      servers: { b1: "127.0.0.1:25566" },
      try: ["b1"],
      forwarding: "modern",
    },
  });
  const bungeeMeta = makeMeta({
    name: "bungee-sync",
    type: "bungeecord",
    port: 25578,
    proxy: {
      servers: { lobby: "127.0.0.1:25566" },
      try: ["lobby"],
      forwarding: "modern",
    },
  });

  const velocityDir = await mkdtemp(path.join(os.tmpdir(), "mct-flavor-"));
  const bungeeDir = await mkdtemp(path.join(os.tmpdir(), "mct-flavor-"));

  const velocityFlavor = getServerFlavor("velocity");
  const bungeeFlavor = getServerFlavor("bungeecord");

  await mkdir(velocityDir, { recursive: true });
  await mkdir(bungeeDir, { recursive: true });

  await velocityFlavor.syncConfig({
    instanceDir: velocityDir,
    meta: velocityMeta,
  });
  await velocityFlavor.syncConfig({
    instanceDir: velocityDir,
    meta: velocityMeta,
  });
  const velocityToml1 = await readFile(
    path.join(velocityDir, "velocity.toml"),
    "utf8",
  );

  await bungeeFlavor.syncConfig({ instanceDir: bungeeDir, meta: bungeeMeta });
  await bungeeFlavor.syncConfig({ instanceDir: bungeeDir, meta: bungeeMeta });
  const bungeeConfig1 = await readFile(
    path.join(bungeeDir, "config.yml"),
    "utf8",
  );

  const velocityToml2 = await readFile(
    path.join(velocityDir, "velocity.toml"),
    "utf8",
  );
  const bungeeConfig2 = await readFile(
    path.join(bungeeDir, "config.yml"),
    "utf8",
  );

  assert.equal(velocityToml1, velocityToml2);
  assert.equal(bungeeConfig1, bungeeConfig2);
});

test("vanilla-like syncConfig writes server.properties", async () => {
  const meta = makeMeta({
    name: "paper-sync",
    type: "paper",
    port: 25565,
  });

  const instanceDir = await mkdtemp(path.join(os.tmpdir(), "mct-flavor-"));
  await mkdir(instanceDir, { recursive: true });

  const flavor = getServerFlavor("paper");
  await flavor.syncConfig({ instanceDir, meta });

  const properties = await readFile(
    path.join(instanceDir, "server.properties"),
    "utf8",
  );

  assert.match(properties, /^server-port=25565$/m);
  assert.match(properties, /^online-mode=false$/m);
});
