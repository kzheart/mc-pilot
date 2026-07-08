import { Command } from "commander";
import path from "node:path";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { syncTopology } from "../instance/TopologySync.js";
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

          const backends = resolveBackendNames(profile);
          if (backends.length === 0) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message:
                  "Profile has no backend server configured (set 'server' or 'servers')",
              },
              4,
            );
          }

          const hasDeployPlugins =
            profile.deployPlugins && profile.deployPlugins.length > 0;
          const hasProxyPlugins =
            profile.proxyPlugins && profile.proxyPlugins.length > 0;
          if (!hasDeployPlugins && !hasProxyPlugins) {
            return {
              deployed: [],
              message: "No deployPlugins configured in profile",
            };
          }

          const manager = new ServerInstanceManager(
            context.globalState,
            projectId,
          );

          const deployed: string[] = [];
          if (hasDeployPlugins) {
            for (const name of backends) {
              const paths = await manager.deploy(
                name,
                profile.deployPlugins!,
                projectRootDir,
              );
              deployed.push(...paths);
            }
          }

          let proxyDeployed: string[] | undefined;
          if (hasProxyPlugins && profile.proxy) {
            proxyDeployed = await manager.deploy(
              profile.proxy,
              profile.proxyPlugins!,
              projectRootDir,
            );
          }

          return {
            deployed,
            servers: backends,
            ...(proxyDeployed ? { proxyDeployed, proxy: profile.proxy } : {}),
          };
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

          const backends = resolveBackendNames(profile);
          if (backends.length === 0) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message:
                  "Profile has no backend server configured (set 'server' or 'servers')",
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

          // 1. Deploy plugins
          if (profile.deployPlugins && profile.deployPlugins.length > 0) {
            const deployed: string[] = [];
            for (const name of backends) {
              const paths = await serverManager.deploy(
                name,
                profile.deployPlugins,
                projectRootDir,
              );
              deployed.push(...paths);
            }
            results.deployed = deployed;
          }
          if (
            profile.proxyPlugins &&
            profile.proxyPlugins.length > 0 &&
            profile.proxy
          ) {
            results.proxyDeployed = await serverManager.deploy(
              profile.proxy,
              profile.proxyPlugins,
              projectRootDir,
            );
          }

          // 2. Sync topology
          const topology = await syncTopology(
            serverManager,
            projectId,
            backends,
            profile.proxy,
          );
          if (topology.warnings.length > 0) {
            results.topologyWarnings = topology.warnings;
          }

          // 3. Start backends
          const serverResults: unknown[] = [];
          for (const name of backends) {
            serverResults.push(
              await serverManager.start(name, { eula: options.eula }),
            );
          }
          results.servers = serverResults;
          results.server = serverResults[0];

          // 4. Wait for backends ready
          const serversReadyResults: unknown[] = [];
          for (const name of backends) {
            serversReadyResults.push(
              await serverManager.waitReady(
                name,
                context.timeout("serverReady"),
              ),
            );
          }
          results.serversReady = serversReadyResults;
          results.serverReady = serversReadyResults[0];

          // 5. Start proxy
          if (profile.proxy) {
            results.proxy = await serverManager.start(profile.proxy, {});
            results.proxyReady = await serverManager.waitReady(
              profile.proxy,
              context.timeout("serverReady"),
            );
          }

          if (options.serverOnlyOk) {
            results.ready = true;
            results.clientsSkipped = true;
            return results;
          }

          // 6. Launch clients (reuse running clients via reconnect)
          const serverAddress =
            profile.proxy && topology.proxy
              ? `localhost:${topology.proxy.port}`
              : `localhost:${(await serverManager.loadMeta(backends[0])).port}`;
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

          // 7. Wait for clients (WS connected + in-world)
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

          const backends = resolveBackendNames(profile);
          if (backends.length === 0) {
            throw new MctError(
              {
                code: "NO_PROFILE",
                message:
                  "Profile has no backend server configured (set 'server' or 'servers')",
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

          // Stop proxy
          let proxyResult:
            | { stopped: boolean; alreadyStopped?: boolean }
            | undefined;
          if (profile.proxy) {
            proxyResult = await serverManager.stop(profile.proxy);
            results.proxy = proxyResult;
          }

          // Stop backends
          const serverResults: Array<{
            stopped: boolean;
            alreadyStopped?: boolean;
          }> = [];
          for (const name of backends) {
            serverResults.push(await serverManager.stop(name));
          }
          results.servers = serverResults;
          results.server = serverResults[0];

          const isStopped = (r: {
            stopped: boolean;
            alreadyStopped?: boolean;
          }) => r.stopped || r.alreadyStopped;
          const everythingAccountedFor =
            clientResults.every(isStopped) &&
            (proxyResult === undefined || isStopped(proxyResult)) &&
            serverResults.every(isStopped);
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
