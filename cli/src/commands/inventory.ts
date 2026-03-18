import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createInventoryCommand() {
  const command = new Command("inventory").description("Inventory and item operations");

  command.command("get").description("Get full inventory contents").action(createRequestAction("inventory.get", () => ({})));

  command
    .command("slot")
    .description("Get a specific inventory slot")
    .argument("<slot>", "Slot index (0-8: hotbar, 9-35: main inventory)")
    .action(createRequestAction("inventory.slot", ({ args }) => ({ slot: Number(args[0]) })));

  command.command("held").description("Get currently held item").action(createRequestAction("inventory.held", () => ({})));

  command
    .command("hotbar")
    .description("Switch active hotbar slot")
    .argument("<slot>", "Hotbar slot (0-8)")
    .action(createRequestAction("inventory.hotbar", ({ args }) => ({ slot: Number(args[0]) })));

  command
    .command("drop")
    .description("Drop the held item")
    .option("--all", "Drop the entire stack")
    .action(createRequestAction("inventory.drop", ({ options }) => ({ all: Boolean(options.all) })));

  command.command("use").description("Use (right-click) the held item").action(createRequestAction("inventory.use", () => ({})));

  command
    .command("swap-hands")
    .description("Swap main hand and off-hand items")
    .action(createRequestAction("inventory.swap-hands", () => ({})));

  return command;
}
