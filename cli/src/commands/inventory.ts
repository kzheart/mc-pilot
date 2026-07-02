import { Command } from "commander";

import {
  createRequestAction,
  withTransportTimeoutBuffer,
} from "./request-helpers.js";
import type { CommandContext } from "../util/context.js";

interface InventoryWaitOptions {
  wait?: number;
  type?: string;
  notType?: string;
}

export function createInventoryCommand() {
  const command = new Command("inventory").description(
    "Inventory and item operations",
  );

  const waitOptions = (subcommand: Command) =>
    subcommand
      .option(
        "--wait <seconds>",
        "Maximum seconds to wait for the item condition",
        Number,
      )
      .option("--type <item>", "Wait until the item type is present")
      .option("--not-type <item>", "Wait until the item type is absent");

  const waitTimeout = (
    { options }: { options: InventoryWaitOptions },
    context: CommandContext,
  ) =>
    withTransportTimeoutBuffer(
      options.wait ? Number(options.wait) : undefined,
      context.timeout("default"),
    );

  waitOptions(
    command.command("get").description("Get full inventory contents"),
  ).action(
    createRequestAction(
      "inventory.get",
      ({ options }) => ({
        wait: options.wait,
        type: options.type,
        notType: options.notType,
      }),
      waitTimeout,
    ),
  );

  waitOptions(
    command
      .command("slot")
      .description("Get a specific inventory slot")
      .argument("<slot>", "Slot index (0-8: hotbar, 9-35: main inventory)"),
  ).action(
    createRequestAction(
      "inventory.slot",
      ({ args, options }) => ({
        slot: Number(args[0]),
        wait: options.wait,
        type: options.type,
        notType: options.notType,
      }),
      waitTimeout,
    ),
  );

  waitOptions(
    command.command("held").description("Get currently held item"),
  ).action(
    createRequestAction(
      "inventory.held",
      ({ options }) => ({
        wait: options.wait,
        type: options.type,
        notType: options.notType,
      }),
      waitTimeout,
    ),
  );

  command
    .command("hotbar")
    .description("Switch active hotbar slot")
    .argument("<slot>", "Hotbar slot (0-8)")
    .action(
      createRequestAction("inventory.hotbar", ({ args }) => ({
        slot: Number(args[0]),
      })),
    );

  command
    .command("drop")
    .description("Drop the held item")
    .option("--all", "Drop the entire stack")
    .action(
      createRequestAction("inventory.drop", ({ options }) => ({
        all: Boolean(options.all),
      })),
    );

  command
    .command("use")
    .description("Use (right-click) the held item")
    .action(createRequestAction("inventory.use", () => ({})));

  command
    .command("swap-hands")
    .description("Swap main hand and off-hand items")
    .action(createRequestAction("inventory.swap-hands", () => ({})));

  return command;
}
