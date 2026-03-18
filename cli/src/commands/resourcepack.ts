import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createResourcepackCommand() {
  const command = new Command("resourcepack").description("Resource pack operations");

  command.command("status").description("Get resource pack status").action(createRequestAction("resourcepack.status", () => ({})));
  command.command("accept").description("Accept the pending resource pack").action(createRequestAction("resourcepack.accept", () => ({})));
  command.command("reject").description("Reject the pending resource pack").action(createRequestAction("resourcepack.reject", () => ({})));

  return command;
}
