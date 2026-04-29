import { Command } from "commander";

import { wrapCommand } from "../util/command.js";
import {
  createRequestAction,
  parseNumberList,
  resolveScreenshotOutputPath,
  sendClientRequest,
  withTransportTimeoutBuffer
} from "./request-helpers.js";

export function createGuiCommand() {
  const command = new Command("gui").description("GUI / container interaction (use \"gui snapshot\" to inspect slot indices and contents)");

  command.command("info").description("Get current GUI info (title, type, slot count)").action(createRequestAction("gui.info", () => ({})));
  command.command("layout").description("Get precise GUI bounds and slot screen coordinates").action(createRequestAction("gui.layout", () => ({})));
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
    .option("--output <path>", "Output file path (default: project screenshot directory)")
    .option("--timeout <seconds>", "Screenshot response timeout in seconds (default 30)", Number)
    .action(
      wrapCommand(async (context, { options, globalOptions }: { options: { output?: string; timeout?: number }; globalOptions: { client?: string } }) => {
        return sendClientRequest(
          context,
          globalOptions.client ?? context.activeProfile?.clients[0],
          "gui.screenshot",
          { output: resolveScreenshotOutputPath(context, options.output, "gui") },
          options.timeout ?? Math.max(30, context.timeout("default"))
        );
      })
    );

  command
    .command("click-title")
    .description("Click a GUI slot by title text match")
    .argument("<title>", "Regex matched against item displayName or type")
    .option("--button <button>", "Click button: left|right|middle|shift-left|shift-right", "left")
    .action(
      wrapCommand(async (context, { args, options, globalOptions }: { args: (string | undefined)[]; options: { button?: string }; globalOptions: { client?: string } }) => {
        const clientName = globalOptions.client ?? context.activeProfile?.clients[0];
        const snapshot = await sendClientRequest(context, clientName, "gui.snapshot", {});
        const slots = (((snapshot as { data?: { data?: { slots?: unknown[] } } }).data?.data?.slots)
          ?? ((snapshot as { data?: { slots?: unknown[] } }).data?.slots)
          ?? []) as Array<{ slot?: number; item?: { type?: string; displayName?: string } }>;
        const pattern = new RegExp(String(args[0]));
        const found = slots.find((slot) => slot.item && (pattern.test(String(slot.item.displayName ?? "")) || pattern.test(String(slot.item.type ?? ""))));
        if (!found || found.slot === undefined) {
          return { clicked: false, matched: false, title: args[0], slots: slots.length };
        }
        return sendClientRequest(context, clientName, "gui.click", { slot: found.slot, button: options.button ?? "left" });
      })
    );

  return command;
}
