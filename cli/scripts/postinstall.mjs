#!/usr/bin/env node
import process from "node:process";
import { createInterface } from "node:readline/promises";

async function run() {
  if (
    process.env.npm_config_global !== "true" &&
    process.env.MCT_SKILL_TARGETS === undefined
  ) {
    return;
  }
  const installer = await import("../dist/skill/SkillInstaller.js");
  const configured = await installer.syncConfiguredSkills();
  if (configured.configured) {
    return;
  }

  const requestedTargets = process.env.MCT_SKILL_TARGETS;
  if (requestedTargets !== undefined) {
    await installer.installSkills(
      installer.parseSkillTargets(requestedTargets),
    );
    return;
  }

  if (process.env.npm_config_global !== "true" || !process.stdin.isTTY) {
    return;
  }

  const entries = Object.entries(installer.SKILL_TARGETS);
  process.stdout.write(
    `\n选择要安装 mc-pilot Skill 的 Coding Agent（逗号分隔，可输入 all/none）：\n${entries
      .map(
        ([id, target], index) =>
          `  ${index + 1}. ${target.label} (${id})  ~/${target.path}`,
      )
      .join("\n")}\n`,
  );
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question("> ");
    const targets = /^\d+(?:\s*,\s*\d+)*$/.test(answer.trim())
      ? installer.parseSkillTargets(
          answer
            .split(",")
            .map((value) => entries[Number(value.trim()) - 1]?.[0] ?? value)
            .join(","),
        )
      : installer.parseSkillTargets(answer);
    await installer.installSkills(targets);
  } finally {
    readline.close();
  }
}

run().catch((error) => {
  process.stderr.write(
    `[mc-pilot] Skill 安装未完成，不影响 CLI 使用：${error instanceof Error ? error.message : String(error)}\n`,
  );
});
