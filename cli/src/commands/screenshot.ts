import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createScreenshotCommand() {
  return new Command("screenshot")
    .description("Take a screenshot")
    .requiredOption("--output <path>", "Output file path (e.g. ./screenshots/test.png)")
    .option("--region <region>", "Capture a sub-region, format: x,y,w,h")
    .option("--gui", "Capture the current GUI screen")
    .action(
      createRequestAction("capture.screenshot", ({ options }) => ({
        output: options.output,
        region: options.region,
        gui: Boolean(options.gui)
      }))
    );
}
