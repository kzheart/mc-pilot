import { Command } from "commander";

import { createRequestAction, parseNumberList } from "./request-helpers.js";

export function createGuiCommand() {
  const command = new Command("gui").description("GUI 与容器交互");

  command.command("info").description("获取 GUI 信息").action(createRequestAction("gui.info", () => ({})));
  command.command("snapshot").description("获取 GUI 快照").action(createRequestAction("gui.snapshot", () => ({})));

  command
    .command("slot")
    .description("获取 GUI 槽位")
    .argument("<slot>")
    .action(createRequestAction("gui.slot", ({ args }) => ({ slot: Number(args[0]) })));

  command
    .command("click")
    .description("点击 GUI 槽位")
    .argument("<slot>")
    .option("--button <button>", "点击按钮", "left")
    .option("--key <key>", "数字键")
    .action(
      createRequestAction("gui.click", ({ args, options }) => ({
        slot: Number(args[0]),
        button: options.button,
        key: options.key ? Number(options.key) : undefined
      }))
    );

  command
    .command("drag")
    .description("拖拽 GUI 槽位")
    .requiredOption("--slots <slots>", "槽位列表，逗号分隔")
    .requiredOption("--button <button>", "拖拽按钮")
    .action(
      createRequestAction("gui.drag", ({ options }) => ({
        slots: parseNumberList(String(options.slots)),
        button: options.button
      }))
    );

  command.command("close").description("关闭 GUI").action(createRequestAction("gui.close", () => ({})));

  command
    .command("wait-open")
    .description("等待 GUI 打开")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      createRequestAction(
        "gui.wait-open",
        ({ options }) => ({ timeout: options.timeout }),
        ({ options }) => (options.timeout ? Number(options.timeout) : undefined)
      )
    );

  command
    .command("wait-update")
    .description("等待 GUI 更新")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      createRequestAction(
        "gui.wait-update",
        ({ options }) => ({ timeout: options.timeout }),
        ({ options }) => (options.timeout ? Number(options.timeout) : undefined)
      )
    );

  command
    .command("screenshot")
    .description("截取 GUI 图片")
    .requiredOption("--output <path>", "输出路径")
    .action(createRequestAction("gui.screenshot", ({ options }) => ({ output: options.output })));

  return command;
}
