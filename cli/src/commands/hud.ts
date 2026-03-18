import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createHudCommand() {
  const command = new Command("hud").description("HUD element queries");

  command.command("scoreboard").description("Get sidebar scoreboard").action(createRequestAction("hud.scoreboard", () => ({})));
  command.command("tab").description("Get tab list (player list)").action(createRequestAction("hud.tab", () => ({})));
  command.command("bossbar").description("Get boss bar(s)").action(createRequestAction("hud.bossbar", () => ({})));
  command.command("actionbar").description("Get action bar text").action(createRequestAction("hud.actionbar", () => ({})));
  command.command("title").description("Get current title/subtitle").action(createRequestAction("hud.title", () => ({})));

  command
    .command("nametag")
    .description("Get a player's nametag info")
    .requiredOption("--player <player>", "Player name")
    .action(createRequestAction("hud.nametag", ({ options }) => ({ player: options.player })));

  return command;
}
