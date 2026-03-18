import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createPositionCommand() {
  const command = new Command("position").description("Position query");

  command.command("get").description("Get current player position (x, y, z)").action(createRequestAction("position.get", () => ({})));

  return command;
}
