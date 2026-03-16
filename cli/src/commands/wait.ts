import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createWaitCommand() {
  return new Command("wait")
    .description("等待与同步")
    .argument("[seconds]", "等待秒数")
    .option("--ticks <ticks>", "等待 tick 数", Number)
    .option("--until-health-above <value>", "等待生命值高于指定值", Number)
    .option("--until-gui-open", "等待 GUI 打开")
    .option("--until-on-ground", "等待落地")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      createRequestAction(
        "wait.perform",
        ({ args, options }) => ({
          seconds: args[0] ? Number(args[0]) : undefined,
          ticks: options.ticks,
          untilHealthAbove: options.untilHealthAbove,
          untilGuiOpen: Boolean(options.untilGuiOpen),
          untilOnGround: Boolean(options.untilOnGround),
          timeout: options.timeout
        }),
        ({ options, args }, context) =>
          options.timeout ? Number(options.timeout) : args[0] ? Number(args[0]) : context.config.timeout.default
      )
    );
}
