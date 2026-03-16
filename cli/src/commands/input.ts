import { Command } from "commander";

import { createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

function buildPointerParams(options: { button?: string; modifiers?: string }) {
  const modifiers = options.modifiers
    ? String(options.modifiers)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  return {
    button: options.button ?? "left",
    modifiers
  };
}

export function createInputCommand() {
  const command = new Command("input").description("原始鼠标/键盘输入");

  command
    .command("click")
    .description("点击指定屏幕坐标")
    .argument("<x>", "X 坐标", Number)
    .argument("<y>", "Y 坐标", Number)
    .option("--button <button>", "按键类型", "left")
    .option("--modifiers <modifiers>", "组合修饰键，逗号分隔")
    .action(
      createRequestAction("input.click", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        ...buildPointerParams(options)
      }))
    );

  command
    .command("double-click")
    .description("双击指定屏幕坐标")
    .argument("<x>", "X 坐标", Number)
    .argument("<y>", "Y 坐标", Number)
    .option("--button <button>", "按键类型", "left")
    .action(
      createRequestAction("input.double-click", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        button: options.button ?? "left"
      }))
    );

  command
    .command("mouse-move")
    .description("移动鼠标到指定坐标")
    .argument("<x>", "X 坐标", Number)
    .argument("<y>", "Y 坐标", Number)
    .action(
      createRequestAction("input.mouse-move", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1])
      }))
    );

  command
    .command("drag")
    .description("按住鼠标并拖拽")
    .argument("<fromX>", "起始 X", Number)
    .argument("<fromY>", "起始 Y", Number)
    .argument("<toX>", "目标 X", Number)
    .argument("<toY>", "目标 Y", Number)
    .option("--button <button>", "按键类型", "left")
    .action(
      createRequestAction("input.drag", ({ args, options }) => ({
        fromX: Number(args[0]),
        fromY: Number(args[1]),
        toX: Number(args[2]),
        toY: Number(args[3]),
        button: options.button ?? "left"
      }))
    );

  command
    .command("scroll")
    .description("在指定坐标滚动滚轮")
    .argument("<x>", "X 坐标", Number)
    .argument("<y>", "Y 坐标", Number)
    .requiredOption("--delta <delta>", "滚动增量", Number)
    .action(
      createRequestAction("input.scroll", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        delta: Number(options.delta)
      }))
    );

  const keyCommand = command.command("key").description("键盘输入");

  keyCommand
    .command("press")
    .description("按下并立即释放一个键")
    .argument("<key>", "按键名")
    .action(createRequestAction("input.key-press", ({ args }) => ({ key: String(args[0]) })));

  keyCommand
    .command("hold")
    .description("长按指定时长")
    .argument("<key>", "按键名")
    .requiredOption("--duration <duration>", "持续时间（毫秒）", Number)
    .action(
      createRequestAction(
        "input.key-hold",
        ({ args, options }) => ({
          key: String(args[0]),
          duration: Number(options.duration)
        }),
        ({ options }, context) =>
          withTransportTimeoutBuffer(Math.max(Number(options.duration ?? 0) / 1000 + 2, 3), context.config.timeout.default)
      )
    );

  keyCommand
    .command("down")
    .description("按下但不释放")
    .argument("<key>", "按键名")
    .action(createRequestAction("input.key-down", ({ args }) => ({ key: String(args[0]) })));

  keyCommand
    .command("up")
    .description("释放按键")
    .argument("<key>", "按键名")
    .action(createRequestAction("input.key-up", ({ args }) => ({ key: String(args[0]) })));

  keyCommand
    .command("combo")
    .description("按顺序按下一组组合键")
    .argument("<keys...>", "按键列表")
    .action(
      createRequestAction("input.key-combo", ({ args }) => ({
        keys: String(args[0])
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      }))
    );

  command
    .command("type")
    .description("向当前焦点输入文本")
    .argument("<text>", "文本内容")
    .action(createRequestAction("input.type", ({ args }) => ({ text: String(args[0]) })));

  command
    .command("mouse-pos")
    .description("获取当前鼠标位置")
    .action(createRequestAction("input.mouse-pos", () => ({})));

  command
    .command("keys-down")
    .description("获取当前按住的键")
    .action(createRequestAction("input.keys-down", () => ({})));

  return command;
}
