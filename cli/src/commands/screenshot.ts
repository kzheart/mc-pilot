import { Command } from "commander";

import { wrapCommand } from "../util/command.js";
import { resolveScreenshotOutputPath, sendClientRequest } from "./request-helpers.js";

export function createScreenshotCommand() {
  return new Command("screenshot")
    .description("Take a screenshot")
    .option("--output <path>", "Output file path (default: project screenshot directory)")
    .option("--region <region>", "Capture a sub-region, format: x,y,w,h")
    .option("--gui", "Capture the current GUI screen")
    .action(
      wrapCommand(async (context, { options, globalOptions }: { options: { output?: string; region?: string; gui?: boolean }; globalOptions: { client?: string } }) => {
        return sendClientRequest(context, globalOptions.client ?? context.activeProfile?.clients[0], "capture.screenshot", {
          output: resolveScreenshotOutputPath(context, options.output, "screenshot"),
          region: options.region,
          gui: Boolean(options.gui)
        });
      })
    );
}
