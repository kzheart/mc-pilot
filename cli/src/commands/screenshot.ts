import { Command } from "commander";

import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { wrapCommand } from "../util/command.js";
import type { CommandContext } from "../util/context.js";
import { MctError } from "../util/errors.js";
import { resolveScreenshotOutputPath, sendClientRequest } from "./request-helpers.js";

async function captureWithRetry(
  context: CommandContext,
  clientName: string | undefined,
  params: Record<string, unknown>,
  options: { timeout?: number; retries?: number }
) {
  const timeout = options.timeout ?? Math.max(30, context.timeout("default"));
  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await sendClientRequest(context, clientName, "capture.screenshot", params, timeout);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  const manager = new ClientInstanceManager(context.globalState);
  const diagnostics = await manager.getClient(clientName).catch((error) => ({ unavailable: String((error as Error).message) }));
  throw new MctError(
    {
      code: "TIMEOUT",
      message: `Screenshot request failed after ${retries + 1} attempt(s) with ${timeout}s timeout`,
      details: {
        client: clientName ?? context.activeProfile?.clients[0] ?? null,
        timeout,
        retries,
        lastError: lastError instanceof Error ? lastError.message : String(lastError),
        diagnostics
      }
    },
    2
  );
}

export function createScreenshotCommand() {
  return new Command("screenshot")
    .description("Take a screenshot")
    .option("--output <path>", "Output file path (default: project screenshot directory)")
    .option("--region <region>", "Capture a sub-region, format: x,y,w,h")
    .option("--gui", "Capture the current GUI screen")
    .option("--timeout <seconds>", "Screenshot response timeout in seconds (default 30)", Number)
    .option("--retries <count>", "Retry count after timeout/failure (default 1)", Number)
    .action(
      wrapCommand(async (context, { options, globalOptions }: { options: { output?: string; region?: string; gui?: boolean; timeout?: number; retries?: number }; globalOptions: { client?: string } }) => {
        return captureWithRetry(context, globalOptions.client ?? context.activeProfile?.clients[0], {
          output: resolveScreenshotOutputPath(context, options.output, "screenshot"),
          region: options.region,
          gui: Boolean(options.gui)
        }, {
          timeout: options.timeout,
          retries: options.retries
        });
      })
    );
}
