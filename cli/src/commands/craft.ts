import { Command } from "commander";

import { createRequestAction, parseJson } from "./request-helpers.js";

export function createCraftCommand() {
  return new Command("craft")
    .description("工作台合成")
    .requiredOption("--recipe <json>", "合成配方 JSON")
    .action(createRequestAction("craft.craft", ({ options }) => ({ recipe: parseJson(String(options.recipe), "recipe") })));
}

export function createAnvilCommand() {
  return new Command("anvil")
    .description("铁砧操作")
    .requiredOption("--input-slot <slot>", "输入槽位", Number)
    .requiredOption("--rename <name>", "重命名内容")
    .action(
      createRequestAction("craft.anvil", ({ options }) => ({
        inputSlot: options.inputSlot,
        rename: options.rename
      }))
    );
}

export function createEnchantCommand() {
  return new Command("enchant")
    .description("附魔台操作")
    .requiredOption("--option <index>", "附魔选项", Number)
    .action(createRequestAction("craft.enchant", ({ options }) => ({ option: options.option })));
}

export function createTradeCommand() {
  return new Command("trade")
    .description("交易操作")
    .requiredOption("--index <index>", "交易选项", Number)
    .action(createRequestAction("craft.trade", ({ options }) => ({ index: options.index })));
}
