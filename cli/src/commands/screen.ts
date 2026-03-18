import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createScreenCommand() {
  const command = new Command("screen").description("Screen info");

  command.command("size").description("Get screen dimensions (width, height)").action(createRequestAction("screen.size", () => ({})));

  return command;
}
