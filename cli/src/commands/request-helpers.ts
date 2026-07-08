import { Command } from "commander";
import path from "node:path";

import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { WebSocketClient } from "../client/WebSocketClient.js";
import { appendTimelineEntry } from "../record/recording-state.js";
import type { CommandContext, GlobalOptions } from "../util/context.js";
import { ERROR_MESSAGES, invalidParams } from "../util/errors.js";
import { resolveBackendNames, type MctProfile } from "../util/project.js";
import { wrapCommand } from "../util/command.js";

export interface RequestPayload<TOptions> {
  args: (string | undefined)[];
  options: TOptions;
  globalOptions: GlobalOptions;
}

export async function sendClientRequest(
  context: CommandContext,
  clientName: string | undefined,
  action: string,
  params: Record<string, unknown>,
  timeoutSeconds?: number,
) {
  const manager = new ClientInstanceManager(context.globalState);
  const client = await manager.getClient(clientName);
  const ws = new WebSocketClient(`ws://127.0.0.1:${client.wsPort}`);

  const requestedAt = Date.now();
  try {
    const result = await ws.send(
      action,
      params,
      timeoutSeconds ?? context.timeout("default"),
    );
    await appendTimelineEntry(client.name, {
      t: requestedAt,
      action,
      params,
      success: true,
      durationMs: Date.now() - requestedAt,
    });
    return result;
  } catch (error) {
    await appendTimelineEntry(client.name, {
      t: requestedAt,
      action,
      params,
      success: false,
      durationMs: Date.now() - requestedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function resolvePreferredClientName(
  context: CommandContext,
  globalOptions: GlobalOptions,
): string | undefined {
  return globalOptions.client ?? context.activeProfile?.clients[0];
}

type InstanceNameContext = {
  activeProfile: MctProfile | null;
};

export function resolveInstanceName(
  context: InstanceNameContext,
  explicitName: string | undefined,
  kind: "client" | "server",
): string {
  const profileName =
    kind === "client"
      ? context.activeProfile?.clients?.[0]
      : context.activeProfile
        ? resolveBackendNames(context.activeProfile)[0]
        : undefined;
  const instanceName = explicitName ?? profileName;
  if (!instanceName) {
    throw invalidParams(
      kind === "client"
        ? ERROR_MESSAGES.CLIENT_NAME_REQUIRED
        : ERROR_MESSAGES.SERVER_NAME_REQUIRED,
    );
  }
  return instanceName;
}

export function resolveAllProfileClientNames(
  context: InstanceNameContext,
): string[] {
  const clients = context.activeProfile?.clients ?? [];
  if (clients.length === 0) {
    throw invalidParams(
      "--all-clients requires an active profile with clients",
    );
  }
  return clients;
}

export function resolveProjectRelativePath(
  context: CommandContext,
  targetPath: string,
): string {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(context.projectRootDir ?? context.cwd, targetPath);
}

export function resolveScreenshotOutputPath(
  context: CommandContext,
  output: string | undefined,
  prefix: "screenshot" | "gui",
): string {
  if (output) {
    return resolveProjectRelativePath(context, output);
  }

  const outputDir = context.projectFile?.screenshot?.outputDir;
  if (!outputDir) {
    throw invalidParams(ERROR_MESSAGES.OUTPUT_REQUIRED);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(outputDir, `${prefix}-${timestamp}.png`);
}

export function createRequestAction<TOptions = Record<string, any>>(
  action: string,
  buildParams: (payload: RequestPayload<TOptions>) => Record<string, unknown>,
  timeoutSelector?: (
    payload: RequestPayload<TOptions>,
    context: CommandContext,
  ) => number | undefined,
) {
  return wrapCommand<TOptions>(async (context, payload) => {
    const timeout = timeoutSelector?.(payload, context);
    return sendClientRequest(
      context,
      resolvePreferredClientName(context, payload.globalOptions),
      action,
      buildParams(payload),
      timeout,
    );
  });
}

export function parseJson(text: string, fieldName: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw invalidParams(`${fieldName} must be valid JSON`);
  }
}

export function parseNumberList(text: string) {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
}

export function withTransportTimeoutBuffer(
  requestedTimeout: number | undefined,
  fallbackTimeout: number,
) {
  const effectiveTimeout = requestedTimeout ?? fallbackTimeout;
  return Math.max(effectiveTimeout + 10, fallbackTimeout);
}

export function buildEntityFilter(options: {
  type?: string;
  name?: string;
  nearest?: boolean;
  id?: number;
  maxDistance?: number;
}) {
  const filter = {
    type: options.type,
    name: options.name,
    nearest: options.nearest,
    id: options.id,
    maxDistance: options.maxDistance,
  };

  if (
    !filter.type &&
    !filter.name &&
    !filter.nearest &&
    !filter.id &&
    !filter.maxDistance
  ) {
    throw invalidParams("At least one entity filter option is required");
  }

  return filter;
}

export function command(name: string, description: string) {
  return new Command(name).description(description);
}
