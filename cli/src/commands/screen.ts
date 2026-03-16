import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createScreenCommand() {
  const command = new Command("screen").description("屏幕信息");

  command.command("size").description("获取屏幕尺寸").action(createRequestAction("screen.size", () => ({})));

  return command;
}
