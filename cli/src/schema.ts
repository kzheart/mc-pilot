import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Argument, Command, Option } from "commander";

interface ProtocolEnvelope<T> {
  schemaVersion: number;
  [key: string]: T | number;
}

interface ProtocolEntry {
  name?: string;
  code?: string;
  description?: string;
  params?: string[];
  exitCode?: number;
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function loadJsonFile<T>(relativePath: string): T {
  const filePath = path.join(resolveRepoRoot(), relativePath);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function serializeOption(option: Option) {
  return {
    name: option.name(),
    flags: option.flags,
    description: option.description,
    required: option.required,
    mandatory: option.mandatory,
    defaultValue: option.defaultValue
  };
}

function serializeArgument(argument: Argument) {
  return {
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic
  };
}

function serializeCommand(command: Command, parents: string[] = []): {
  name: string;
  path: string;
  description: string;
  aliases: string[];
  arguments: ReturnType<typeof serializeArgument>[];
  options: ReturnType<typeof serializeOption>[];
  subcommands: ReturnType<typeof serializeCommand>[];
  leaf: boolean;
} {
  const pathSegments = [...parents, command.name()];

  return {
    name: command.name(),
    path: pathSegments.join(" "),
    description: command.description(),
    aliases: command.aliases(),
    arguments: command.registeredArguments.map(serializeArgument),
    options: command.options.map(serializeOption),
    subcommands: command.commands.map((subcommand) => serializeCommand(subcommand, pathSegments)),
    leaf: command.commands.length === 0
  };
}

function collectLeafCommands(commands: Array<ReturnType<typeof serializeCommand>>): string[] {
  const leaves: string[] = [];

  const visit = (command: ReturnType<typeof serializeCommand>) => {
    if (command.leaf) {
      leaves.push(command.path);
      return;
    }

    for (const subcommand of command.subcommands) {
      visit(subcommand);
    }
  };

  for (const command of commands) {
    visit(command);
  }

  return leaves;
}

export function buildSchemaDocument(program: Command) {
  const actions = loadJsonFile<ProtocolEnvelope<ProtocolEntry[]>>("protocol/actions.json");
  const queries = loadJsonFile<ProtocolEnvelope<ProtocolEntry[]>>("protocol/queries.json");
  const errors = loadJsonFile<ProtocolEnvelope<ProtocolEntry[]>>("protocol/errors.json");
  const commands = program.commands.map((command) => serializeCommand(command));

  return {
    schemaVersion: 1,
    cli: {
      name: program.name(),
      description: program.description(),
      globalOptions: program.options.map(serializeOption),
      commands,
      leafCommands: collectLeafCommands(commands)
    },
    protocol: {
      actions: actions.actions ?? [],
      queries: queries.queries ?? [],
      errors: errors.errors ?? []
    }
  };
}
