import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createScreenshotCommand() {
  return new Command("screenshot")
    .description("截图")
    .requiredOption("--output <path>", "输出路径")
    .option("--region <region>", "区域截图，格式 x,y,w,h")
    .option("--gui", "截取当前 GUI")
    .action(
      createRequestAction("capture.screenshot", ({ options }) => ({
        output: options.output,
        region: options.region,
        gui: Boolean(options.gui)
      }))
    );
}
