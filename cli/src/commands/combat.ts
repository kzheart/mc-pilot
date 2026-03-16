import { Command } from "commander";

import { buildEntityFilter, createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createCombatCommand() {
  const command = new Command("combat").description("战斗组合操作");

  for (const actionName of ["kill", "engage", "chase"] as const) {
    command
      .command(actionName)
      .description(`${actionName} 目标实体`)
      .option("--type <type>", "实体类型")
      .option("--name <name>", "实体名称")
      .option("--nearest", "使用最近实体")
      .option("--id <id>", "实体 ID", Number)
      .option("--max-distance <distance>", "最大距离", Number)
      .option("--timeout <seconds>", "超时秒数", Number)
      .action(
        createRequestAction(
          `combat.${actionName}`,
          ({ options }) => ({
            filter: buildEntityFilter(options),
            timeout: options.timeout
          }),
          ({ options }, context) =>
            withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : 30, context.config.timeout.default)
        )
      );
  }

  command
    .command("clear")
    .description("清理范围内指定类型实体")
    .requiredOption("--type <type>", "实体类型")
    .option("--radius <radius>", "范围半径", Number)
    .option("--timeout <seconds>", "超时秒数", Number)
    .action(
      createRequestAction(
        "combat.clear",
        ({ options }) => ({
          type: options.type,
          radius: options.radius ?? 16,
          timeout: options.timeout
        }),
        ({ options }, context) =>
          withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : 60, context.config.timeout.default)
      )
    );

  command
    .command("pickup")
    .description("拾取范围内掉落物")
    .option("--radius <radius>", "拾取半径", Number)
    .option("--timeout <seconds>", "超时秒数", Number)
    .action(
      createRequestAction(
        "combat.pickup",
        ({ options }) => ({
          radius: options.radius ?? 5,
          timeout: options.timeout
        }),
        ({ options }, context) =>
          withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : 10, context.config.timeout.default)
      )
    );

  return command;
}
