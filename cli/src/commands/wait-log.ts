import { Command } from "commander";

import { ServerManager } from "../instance/ServerManager.js";
import { invalidParams } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import { resolveServerArg } from "./server.js";

export function createWaitLogCommand() {
  return new Command("wait-log")
    .description(
      "Wait for a server log line matching a regex. Pass --after <cursor> (from server exec/status) to also match lines already written.",
    )
    .requiredOption("--grep <pattern>", "Regex to match")
    .option(
      "--server <name>",
      "Server name or directory (default: active profile's server)",
    )
    .option(
      "--after <cursor>",
      "Byte cursor to scan from (default: current end of the log)",
      Number,
    )
    .option("--timeout <seconds>", "Timeout in seconds (default: 30)", Number)
    .action(
      wrapCommand(
        async (
          context,
          {
            options,
          }: {
            options: {
              grep: string;
              server?: string;
              after?: number;
              timeout?: number;
            };
          },
        ) => {
          let pattern: RegExp;
          try {
            pattern = new RegExp(options.grep);
          } catch (error) {
            throw invalidParams(
              `Invalid --grep regex: ${(error as Error).message}`,
            );
          }
          if (
            options.after !== undefined &&
            (!Number.isInteger(options.after) || options.after < 0)
          ) {
            throw invalidParams(
              "--after must be a non-negative integer cursor",
            );
          }

          const target = await resolveServerArg(context, options.server);
          return new ServerManager().waitLog(target, {
            pattern,
            after: options.after,
            timeoutSeconds: options.timeout ?? 30,
          });
        },
      ),
    );
}
