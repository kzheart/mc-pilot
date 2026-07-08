import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareMcVersions,
  decideForwardingMode,
  ensureBackendForwarding,
  ensureYamlSection,
} from "./forwarding.js";

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

test("decideForwardingMode_bungee_always_legacy", () => {
  assert.equal(decideForwardingMode("bungeecord", ["1.21.4"]), "legacy");
});

test("decideForwardingMode_velocity_all_modern", () => {
  assert.equal(decideForwardingMode("velocity", ["1.13", "1.21.11"]), "modern");
});

test("decideForwardingMode_velocity_112_downgrades", () => {
  assert.equal(
    decideForwardingMode("velocity", ["1.21.4", "1.12.2"]),
    "legacy",
  );
});

test("compareMcVersions_ordering", () => {
  assert.ok(compareMcVersions("1.12.2", "1.13") < 0);
  assert.ok(compareMcVersions("1.13", "1.19.4") < 0);
  assert.ok(compareMcVersions("1.19.4", "1.21.11") < 0);
  assert.equal(compareMcVersions("1.13", "1.13.0"), 0);
});

test("ensureYamlSection_creates_missing_file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));
  const filePath = path.join(tempDir, "paper-global.yml");

  try {
    await ensureYamlSection(filePath, ["proxies", "velocity"], {
      enabled: true,
      "online-mode": false,
      secret: "abc",
    });

    const content = await readFile(filePath, "utf8");
    assert.equal(
      content,
      [
        "proxies:",
        "  velocity:",
        "    enabled: true",
        "    online-mode: false",
        '    secret: "abc"',
        "",
      ].join("\n"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureYamlSection_updates_existing_key_preserves_others", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));
  const filePath = path.join(tempDir, "paper-global.yml");

  try {
    await writeFile(
      filePath,
      [
        "verbose: false",
        "proxies:",
        "  velocity:",
        "    enabled: false",
        "",
      ].join("\n"),
      "utf8",
    );

    await ensureYamlSection(filePath, ["proxies", "velocity"], {
      enabled: true,
      "online-mode": false,
      secret: "abc",
    });

    const content = await readFile(filePath, "utf8");
    assert.match(content, /^verbose: false\n/);
    assert.match(content, / {4}enabled: true\n/);
    assert.match(content, / {4}online-mode: false\n/);
    assert.match(content, / {4}secret: "abc"\n/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureYamlSection_idempotent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));
  const filePath = path.join(tempDir, "paper-global.yml");
  const sectionPath = ["proxies", "velocity"] as const;
  const entries = {
    enabled: true,
    "online-mode": false,
    secret: "abc",
  };

  try {
    await ensureYamlSection(filePath, [...sectionPath], entries);
    const first = await readFile(filePath, "utf8");
    await ensureYamlSection(filePath, [...sectionPath], entries);
    const second = await readFile(filePath, "utf8");
    assert.equal(second, first);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureBackendForwarding_paper_119_writes_paper_global", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));

  try {
    const warnings = await ensureBackendForwarding(
      tempDir,
      "paper",
      "1.21.4",
      "modern",
      "s3cr3t",
    );

    assert.deepEqual(warnings, []);
    const paperGlobalPath = path.join(tempDir, "config", "paper-global.yml");
    assert.equal(await pathExists(paperGlobalPath), true);
    const paperGlobal = await readFile(paperGlobalPath, "utf8");
    assert.match(paperGlobal, /secret: "s3cr3t"/);

    const serverProperties = await readFile(
      path.join(tempDir, "server.properties"),
      "utf8",
    );
    assert.match(serverProperties, /online-mode=false/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureBackendForwarding_paper_113_writes_paper_yml", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));

  try {
    await ensureBackendForwarding(
      tempDir,
      "paper",
      "1.16.5",
      "modern",
      "s3cr3t",
    );

    const paperYmlPath = path.join(tempDir, "paper.yml");
    assert.equal(await pathExists(paperYmlPath), true);
    const paperYml = await readFile(paperYmlPath, "utf8");
    assert.match(paperYml, /velocity-support:/);
    assert.match(paperYml, /enabled: true/);
    assert.equal(
      await pathExists(path.join(tempDir, "config", "paper-global.yml")),
      false,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureBackendForwarding_legacy_writes_spigot_yml", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));

  try {
    await ensureBackendForwarding(
      tempDir,
      "paper",
      "1.12.2",
      "legacy",
      "s3cr3t",
    );

    const spigotYml = await readFile(path.join(tempDir, "spigot.yml"), "utf8");
    assert.match(spigotYml, /settings:/);
    assert.match(spigotYml, /bungeecord: true/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureBackendForwarding_vanilla_warns", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-forwarding-"));

  try {
    const warnings = await ensureBackendForwarding(
      tempDir,
      "vanilla",
      "1.21.4",
      "modern",
      "s3cr3t",
    );

    assert.deepEqual(warnings, [
      "vanilla backend does not support IP forwarding; player identity will not be forwarded",
    ]);
    assert.deepEqual(await collectYamlFiles(tempDir), []);

    const serverProperties = await readFile(
      path.join(tempDir, "server.properties"),
      "utf8",
    );
    assert.match(serverProperties, /online-mode=false/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
