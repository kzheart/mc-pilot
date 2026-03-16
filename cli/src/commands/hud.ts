import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createHudCommand() {
  const command = new Command("hud").description("HUD 查询");

  command.command("scoreboard").description("获取计分板").action(createRequestAction("hud.scoreboard", () => ({})));
  command.command("tab").description("获取 Tab 列表").action(createRequestAction("hud.tab", () => ({})));
  command.command("bossbar").description("获取 BossBar").action(createRequestAction("hud.bossbar", () => ({})));
  command.command("actionbar").description("获取 ActionBar").action(createRequestAction("hud.actionbar", () => ({})));
  command.command("title").description("获取 Title").action(createRequestAction("hud.title", () => ({})));

  command
    .command("nametag")
    .description("获取名牌")
    .requiredOption("--player <player>", "玩家名")
    .action(createRequestAction("hud.nametag", ({ options }) => ({ player: options.player })));

  return command;
}
