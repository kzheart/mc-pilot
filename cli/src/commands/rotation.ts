import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createRotationCommand() {
  const command = new Command("rotation").description("View direction query");

  command.command("get").description("Get current view direction (yaw, pitch)").action(createRequestAction("rotation.get", () => ({})));

  return command;
}
