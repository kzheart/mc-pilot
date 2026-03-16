import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createStatusCommand() {
  const command = new Command("status").description("玩家状态查询");

  for (const sub of ["health", "effects", "experience", "gamemode", "world", "all"] as const) {
    command.command(sub).description(`获取 ${sub} 状态`).action(createRequestAction(`status.${sub}`, () => ({})));
  }

  return command;
}
