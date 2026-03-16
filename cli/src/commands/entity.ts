import { Command } from "commander";

import { buildEntityFilter, createRequestAction } from "./request-helpers.js";

export function createEntityCommand() {
  const command = new Command("entity").description("实体交互");

  for (const actionName of ["attack", "interact", "mount"] as const) {
    command
      .command(actionName)
      .description(`${actionName} 实体`)
      .option("--type <type>", "实体类型")
      .option("--name <name>", "实体名称")
      .option("--nearest", "使用最近实体")
      .option("--id <id>", "实体 ID", Number)
      .option("--max-distance <distance>", "最大距离", Number)
      .action(
        createRequestAction(`entity.${actionName}`, ({ options }) => ({
          filter: buildEntityFilter(options)
        }))
      );
  }

  command
    .command("list")
    .description("列出周围实体")
    .option("--radius <radius>", "查询半径", Number)
    .action(createRequestAction("entity.list", ({ options }) => ({ radius: options.radius ?? 10 })));

  command
    .command("info")
    .description("查询实体详情")
    .requiredOption("--id <id>", "实体 ID", Number)
    .action(createRequestAction("entity.info", ({ options }) => ({ id: options.id })));

  command
    .command("dismount")
    .description("下坐骑")
    .action(createRequestAction("entity.dismount", () => ({})));

  command
    .command("steer")
    .description("控制载具方向")
    .option("--forward", "向前")
    .option("--back", "向后")
    .option("--left", "向左")
    .option("--right", "向右")
    .option("--jump", "跳跃")
    .option("--sneak", "潜行")
    .action(
      createRequestAction("entity.steer", ({ options }) => ({
        forward: options.forward ? 1 : options.back ? -1 : 0,
        sideways: options.left ? 1 : options.right ? -1 : 0,
        jump: Boolean(options.jump),
        sneak: Boolean(options.sneak)
      }))
    );

  return command;
}
