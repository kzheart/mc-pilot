import { Command } from "commander";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { MctError } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";

function requireProject(context: { projectId: string | null }): string {
  if (!context.projectId) {
    throw new MctError(
      { code: "NO_PROJECT", message: "No project context. Run inside an mct project or use --project <id>." },
      4
    );
  }
  return context.projectId;
}

export function createWaitLogCommand() {
  return new Command("wait-log")
    .description("Wait for a server log line matching a regex")
    .option("--server <name>", "Server instance name (default: from active profile)")
    .requiredOption("--grep <pattern>", "Regex to match")
    .option("--timeout <seconds>", "Timeout in seconds (default 30)", Number)
    .option("--first-match", "Exit after the first matching line", true)
    .action(
      wrapCommand(async (context, { options }: { options: { server?: string; grep: string; timeout?: number; firstMatch?: boolean } }) => {
        const project = requireProject(context);
        const serverName = options.server ?? context.activeProfile?.server;
        if (!serverName) {
          throw new MctError({ code: "INVALID_PARAMS", message: "Server name is required" }, 4);
        }
        const manager = new ServerInstanceManager(context.globalState, project);
        return manager.followLogs(serverName, {
          grep: options.grep,
          timeoutSeconds: options.timeout ?? context.timeout("default"),
          firstMatchOnly: options.firstMatch !== false
        });
      })
    );
}
