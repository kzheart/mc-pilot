import { Command } from "commander";

import { PluginCatalogManager } from "../instance/PluginCatalogManager.js";
import { MctError } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";

function parseCommaSeparated(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createPluginCommand() {
  const plugin = new Command("plugin")
    .description("Manage the plugin center catalog");

  plugin.addCommand(
    new Command("list")
      .description("List plugins in the catalog")
      .option("--query <query>", "Search by name, id, or description")
      .action(
        wrapCommand(async (_context, { options }: { options: { query?: string } }) => {
          const manager = new PluginCatalogManager();
          const plugins = await manager.list(options.query);
          return { plugins, count: plugins.length };
        })
      )
  );

  plugin.addCommand(
    new Command("info")
      .description("Show plugin details")
      .argument("<id>", "Plugin ID")
      .action(
        wrapCommand(async (_context, { args }) => {
          const manager = new PluginCatalogManager();
          return manager.get(args[0]!);
        })
      )
  );

  plugin.addCommand(
    new Command("add")
      .description("Add a plugin JAR to the catalog (id/name auto-derived from filename)")
      .argument("<jar-path>", "Path to the plugin JAR file")
      .option("--id <id>", "Override plugin ID")
      .option("--name <name>", "Override display name")
      .action(
        wrapCommand(async (_context, { args, options }: { args: (string | undefined)[]; options: { id?: string; name?: string } }) => {
          const manager = new PluginCatalogManager();
          return manager.add(args[0]!, {
            id: options.id,
            name: options.name
          });
        })
      )
  );

  plugin.addCommand(
    new Command("update")
      .description("Update plugin metadata")
      .argument("<id>", "Plugin ID")
      .option("--name <name>", "Display name")
      .option("--version <version>", "Version")
      .option("--description <description>", "Description")
      .option("--author <author>", "Author")
      .option("--dependencies <deps>", "Dependency plugin IDs (comma-separated)")
      .option("--tags <tags>", "Tags (comma-separated)")
      .action(
        wrapCommand(async (_context, { args, options }: { args: (string | undefined)[]; options: Record<string, string | undefined> }) => {
          const manager = new PluginCatalogManager();
          return manager.update(args[0]!, {
            name: options.name,
            version: options.version,
            description: options.description,
            author: options.author,
            dependencies: parseCommaSeparated(options.dependencies),
            tags: parseCommaSeparated(options.tags)
          });
        })
      )
  );

  plugin.addCommand(
    new Command("remove")
      .description("Remove a plugin from the catalog")
      .argument("<id>", "Plugin ID")
      .action(
        wrapCommand(async (_context, { args }) => {
          const manager = new PluginCatalogManager();
          const removed = await manager.remove(args[0]!);
          return { removed: removed.id, name: removed.name };
        })
      )
  );

  plugin.addCommand(
    new Command("install")
      .description("Install a plugin (with dependencies) to a server")
      .argument("<id>", "Plugin ID")
      .requiredOption("--server <name>", "Target server instance name")
      .option("--project <name>", "Project name")
      .action(
        wrapCommand(async (context, { args, options }: { args: (string | undefined)[]; options: { server: string; project?: string } }) => {
          const project = options.project ?? context.projectName;
          if (!project) {
            throw new MctError(
              { code: "NO_PROJECT", message: "No project specified. Use --project or run from a project directory." },
              4
            );
          }
          const manager = new PluginCatalogManager();
          return manager.install(args[0]!, project, options.server);
        })
      )
  );

  plugin.addCommand(
    new Command("resolve")
      .description("Resolve dependency tree for plugins")
      .argument("<ids...>", "Plugin IDs to resolve")
      .action(
        wrapCommand(async (_context, { args }) => {
          const manager = new PluginCatalogManager();
          const resolved = await manager.resolve(args.filter((v): v is string => v !== undefined));
          return {
            order: resolved.map((p) => p.id),
            plugins: resolved
          };
        })
      )
  );

  return plugin;
}
