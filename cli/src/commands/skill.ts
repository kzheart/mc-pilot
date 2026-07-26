import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";

import {
  getSkillStatus,
  installSkills,
  parseSkillTargets,
  SKILL_TARGETS,
  syncConfiguredSkills,
} from "../skill/SkillInstaller.js";
import { wrapCommand } from "../util/command.js";

async function chooseTargets() {
  const entries = Object.entries(SKILL_TARGETS);
  stdout.write(
    `选择要安装 mc-pilot Skill 的 Coding Agent（逗号分隔，可输入 all/none）：\n${entries
      .map(
        ([id, target], index) =>
          `  ${index + 1}. ${target.label} (${id})  ~/${target.path}`,
      )
      .join("\n")}\n`,
  );
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question("> ");
    if (/^\d+(?:\s*,\s*\d+)*$/.test(answer.trim())) {
      return parseSkillTargets(
        answer
          .split(",")
          .map((value) => entries[Number(value.trim()) - 1]?.[0] ?? value)
          .join(","),
      );
    }
    return parseSkillTargets(answer);
  } finally {
    readline.close();
  }
}

export function createSkillCommand() {
  const command = new Command("skill").description(
    "Install and update the bundled mc-pilot Skill for coding agents",
  );

  command
    .command("install")
    .description("Choose coding agents and install the bundled Skill")
    .option("--targets <targets>", "Comma-separated target ids, all, or none")
    .option("--all", "Install for every supported coding agent")
    .option("--force", "Replace an existing non-managed mc-pilot Skill")
    .action(
      wrapCommand(
        async (
          _context,
          {
            options,
          }: {
            options: { all?: boolean; targets?: string; force?: boolean };
          },
        ) => {
          const targets = options.all
            ? parseSkillTargets("all")
            : options.targets
              ? parseSkillTargets(options.targets)
              : await chooseTargets();
          return installSkills(targets, { force: Boolean(options.force) });
        },
      ),
    );

  command
    .command("sync")
    .description("Update all previously selected Skill installations")
    .action(wrapCommand(async () => syncConfiguredSkills()));

  command
    .command("status")
    .description("Show selected and installed Skill targets")
    .action(wrapCommand(async () => getSkillStatus()));

  return command;
}
