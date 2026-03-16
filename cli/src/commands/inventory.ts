import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createInventoryCommand() {
  const command = new Command("inventory").description("背包与物品操作");

  command.command("get").description("获取完整背包").action(createRequestAction("inventory.get", () => ({})));

  command
    .command("slot")
    .description("获取指定槽位")
    .argument("<slot>", "槽位编号")
    .action(createRequestAction("inventory.slot", ({ args }) => ({ slot: Number(args[0]) })));

  command.command("held").description("获取当前手持物品").action(createRequestAction("inventory.held", () => ({})));

  command
    .command("hotbar")
    .description("切换快捷栏")
    .argument("<slot>", "快捷栏槽位")
    .action(createRequestAction("inventory.hotbar", ({ args }) => ({ slot: Number(args[0]) })));

  command
    .command("drop")
    .description("丢弃手持物品")
    .option("--all", "丢弃整组")
    .action(createRequestAction("inventory.drop", ({ options }) => ({ all: Boolean(options.all) })));

  command.command("use").description("使用手持物品").action(createRequestAction("inventory.use", () => ({})));

  command
    .command("swap-hands")
    .description("交换主副手")
    .action(createRequestAction("inventory.swap-hands", () => ({})));

  return command;
}
