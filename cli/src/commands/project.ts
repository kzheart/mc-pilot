import { Command } from "commander";
import path from "node:path";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { syncTopology } from "../instance/TopologySync.js";
import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { MctError, noProject } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import {
  createDefaultProjectFile,
  loadProjectFileForCwd,
  requireActiveProfile,
  resolveProjectFilePath,
  resolveBackendNames,
  writeProjectFile,
} from "../util/project.js";

/**
 * Refuse to point offline test clients at an authenticating instance.
 *
 * mct clients log in with offline accounts. A server (or, behind a proxy, the
 * proxy) running `online-mode=true` asks Mojang to verify the session and
 * rejects them with "Failed to login: Invalid session" — a failure that never
 * resolves, so waiting out the readiness window only delays the diagnosis.
 */
export function assertOfflineAuthGate(input: {
  instance: string;
  onlineMode?: boolean;
  isProxy: boolean;
  clients: string[];
}): void {
  if (!input.onlineMode) {
    return;
  }
  throw new MctError(
    {
      code: "ONLINE_MODE_CONFLICT",
      message: `Instance '${input.instance}' runs with online-mode=true, but mct test clients use offline accounts and will be rejected with "Failed to login: Invalid session". Fix it with \`mct server config ${input.instance} --online-mode false\` and restart the instance, or run with --server-only-ok to skip clients.`,
      details: {
        instance: input.instance,
        onlineMode: true,
        isProxy: input.isProxy,
        clients: input.clients,
        fix: `mct server config ${input.instance} --online-mode false`,
      },
    },
    4,
  );
}

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
    .action(
      wrapCommand(async (context, { globalOptions }) => {
        const { projectFile, projectId, projectRootDir } = context;
        if (!projectFile || !projectId || !projectRootDir) {
          throw noProject();
        }

        const profile = requireActiveProfile({
          projectFile,
          activeProfile: context.activeProfile,
          requestedProfile: globalOptions.profile,
        });

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
            profile: context.activeProfileName,
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

        // Hot-swapping a JAR under a live PluginClassLoader leaves lazily
        // loaded classes unresolvable (NoClassDefFoundError). Tell the caller
        // which instances still need a restart instead of letting the next
        // test blame the plugin.
        const restartTargets = [
          ...backends,
          ...(proxyDeployed && profile.proxy ? [profile.proxy] : []),
        ];
        const runningInstances: string[] = [];
        for (const name of restartTargets) {
          const state = (await manager.status(name)) as { running?: boolean };
          if (state?.running) {
            runningInstances.push(name);
          }
        }

        return {
          deployed,
          servers: backends,
          profile: context.activeProfileName,
          ...(proxyDeployed ? { proxyDeployed, proxy: profile.proxy } : {}),
          ...(runningInstances.length > 0
            ? {
                restartRequired: true,
                runningInstances,
                warning: `Deployed to running instance(s): ${runningInstances.join(", ")}. Restart them (\`mct down\` then \`mct up\`, or \`mct server stop/start <name>\`) before testing — the old PluginClassLoader keeps the previous JAR and lazily loaded classes will fail with NoClassDefFoundError.`,
              }
            : { restartRequired: false }),
        };
      }),
    );
}

export function createUpCommand() {
  return new Command("up")
    .description("Deploy plugins, start server and clients, wait for ready")
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
            globalOptions,
          }: {
            options: {
              eula?: boolean;
              serverOnlyOk?: boolean;
              skipClientReady?: boolean;
            };
            globalOptions: { profile?: string };
          },
        ) => {
          const { projectFile, projectId, projectRootDir } = context;
          if (!projectFile || !projectId || !projectRootDir) {
            throw noProject();
          }

          const profile = requireActiveProfile({
            projectFile,
            activeProfile: context.activeProfile,
            requestedProfile: globalOptions.profile,
          });

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
          const results: Record<string, unknown> = {
            profile: context.activeProfileName,
          };

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

          // 6. Refuse to launch offline test clients against an authenticating
          // instance. The client would reach "登录失败：无效会话 / Failed to
          // login: Invalid session" and we would sit out the whole wait window
          // for a failure that can never resolve itself.
          //
          // Only the entry point authenticates: behind a proxy the backends are
          // expected to run offline, so check the proxy in that case.
          const authGate = profile.proxy ? profile.proxy : backends[0];
          assertOfflineAuthGate({
            instance: authGate,
            onlineMode: (await serverManager.loadMeta(authGate)).onlineMode,
            isProxy: Boolean(profile.proxy),
            clients: profile.clients,
          });

          // 7. Launch clients (reuse running clients via reconnect)
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

          // 8. Wait for clients (WS connected + in-world)
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
    .action(
      wrapCommand(
        async (
          context,
          { globalOptions }: { globalOptions: { profile?: string } },
        ) => {
          const { projectFile, projectId } = context;
          if (!projectFile || !projectId) {
            throw noProject();
          }

          const profile = requireActiveProfile({
            projectFile,
            activeProfile: context.activeProfile,
            requestedProfile: globalOptions.profile,
          });

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
          const results: Record<string, unknown> = {
            profile: context.activeProfileName,
          };

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
