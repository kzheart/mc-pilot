import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncTopology } from "./TopologySync.js";
import { ServerInstanceManager } from "./ServerInstanceManager.js";
import { GlobalStateStore } from "../util/global-state.js";
import { MctError } from "../util/errors.js";
import { resolveServerInstanceDir } from "../util/paths.js";
import type { ServerInstanceMeta } from "../util/instance-types.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectYamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectYamlFiles(fullPath)));
      continue;
    }
    if (entry.name.endsWith(".yml")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function createInstance(
  project: string,
  meta: Omit<ServerInstanceMeta, "createdAt"> & { createdAt?: string },
): Promise<void> {
  const instanceDir = resolveServerInstanceDir(project, meta.name);
  await mkdir(instanceDir, { recursive: true });
  const fullMeta: ServerInstanceMeta = {
    ...meta,
    createdAt: meta.createdAt ?? new Date().toISOString(),
  };
  await writeFile(
    path.join(instanceDir, "instance.json"),
    `${JSON.stringify(fullMeta, null, 2)}\n`,
    "utf8",
  );
}

async function withTempMctHome(
  fn: (project: string, manager: ServerInstanceManager) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-topology-"));
  const previousMctHome = process.env.MCT_HOME;
  process.env.MCT_HOME = tempDir;

  try {
    const project = "test-project";
    const globalState = new GlobalStateStore();
    const manager = new ServerInstanceManager(globalState, project);
    await fn(project, manager);
  } finally {
    if (previousMctHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousMctHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("velocity_modern_topology", async () => {
  await withTempMctHome(async (project, manager) => {
    await createInstance(project, {
      name: "b1",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25566,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "b2",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25567,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "proxy",
      project,
      type: "velocity",
      mcVersion: "1.21.4",
      port: 25577,
      jvmArgs: [],
    });

    const result = await syncTopology(manager, project, ["b1", "b2"], "proxy");

    const b1Dir = resolveServerInstanceDir(project, "b1");
    const b2Dir = resolveServerInstanceDir(project, "b2");
    const proxyDir = resolveServerInstanceDir(project, "proxy");

    const b1Yaml = await readFile(
      path.join(b1Dir, "config", "paper-global.yml"),
      "utf8",
    );
    const b2Yaml = await readFile(
      path.join(b2Dir, "config", "paper-global.yml"),
      "utf8",
    );
    const secret = (
      await readFile(path.join(proxyDir, "forwarding.secret"), "utf8")
    ).trim();
    const velocityToml = await readFile(
      path.join(proxyDir, "velocity.toml"),
      "utf8",
    );

    assert.ok(b1Yaml.includes(secret));
    assert.ok(b2Yaml.includes(secret));
    assert.equal(b1Yaml, b2Yaml);
    assert.ok(velocityToml.includes('player-info-forwarding-mode = "modern"'));
    assert.ok(velocityToml.includes('b1 = "127.0.0.1:25566"'));
    assert.equal(result.proxy?.forwarding, "modern");
  });
});

test("velocity_legacy_with_112_backend", async () => {
  await withTempMctHome(async (project, manager) => {
    await createInstance(project, {
      name: "modern",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25566,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "legacy",
      project,
      type: "paper",
      mcVersion: "1.12.2",
      port: 25567,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "proxy",
      project,
      type: "velocity",
      mcVersion: "1.21.4",
      port: 25577,
      jvmArgs: [],
    });

    const result = await syncTopology(
      manager,
      project,
      ["modern", "legacy"],
      "proxy",
    );

    const legacyDir = resolveServerInstanceDir(project, "legacy");
    const proxyDir = resolveServerInstanceDir(project, "proxy");

    const spigotYaml = await readFile(
      path.join(legacyDir, "spigot.yml"),
      "utf8",
    );
    const velocityToml = await readFile(
      path.join(proxyDir, "velocity.toml"),
      "utf8",
    );

    assert.ok(spigotYaml.includes("bungeecord: true"));
    assert.ok(velocityToml.includes('"legacy"'));
    assert.equal(result.proxy?.forwarding, "legacy");
  });
});

test("bungeecord_no_secret", async () => {
  await withTempMctHome(async (project, manager) => {
    await createInstance(project, {
      name: "backend",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25566,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "proxy",
      project,
      type: "bungeecord",
      mcVersion: "1.21.4",
      port: 25577,
      jvmArgs: [],
    });

    await syncTopology(manager, project, ["backend"], "proxy");

    const proxyDir = resolveServerInstanceDir(project, "proxy");
    const backendDir = resolveServerInstanceDir(project, "backend");

    assert.equal(
      await pathExists(path.join(proxyDir, "forwarding.secret")),
      false,
    );
    const configYml = await readFile(path.join(proxyDir, "config.yml"), "utf8");
    const spigotYaml = await readFile(
      path.join(backendDir, "spigot.yml"),
      "utf8",
    );

    assert.ok(configYml.includes("ip_forward: true"));
    assert.ok(spigotYaml.includes("bungeecord: true"));
  });
});

test("secret_stable_across_calls", async () => {
  await withTempMctHome(async (project, manager) => {
    await createInstance(project, {
      name: "backend",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25566,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "proxy",
      project,
      type: "velocity",
      mcVersion: "1.21.4",
      port: 25577,
      jvmArgs: [],
    });

    await syncTopology(manager, project, ["backend"], "proxy");
    const secretAfterFirst = (
      await readFile(
        path.join(
          resolveServerInstanceDir(project, "proxy"),
          "forwarding.secret",
        ),
        "utf8",
      )
    ).trim();

    await syncTopology(manager, project, ["backend"], "proxy");
    const secretAfterSecond = (
      await readFile(
        path.join(
          resolveServerInstanceDir(project, "proxy"),
          "forwarding.secret",
        ),
        "utf8",
      )
    ).trim();

    assert.equal(secretAfterFirst, secretAfterSecond);
    assert.ok(secretAfterFirst.length > 0);
  });
});

test("backend_cannot_be_proxy", async () => {
  await withTempMctHome(async (project, manager) => {
    await createInstance(project, {
      name: "velocity-backend",
      project,
      type: "velocity",
      mcVersion: "1.21.4",
      port: 25577,
      jvmArgs: [],
    });

    await assert.rejects(
      () => syncTopology(manager, project, ["velocity-backend"], undefined),
      (error: unknown) => {
        assert.ok(error instanceof MctError);
        assert.equal(error.code, "INVALID_TOPOLOGY");
        return true;
      },
    );
  });
});

test("no_proxy_is_noop", async () => {
  await withTempMctHome(async (project, manager) => {
    await createInstance(project, {
      name: "b1",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25566,
      jvmArgs: [],
    });
    await createInstance(project, {
      name: "b2",
      project,
      type: "paper",
      mcVersion: "1.21.4",
      port: 25567,
      jvmArgs: [],
    });

    const result = await syncTopology(
      manager,
      project,
      ["b1", "b2"],
      undefined,
    );

    assert.deepEqual(result.backends, [
      { name: "b1", port: 25566 },
      { name: "b2", port: 25567 },
    ]);
    assert.equal(result.proxy, undefined);
    assert.deepEqual(result.warnings, []);

    const b1Yaml = await collectYamlFiles(
      resolveServerInstanceDir(project, "b1"),
    );
    const b2Yaml = await collectYamlFiles(
      resolveServerInstanceDir(project, "b2"),
    );
    assert.deepEqual(b1Yaml, []);
    assert.deepEqual(b2Yaml, []);
  });
});
