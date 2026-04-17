import { Command } from "commander";

import { buildSchemaDocument } from "../schema.js";
import { wrapCommand } from "../util/command.js";

export function createSchemaCommand(getProgram: () => Command) {
  return new Command("schema")
    .description("Output a machine-readable CLI and protocol schema")
    .action(
      wrapCommand(async () => {
        return buildSchemaDocument(getProgram());
      })
    );
}
