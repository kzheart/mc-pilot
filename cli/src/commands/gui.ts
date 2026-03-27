import { Command } from "commander";

import { createRequestAction, parseNumberList, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createGuiCommand() {
  const command = new Command("gui").description("GUI / container interaction (use \"gui snapshot\" to inspect slot indices and contents)");

  command.command("info").description("Get current GUI info (title, type, slot count)").action(createRequestAction("gui.info", () => ({})));
  command.command("snapshot").description("Get full GUI snapshot with all slot contents").action(createRequestAction("gui.snapshot", () => ({})));

  command
    .command("slot")
    .description("Get a specific GUI slot")
    .argument("<slot>", "Slot index")
    .action(createRequestAction("gui.slot", ({ args }) => ({ slot: Number(args[0]) })));

  command
    .command("click")
    .description("Click a GUI slot")
    .argument("<slot>", "Slot index")
    .option("--button <button>", "Click button: left|right|middle|shift-left|shift-right", "left")
    .option("--key <key>", "Number key 1-9 to quick-move item to that hotbar slot")
    .action(
      createRequestAction("gui.click", ({ args, options }) => ({
        slot: Number(args[0]),
        button: options.button,
        key: options.key ? Number(options.key) : undefined
      }))
    );

  command
    .command("drag")
    .description("Drag across GUI slots (distribute items)")
    .requiredOption("--slots <slots>", "Comma-separated slot indices, e.g. 1,2,3")
    .requiredOption("--button <button>", "Drag button: left (split evenly) | right (one each)")
    .action(
      createRequestAction("gui.drag", ({ options }) => ({
        slots: parseNumberList(String(options.slots)),
        button: options.button
      }))
    );

  command.command("close").description("Close the current GUI").action(createRequestAction("gui.close", () => ({})));

  command
    .command("wait-open")
    .description("Wait for a GUI to open")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      createRequestAction(
        "gui.wait-open",
        ({ options }) => ({ timeout: options.timeout }),
        ({ options }, context) => withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : undefined, context.timeout("default"))
      )
    );

  command
    .command("wait-update")
    .description("Wait for the GUI to update")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      createRequestAction(
        "gui.wait-update",
        ({ options }) => ({ timeout: options.timeout }),
        ({ options }, context) => withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : undefined, context.timeout("default"))
      )
    );

  command
    .command("screenshot")
    .description("Take a screenshot of the current GUI")
    .requiredOption("--output <path>", "Output file path")
    .action(createRequestAction("gui.screenshot", ({ options }) => ({ output: options.output })));

  return command;
}
