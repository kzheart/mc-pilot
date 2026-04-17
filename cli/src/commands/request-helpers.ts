import { Command } from "commander";

import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { WebSocketClient } from "../client/WebSocketClient.js";
import type { CommandContext, GlobalOptions } from "../util/context.js";
import { MctError } from "../util/errors.js";
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
  timeoutSeconds?: number
) {
  const manager = new ClientInstanceManager(context.globalState);
  const client = await manager.getClient(clientName);
  const ws = new WebSocketClient(`ws://127.0.0.1:${client.wsPort}`);
  return ws.send(action, params, timeoutSeconds ?? context.timeout("default"));
}

export function createRequestAction<TOptions = Record<string, any>>(
  action: string,
  buildParams: (payload: RequestPayload<TOptions>) => Record<string, unknown>,
  timeoutSelector?: (payload: RequestPayload<TOptions>, context: CommandContext) => number | undefined
) {
  return wrapCommand<TOptions>(async (context, payload) => {
    const timeout = timeoutSelector?.(payload, context);
    return sendClientRequest(
      context,
      payload.globalOptions.client,
      action,
      buildParams(payload),
      timeout
    );
  });
}

export function parseJson(text: string, fieldName: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: `${fieldName} must be valid JSON`
      },
      4
    );
  }
}

export function parseNumberList(text: string) {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
}

export function withTransportTimeoutBuffer(requestedTimeout: number | undefined, fallbackTimeout: number) {
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
    maxDistance: options.maxDistance
  };

  if (!filter.type && !filter.name && !filter.nearest && !filter.id && !filter.maxDistance) {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: "At least one entity filter option is required"
      },
      4
    );
  }

  return filter;
}

export function command(name: string, description: string) {
  return new Command(name).description(description);
}
