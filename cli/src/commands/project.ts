import { Command } from "commander";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { MctError } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import {
  loadProjectFile,
  resolveProfile,
  writeProjectFile,
  type MctProfile,
  type MctProjectFile
} from "../util/project.js";

export function createInitCommand() {
  return new Command("init")
    .description("Initialize a new MC Pilot project in the current directory")
    .option("--name <name>", "Project name (default: directory name)")
    .action(
      wrapCommand(async (context, { options }: { options: { name?: string } }) => {
        const existing = await loadProjectFile(context.cwd);
        if (existing) {
          throw new MctError(
            { code: "PROJECT_EXISTS", message: "mct.project.json already exists in this directory" },
            4
          );
        }

        const projectName = options.name ?? path.basename(context.cwd);

        const project: MctProjectFile = {
          project: projectName,
          profiles: {},
          screenshot: {
            outputDir: "./screenshots"
          },
          timeout: {
            serverReady: 120,
            clientReady: 60,
            default: 10
          }
        };

        await writeProjectFile(context.cwd, project);

        return {
          created: true,
          project: projectName,
          file: "mct.project.json"
        };
      })
    );
}

export function createDeployCommand() {
  return new Command("deploy")
    .description("Deploy plugin JARs to the server instance")
    .option("--profile <name>", "Profile name")
    .action(
      wrapCommand(async (context, { options }: { options: { profile?: string } }) => {
        const { projectFile, projectName } = context;
        if (!projectFile || !projectName) {
          throw new MctError({ code: "NO_PROJECT", message: "No project context. Run 'mct init' first." }, 4);
        }

        const profile = resolveProfile(projectFile, options.profile ?? projectFile.defaultProfile);
        if (!profile) {
          throw new MctError({ code: "NO_PROFILE", message: "No profile specified and no defaultProfile set" }, 4);
        }

        if (!profile.deployPlugins || profile.deployPlugins.length === 0) {
          return { deployed: [], message: "No deployPlugins configured in profile" };
        }

        const manager = new ServerInstanceManager(context.globalState, projectName);
        const deployed = await manager.deploy(profile.server, profile.deployPlugins, context.cwd);

        return { deployed, server: profile.server };
      })
    );
}

export function createUpCommand() {
  return new Command("up")
    .description("Deploy plugins, start server and clients, wait for ready")
    .option("--profile <name>", "Profile name")
    .option("--eula", "Auto-accept EULA")
    .action(
      wrapCommand(async (context, { options }: { options: { profile?: string; eula?: boolean } }) => {
        const { projectFile, projectName } = context;
        if (!projectFile || !projectName) {
          throw new MctError({ code: "NO_PROJECT", message: "No project context. Run 'mct init' first." }, 4);
        }

        const profile = resolveProfile(projectFile, options.profile ?? projectFile.defaultProfile);
        if (!profile) {
          throw new MctError({ code: "NO_PROFILE", message: "No profile specified and no defaultProfile set" }, 4);
        }

        const serverManager = new ServerInstanceManager(context.globalState, projectName);
        const clientManager = new ClientInstanceManager(context.globalState);
        const results: Record<string, unknown> = {};

        // 1. Deploy plugins
        if (profile.deployPlugins && profile.deployPlugins.length > 0) {
          results.deployed = await serverManager.deploy(profile.server, profile.deployPlugins, context.cwd);
        }

        // 2. Start server
        results.server = await serverManager.start(profile.server, { eula: options.eula });

        // 3. Wait for server
        const serverMeta = await serverManager.loadMeta(profile.server);
        await serverManager.waitReady(profile.server, context.timeout("serverReady"));

        // 4. Launch clients
        const clientResults: unknown[] = [];
        for (const clientName of profile.clients) {
          const result = await clientManager.launch(clientName, {
            server: `localhost:${serverMeta.port}`
          });
          clientResults.push(result);
        }
        results.clients = clientResults;

        // 5. Wait for clients
        for (const clientName of profile.clients) {
          await clientManager.waitReady(clientName, context.timeout("clientReady"));
        }

        results.ready = true;
        return results;
      })
    );
}

export function createDownCommand() {
  return new Command("down")
    .description("Stop server and clients for the active profile")
    .option("--profile <name>", "Profile name")
    .action(
      wrapCommand(async (context, { options }: { options: { profile?: string } }) => {
        const { projectFile, projectName } = context;
        if (!projectFile || !projectName) {
          throw new MctError({ code: "NO_PROJECT", message: "No project context. Run 'mct init' first." }, 4);
        }

        const profile = resolveProfile(projectFile, options.profile ?? projectFile.defaultProfile);
        if (!profile) {
          throw new MctError({ code: "NO_PROFILE", message: "No profile specified and no defaultProfile set" }, 4);
        }

        const serverManager = new ServerInstanceManager(context.globalState, projectName);
        const clientManager = new ClientInstanceManager(context.globalState);
        const results: Record<string, unknown> = {};

        // Stop clients first
        const clientResults: unknown[] = [];
        for (const clientName of profile.clients) {
          const result = await clientManager.stop(clientName);
          clientResults.push(result);
        }
        results.clients = clientResults;

        // Stop server
        results.server = await serverManager.stop(profile.server);

        return results;
      })
    );
}

export function createUseCommand() {
  return new Command("use")
    .description("Set the default profile")
    .argument("<profile>", "Profile name to set as default")
    .action(
      wrapCommand(async (context, { args }) => {
        const { projectFile } = context;
        if (!projectFile) {
          throw new MctError({ code: "NO_PROJECT", message: "No project context. Run 'mct init' first." }, 4);
        }

        const profileName = args[0];
        if (!projectFile.profiles[profileName]) {
          const available = Object.keys(projectFile.profiles);
          throw new MctError(
            {
              code: "PROFILE_NOT_FOUND",
              message: `Profile '${profileName}' not found`,
              details: { available }
            },
            4
          );
        }

        projectFile.defaultProfile = profileName;
        await writeProjectFile(context.cwd, projectFile);

        return {
          defaultProfile: profileName,
          profile: projectFile.profiles[profileName]
        };
      })
    );
}
