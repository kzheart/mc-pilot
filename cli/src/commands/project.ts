import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { checkProxyForwarding } from "../instance/proxy-check.js";
import {
  resolveServerTarget,
  ServerManager,
  type ServerTarget,
} from "../instance/ServerManager.js";
import type { CommandContext } from "../util/context.js";
import { MctError, noProject } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import { resolveProjectRunDir } from "../util/paths.js";
import {
  createDefaultProjectFile,
  loadProjectFileForCwd,
  normalizeProjectRoot,
  requireActiveProfile,
  resolveBackendNames,
  resolveProjectFilePath,
  writeProjectFile,
  type MctProfile,
} from "../util/project.js";

const GITIGNORE_ENTRIES = ["run/", ".mct/"];

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
      message: `Instance '${input.instance}' runs with online-mode=true, but mct test clients use offline accounts and will be rejected with "Failed to login: Invalid session". Set online-mode to false in its config and restart it, or run with --server-only-ok to skip clients.`,
      details: {
        instance: input.instance,
        onlineMode: true,
        isProxy: input.isProxy,
        clients: input.clients,
      },
    },
    4,
  );
}

async function ensureGitignore(rootDir: string): Promise<string[]> {
  const filePath = path.join(rootDir, ".gitignore");
  const existing = await readFile(filePath, "utf8").catch(() => "");
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter(
    (entry) => !present.has(entry) && !present.has(`/${entry}`),
  );
  if (missing.length > 0) {
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(
      filePath,
      `${existing}${prefix}${missing.join("\n")}\n`,
      "utf8",
    );
  }
  return missing;
}

function requireProject(context: CommandContext) {
  const { projectFile, projectRootDir } = context;
  if (!projectFile || !projectRootDir) {
    throw noProject();
  }
  return { projectFile, projectRootDir };
}

interface ProfileTargets {
  profile: MctProfile;
  backends: ServerTarget[];
  proxy?: ServerTarget;
}

async function resolveProfileTargets(
  context: CommandContext,
  requestedProfile?: string,
): Promise<ProfileTargets> {
  const { projectFile } = requireProject(context);
  const profile = requireActiveProfile({
    projectFile,
    activeProfile: context.activeProfile,
    requestedProfile,
  });

  const backendNames = resolveBackendNames(profile);
  if (backendNames.length === 0) {
    throw new MctError(
      {
        code: "NO_PROFILE",
        message:
          "Profile has no backend server configured (set 'server' or 'servers')",
      },
      4,
    );
  }

  const backends: ServerTarget[] = [];
  for (const name of backendNames) {
    backends.push(await resolveServerTarget(context, name));
  }
  return {
    profile,
    backends,
    proxy: profile.proxy
      ? await resolveServerTarget(context, profile.proxy)
      : undefined,
  };
}

export function createInitCommand() {
  return new Command("init")
    .description(
      "Create mct.json and run/ in the current directory (servers go in run/<name>/)",
    )
    .option("--name <name>", "Project name (default: directory name)")
    .action(
      wrapCommand(
        async (context, { options }: { options: { name?: string } }) => {
          const rootDir = normalizeProjectRoot(context.cwd);
          const existing = await loadProjectFileForCwd(rootDir);
          if (existing?.rootDir === rootDir) {
            throw new MctError(
              {
                code: "PROJECT_EXISTS",
                message: `Project config already exists: ${existing.filePath}`,
              },
              4,
            );
          }

          const projectName = options.name ?? path.basename(rootDir);
          await writeProjectFile(
            rootDir,
            createDefaultProjectFile(projectName),
          );
          await mkdir(resolveProjectRunDir(rootDir), { recursive: true });
          const gitignoreAdded = await ensureGitignore(rootDir);

          return {
            created: true,
            project: projectName,
            rootDir,
            configPath: resolveProjectFilePath(rootDir),
            runDir: resolveProjectRunDir(rootDir),
            gitignoreAdded,
          };
        },
      ),
    );
}

