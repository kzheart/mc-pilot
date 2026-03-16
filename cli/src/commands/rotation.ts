import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createRotationCommand() {
  const command = new Command("rotation").description("朝向查询");

  command.command("get").description("获取当前朝向").action(createRequestAction("rotation.get", () => ({})));

  return command;
}
