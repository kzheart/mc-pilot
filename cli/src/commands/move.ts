import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createMoveCommand() {
  const command = new Command("move").description("移动控制");

  command
    .command("to")
    .description("移动到指定坐标")
    .argument("<x>", "X 坐标")
    .argument("<y>", "Y 坐标")
    .argument("<z>", "Z 坐标")
    .action(
      createRequestAction("move.to", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  for (const direction of ["forward", "back", "left", "right"] as const) {
    command
      .command(direction)
      .description(`向 ${direction} 方向移动`)
      .argument("<blocks>", "移动格数")
      .action(
        createRequestAction("move.direction", ({ args }) => ({
          direction,
          blocks: Number(args[0])
        }))
      );
  }

  command
    .command("jump")
    .description("跳跃")
    .action(createRequestAction("move.jump", () => ({})));

  command
    .command("sneak")
    .description("切换潜行")
    .argument("<state>", "on 或 off")
    .action(
      createRequestAction("move.sneak", ({ args }) => ({
        enabled: args[0] === "on"
      }))
    );

  command
    .command("sprint")
    .description("切换疾跑")
    .argument("<state>", "on 或 off")
    .action(
      createRequestAction("move.sprint", ({ args }) => ({
        enabled: args[0] === "on"
      }))
    );

  return command;
}
