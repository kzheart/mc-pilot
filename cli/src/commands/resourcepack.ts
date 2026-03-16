import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createResourcepackCommand() {
  const command = new Command("resourcepack").description("资源包操作");

  command.command("status").description("获取资源包状态").action(createRequestAction("resourcepack.status", () => ({})));
  command.command("accept").description("接受资源包").action(createRequestAction("resourcepack.accept", () => ({})));
  command.command("reject").description("拒绝资源包").action(createRequestAction("resourcepack.reject", () => ({})));

  return command;
}