export function createUpCommand() {
  return new Command("up")
    .description(
      "Start the profile's servers (backends, then proxy) and clients, and wait until clients are in-world",
    )
    .option("--eula", "Accept the Minecraft EULA for backends")
    .option(
      "--server-only-ok",
      "Only start and wait for servers; skip launching and waiting for clients",
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
          const { profile, backends, proxy } = await resolveProfileTargets(
            context,
            globalOptions.profile,
          );
          const serverManager = new ServerManager();
          const results: Record<string, unknown> = {
            profile: context.activeProfileName,
          };

          // Catch routing/forwarding mismatches before anything boots.
          if (proxy) {
            const proxyStatus = await serverManager.status(proxy);
            const check = await checkProxyForwarding({
              proxy: {
                name: proxy.name,
                dir: proxy.dir,
                kind: proxyStatus.kind ?? "velocity",
              },
              backends: await Promise.all(
                backends.map(async (backend) => ({
                  name: backend.name,
                  dir: backend.dir,
                  port: await serverManager.readPort(backend),
                })),
              ),
            });
            if (check.issues.length > 0) {
              throw new MctError(
                {
                  code: "PROXY_CONFIG_MISMATCH",
                  message: `Proxy ${proxy.name} and its backends disagree: ${check.issues.join("; ")}`,
                  details: check,
                },
                4,
              );
            }
            if (check.warnings.length > 0) {
              results.proxyWarnings = check.warnings;
            }
          }

          const timeoutSeconds = context.timeout("serverReady");
          const servers: unknown[] = [];
          for (const backend of backends) {
            servers.push(
              await serverManager.start(backend, {
                eula: options.eula,
                wait: false,
                timeoutSeconds,
              }),
            );
          }
          results.servers = servers;
          results.serversReady = await Promise.all(
            backends.map((backend) =>
              serverManager.waitReady(backend, timeoutSeconds),
            ),
          );

          if (proxy) {
            results.proxy = await serverManager.start(proxy, {
              timeoutSeconds,
            });
          }

          if (options.serverOnlyOk) {
            results.ready = true;
            results.clientsSkipped = true;
            return results;
          }

          // Only the entry point authenticates: behind a proxy the backends
          // run offline, so the proxy's setting is the one that matters.
          const entry = proxy ?? backends[0];
          assertOfflineAuthGate({
            instance: entry.name,
            onlineMode: await serverManager.readOnlineMode(entry),
            isProxy: Boolean(proxy),
            clients: profile.clients,
          });

          const serverAddress = `127.0.0.1:${await serverManager.readPort(entry)}`;
          const clientManager = new ClientInstanceManager(context.globalState);
          const clients: unknown[] = [];
          for (const clientName of profile.clients) {
            clients.push(
              (await clientManager.isAlreadyRunning(clientName))
                ? await clientManager.reconnect(clientName, serverAddress)
                : await clientManager.launch(clientName, {
                    server: serverAddress,
                  }),
            );
          }
          results.clients = clients;

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
    .description("Stop the profile's clients, proxy and servers")
    .action(
      wrapCommand(
        async (
          context,
          { globalOptions }: { globalOptions: { profile?: string } },
        ) => {
          const { profile, backends, proxy } = await resolveProfileTargets(
            context,
            globalOptions.profile,
          );
          const serverManager = new ServerManager();
          const clientManager = new ClientInstanceManager(context.globalState);

          const clients = [];
          for (const clientName of profile.clients) {
            clients.push(await clientManager.stop(clientName));
          }
          const proxyResult = proxy
            ? await serverManager.stop(proxy)
            : undefined;
          const servers = [];
          for (const backend of backends) {
            servers.push(await serverManager.stop(backend));
          }

          const isStopped = (result: {
            stopped: boolean;
            alreadyStopped?: boolean;
          }) => result.stopped || Boolean(result.alreadyStopped);
          return {
            profile: context.activeProfileName,
            clients,
            ...(proxyResult ? { proxy: proxyResult } : {}),
            servers,
            allClean:
              clients.every(isStopped) &&
              (proxyResult === undefined || isStopped(proxyResult)) &&
              servers.every(isStopped),
          };
        },
      ),
    );
}

export function createUseCommand() {
  return new Command("use")
    .description("Set the default profile in mct.json")
    .argument("<profile>", "Profile name to set as default")
    .action(
      wrapCommand(async (context, { args }) => {
        const { projectFile, projectRootDir } = requireProject(context);

        const profileName = args[0]!;
        if (!projectFile.profiles[profileName]) {
          throw new MctError(
            {
              code: "PROFILE_NOT_FOUND",
              message: `Profile '${profileName}' not found`,
              details: { available: Object.keys(projectFile.profiles) },
            },
            4,
          );
        }

        projectFile.defaultProfile = profileName;
        await writeProjectFile(projectRootDir, projectFile);

        return {
          defaultProfile: profileName,
          profile: projectFile.profiles[profileName],
        };
      }),
    );
}
