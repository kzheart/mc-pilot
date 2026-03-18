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
  const command = new Command("input").description("Raw mouse/keyboard input");

  command
    .command("click")
    .description("Click at screen coordinates")
    .argument("<x>", "Screen X", Number)
    .argument("<y>", "Screen Y", Number)
    .option("--button <button>", "Mouse button: left|right|middle", "left")
    .option("--modifiers <modifiers>", "Modifier keys, comma-separated: shift,ctrl,alt")
    .action(
      createRequestAction("input.click", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        ...buildPointerParams(options)
      }))
    );

  command
    .command("double-click")
    .description("Double-click at screen coordinates")
    .argument("<x>", "Screen X", Number)
    .argument("<y>", "Screen Y", Number)
    .option("--button <button>", "Mouse button: left|right|middle", "left")
    .action(
      createRequestAction("input.double-click", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        button: options.button ?? "left"
      }))
    );

  command
    .command("mouse-move")
    .description("Move mouse to screen coordinates")
    .argument("<x>", "Screen X", Number)
    .argument("<y>", "Screen Y", Number)
    .action(
      createRequestAction("input.mouse-move", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1])
      }))
    );

  command
    .command("drag")
    .description("Mouse drag from one position to another")
    .argument("<fromX>", "Start X", Number)
    .argument("<fromY>", "Start Y", Number)
    .argument("<toX>", "End X", Number)
    .argument("<toY>", "End Y", Number)
    .option("--button <button>", "Mouse button: left|right|middle", "left")
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
    .description("Scroll mouse wheel at coordinates")
    .argument("<x>", "Screen X", Number)
    .argument("<y>", "Screen Y", Number)
    .requiredOption("--delta <delta>", "Scroll amount (positive = up, negative = down)", Number)
    .action(
      createRequestAction("input.scroll", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        delta: Number(options.delta)
      }))
    );

  const keyCommand = command.command("key").description("Keyboard input");

  keyCommand
    .command("press")
    .description("Press and release a key")
    .argument("<key>", "Key name (e.g. w, a, s, d, space, escape, shift, enter, tab, e, f1)")
    .action(createRequestAction("input.key-press", ({ args }) => ({ key: String(args[0]) })));

  keyCommand
    .command("hold")
    .description("Hold a key for a duration")
    .argument("<key>", "Key name")
    .requiredOption("--duration <ms>", "Hold duration in milliseconds", Number)
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
    .description("Press a key down (without releasing)")
    .argument("<key>", "Key name")
    .action(createRequestAction("input.key-down", ({ args }) => ({ key: String(args[0]) })));

  keyCommand
    .command("up")
    .description("Release a key")
    .argument("<key>", "Key name")
    .action(createRequestAction("input.key-up", ({ args }) => ({ key: String(args[0]) })));

  keyCommand
    .command("combo")
    .description("Press a key combination in sequence")
    .argument("<keys...>", "Key names")
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
    .description("Type text into the currently focused field")
    .argument("<text>", "Text to type")
    .action(createRequestAction("input.type", ({ args }) => ({ text: String(args[0]) })));

  command
    .command("mouse-pos")
    .description("Get current mouse position")
    .action(createRequestAction("input.mouse-pos", () => ({})));

  command
    .command("keys-down")
    .description("Get currently held keys")
    .action(createRequestAction("input.keys-down", () => ({})));

  return command;
}
