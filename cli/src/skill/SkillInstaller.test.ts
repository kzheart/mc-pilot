import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getSkillStatus,
  installSkills,
  parseSkillTargets,
  syncConfiguredSkills,
} from "./SkillInstaller.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-skill-test-"));
  const sourceDir = path.join(root, "source");
  const homeDir = path.join(root, "home");
  const mctHome = path.join(root, "mct-home");
  await mkdir(path.join(sourceDir, "references"), { recursive: true });
  await writeFile(path.join(sourceDir, "SKILL.md"), "version one\n", "utf8");
  await writeFile(
    path.join(sourceDir, "references", "commands.md"),
    "commands one\n",
    "utf8",
  );
  return { root, sourceDir, homeDir, mctHome };
}

test("parseSkillTargets supports named, all, and none selections", () => {
  assert.deepEqual(parseSkillTargets("codex,claude,codex"), [
    "codex",
    "claude",
  ]);
  assert.equal(parseSkillTargets("all").length, 8);
  assert.deepEqual(parseSkillTargets("none"), []);
  assert.throws(() => parseSkillTargets("unknown"), /未知 Skill 目标/);
});

test("installSkills persists choices and updates managed copies", async () => {
  const context = await fixture();
  try {
    const options = {
      homeDir: context.homeDir,
      mctHome: context.mctHome,
      sourceDir: context.sourceDir,
      packageVersion: "1.0.0",
    };
    const first = await installSkills(["codex", "claude"], options);
    assert.equal(
      first.results.every((result) => result.installed),
      true,
    );
    assert.equal(
      await readFile(
        path.join(context.homeDir, ".codex", "skills", "mc-pilot", "SKILL.md"),
        "utf8",
      ),
      "version one\n",
    );

    await writeFile(path.join(context.sourceDir, "SKILL.md"), "version two\n");
    const synced = await syncConfiguredSkills({
      ...options,
      packageVersion: "1.1.0",
    });
    assert.equal(synced.synced, true);
    assert.equal(
      await readFile(
        path.join(context.homeDir, ".claude", "skills", "mc-pilot", "SKILL.md"),
        "utf8",
      ),
      "version two\n",
    );

    const unchanged = await syncConfiguredSkills(options);
    assert.equal(unchanged.synced, false);
    assert.equal(unchanged.upToDate, true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("installSkills preserves an existing non-managed Skill", async () => {
  const context = await fixture();
  try {
    const target = path.join(context.homeDir, ".cursor", "skills", "mc-pilot");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "SKILL.md"), "user content\n");

    const result = await installSkills(["cursor"], {
      homeDir: context.homeDir,
      mctHome: context.mctHome,
      sourceDir: context.sourceDir,
      packageVersion: "1.0.0",
    });
    assert.equal(result.results[0]?.conflict, true);
    assert.equal(
      await readFile(path.join(target, "SKILL.md"), "utf8"),
      "user content\n",
    );

    const status = await getSkillStatus({
      homeDir: context.homeDir,
      mctHome: context.mctHome,
      sourceDir: context.sourceDir,
    });
    assert.equal(status.configured, true);
    assert.equal(
      status.targets.find((entry) => entry.target === "cursor")?.managed,
      false,
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
