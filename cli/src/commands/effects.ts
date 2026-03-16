import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createEffectsCommand() {
  const command = new Command("effects").description("音效与粒子事件");

  command
    .command("sounds")
    .description("获取音效事件")
    .option("--last <count>", "最近条数", Number)
    .action(createRequestAction("effects.sounds", ({ options }) => ({ last: options.last ?? 10 })));

  command
    .command("particles")
    .description("获取粒子事件")
    .option("--last <count>", "最近条数", Number)
    .action(createRequestAction("effects.particles", ({ options }) => ({ last: options.last ?? 10 })));

  return command;
}
