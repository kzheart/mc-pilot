import { Command } from "commander";
import path from "node:path";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { ERROR_MESSAGES, MctError, noProject } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import {
  createDefaultProjectFile,
  loadProjectFileForCwd,
  resolveProjectFilePath,
  resolveBackendNames,
  resolveProfile,
  writeProjectFile,
} from "../util/project.js";

export function createInitCommand() {
  return new Command("init")
    .description("Initialize a new MC Pilot project for the current directory")
    .option("--name <name>", "Project name (default: directory name)")
    .action(
      wrapCommand(
        async (context, { options }: { options: { name?: string } }) => {
          const existing = await loadProjectFileForCwd(context.cwd);
          if (existing) {
            throw new MctError(
              {
                code: "PROJECT_EXISTS",
                message: `Project config already exists for this directory: ${existing.filePath}`,
              },
              4,
            );
          }

          const projectName = options.name ?? path.basename(context.cwd);
          const project = createDefaultProjectFile(context.cwd, projectName);
          await writeProjectFile(project.projectId, project);

          return {
            created: true,
            projectId: project.projectId,
            project: projectName,
            rootDir: project.rootDir,
            file: resolveProjectFilePath(project.projectId),
            configPath: resolveProjectFilePath(project.projectId),
          };
        },
      ),
    );
}

export function createDeployCommand() {
  return new Command("deploy")
    .description("Deploy plugin JARs to the server instance")
    .option("--profile <name>", "Profile name")
    .action(
      wrapCommand(
        async (context, { options }: { options: { profile?: string } }) => {
          const { projectFile, projectId, projectRootDir } = context;
          if (!projectFile || !projectId || !projectRootDir) {
            throw noProject();
          }

          const profile = resolveProfile(
            projectFile,
            options.profile ?? projectFile.defaultProfile,
          );
          if (!profile) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message: ERROR_MESSAGES.NO_PROFILE_SELECTED,
              },
              4,
            );
          }

          const backendName = resolveBackendNames(profile)[0];
          if (!backendName) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message:
                  "Profile has no backend server configured (set 'server' or 'servers')",
              },
              4,
            );
          }

          if (!profile.deployPlugins || profile.deployPlugins.length === 0) {
            return {
              deployed: [],
              message: "No deployPlugins configured in profile",
            };
          }

          const manager = new ServerInstanceManager(
            context.globalState,
            projectId,
          );
          const deployed = await manager.deploy(
            backendName,
            profile.deployPlugins,
            projectRootDir,
          );

          return { deployed, server: backendName };
        },
      ),
    );
}

