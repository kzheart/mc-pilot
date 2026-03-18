import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createSignCommand() {
  const command = new Command("sign").description("Sign block operations (reads/writes directly, no GUI interaction needed)");

  command
    .command("read")
    .description("Read sign text")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .action(
      createRequestAction("sign.read", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("edit")
    .description("Edit sign text")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .requiredOption("--lines <lines...>", "Four lines of text, e.g. --lines \"Line 1\" \"Line 2\" \"Line 3\" \"Line 4\"")
    .action(
      createRequestAction("sign.edit", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2]),
        lines: options.lines
      }))
    );

  return command;
}
