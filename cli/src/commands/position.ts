import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createPositionCommand() {
  const command = new Command("position").description("位置查询");

  command.command("get").description("获取当前位置").action(createRequestAction("position.get", () => ({})));

  return command;
}