export function createUpCommand() {
  return new Command("up")
    .description("Deploy plugins, start server and clients, wait for ready")
    .option("--profile <name>", "Profile name")
    .option("--eula", "Auto-accept EULA")
    .option(
      "--server-only-ok",
      "Only deploy/start/wait for the server; skip launching and waiting for clients",
    )
    .option(
      "--skip-client-ready",
      "Launch/reconnect clients but do not wait for them to join a world",
    )
    .action(
      wrapCommand(
        async (
          context,
          {
            options,
          }: {
            options: {
              profile?: string;
              eula?: boolean;
              serverOnlyOk?: boolean;
              skipClientReady?: boolean;
            };
          },
        ) => {
          const { projectFile, projectId, projectRootDir } = context;
          if (!projectFile || !projectId || !projectRootDir) {
            throw noProject();
          }

          const profile = resolveProfile(
            projectFile,
            options.profile ?? projectFile.defaultProfile,
          );
          if (!profile) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message: ERROR_MESSAGES.NO_PROFILE_SELECTED,
              },
              4,
            );
          }

          const serverManager = new ServerInstanceManager(
            context.globalState,
            projectId,
          );
          const clientManager = new ClientInstanceManager(context.globalState);
          const results: Record<string, unknown> = {};

          const backendName = resolveBackendNames(profile)[0];
          if (!backendName) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message:
                  "Profile has no backend server configured (set 'server' or 'servers')",
              },
              4,
            );
          }

          // 1. Deploy plugins
          if (profile.deployPlugins && profile.deployPlugins.length > 0) {
            results.deployed = await serverManager.deploy(
              backendName,
              profile.deployPlugins,
              projectRootDir,
            );
          }

          // 2. Start server
          results.server = await serverManager.start(backendName, {
            eula: options.eula,
          });

          // 3. Wait for server
          const serverMeta = await serverManager.loadMeta(backendName);
          results.serverReady = await serverManager.waitReady(
            backendName,
            context.timeout("serverReady"),
          );

          if (options.serverOnlyOk) {
            results.ready = true;
            results.clientsSkipped = true;
            return results;
          }

          // 4. Launch clients (reuse running clients via reconnect)
          const serverAddress = `localhost:${serverMeta.port}`;
          const clientResults: unknown[] = [];
          for (const clientName of profile.clients) {
            if (await clientManager.isAlreadyRunning(clientName)) {
              const reconnected = await clientManager.reconnect(
                clientName,
                serverAddress,
              );
              clientResults.push(reconnected);
            } else {
              const result = await clientManager.launch(clientName, {
                server: serverAddress,
              });
              clientResults.push(result);
            }
          }
          results.clients = clientResults;

          // 5. Wait for clients (WS connected + in-world)
          if (options.skipClientReady) {
            results.clientReadySkipped = true;
          } else {
            const readyClients: unknown[] = [];
            for (const clientName of profile.clients) {
              readyClients.push(
                await clientManager.waitReady(
                  clientName,
                  context.timeout("clientReady"),
                ),
              );
            }
            results.clientReady = readyClients;
          }

          results.ready = true;
          return results;
        },
      ),
    );
}

export function createDownCommand() {
  return new Command("down")
    .description("Stop server and clients for the active profile")
    .option("--profile <name>", "Profile name")
    .action(
      wrapCommand(
        async (context, { options }: { options: { profile?: string } }) => {
          const { projectFile, projectId } = context;
          if (!projectFile || !projectId) {
            throw noProject();
          }

          const profile = resolveProfile(
            projectFile,
            options.profile ?? projectFile.defaultProfile,
          );
          if (!profile) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message: ERROR_MESSAGES.NO_PROFILE_SELECTED,
              },
              4,
            );
          }

          const serverManager = new ServerInstanceManager(
            context.globalState,
            projectId,
          );
          const clientManager = new ClientInstanceManager(context.globalState);
          const results: Record<string, unknown> = {};

          // Stop clients first
          const clientResults: Array<{
            stopped: boolean;
            alreadyStopped?: boolean;
            name: string;
            pid?: number;
          }> = [];
          for (const clientName of profile.clients) {
            const result = await clientManager.stop(clientName);
            clientResults.push(result);
          }
          results.clients = clientResults;

          // Stop server
          const backendName = resolveBackendNames(profile)[0];
          if (!backendName) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message:
                  "Profile has no backend server configured (set 'server' or 'servers')",
              },
              4,
            );
          }
          const serverResult = await serverManager.stop(backendName);
          results.server = serverResult;

          const everythingAccountedFor =
            clientResults.every((r) => r.stopped || r.alreadyStopped) &&
            (serverResult.stopped ||
              (serverResult as { alreadyStopped?: boolean }).alreadyStopped);
          results.allClean = Boolean(everythingAccountedFor);

          return results;
        },
      ),
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
          throw noProject();
        }

        const profileName = args[0]!;
        if (!projectFile.profiles[profileName]) {
          const available = Object.keys(projectFile.profiles);
          throw new MctError(
            {
              code: "PROFILE_NOT_FOUND",
              message: `Profile '${profileName}' not found`,
              details: { available },
            },
            4,
          );
        }

        projectFile.defaultProfile = profileName;
        await writeProjectFile(projectFile.projectId, projectFile);

        return {
          defaultProfile: profileName,
          profile: projectFile.profiles[profileName],
        };
      }),
    );
}
