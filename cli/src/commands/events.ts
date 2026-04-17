import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { MctError } from "../util/errors.js";
import { resolveMctHome } from "../util/paths.js";
import { wrapCommand } from "../util/command.js";

interface EventEntry {
  t: number;
  iso: string;
  type: string;
  payload?: Record<string, unknown>;
}

interface ListOptions {
  tail?: number;
  since?: string;
  type?: string;
  all?: boolean;
  file?: string;
}

interface WaitOptions {
  timeout?: number;
  since?: string;
  type?: string;
  match?: string;
  file?: string;
}

function resolveEventsFile(clientName: string | undefined): string {
  if (!clientName) {
    throw new MctError(
      {
        code: "INVALID_PARAMS",
        message: "Client name is required. Use --client <name> or set an active profile."
      },
      4
    );
  }
  return path.join(resolveMctHome(), "logs", clientName, "events.jsonl");
}

function parseSince(raw: string | undefined, nowMs: number): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  // 支持 "30s" / "5m" / "1h" / "200ms" / epoch 毫秒
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(trimmed);
  if (!m) {
    throw new MctError(
      { code: "INVALID_PARAMS", message: `Invalid --since value: ${raw}` },
      4
    );
  }
  const value = Number(m[1]);
  const unit = m[2];
  if (!unit) {
    // epoch millis
    return value;
  }
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return nowMs - value * multipliers[unit];
}

function readAllEvents(filePath: string): EventEntry[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const out: EventEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as EventEntry);
    } catch {
      // 跳过损坏行
    }
  }
  return out;
}

function filterEvents(events: EventEntry[], options: { sinceMs?: number; type?: string }): EventEntry[] {
  let filtered = events;
  if (options.sinceMs !== undefined) {
    filtered = filtered.filter((event) => event.t >= options.sinceMs!);
  }
  if (options.type) {
    const wanted = new Set(options.type.split(",").map((s) => s.trim()).filter(Boolean));
    filtered = filtered.filter((event) => wanted.has(event.type));
  }
  return filtered;
}

function buildPayloadText(event: EventEntry): string {
  return JSON.stringify({
    type: event.type,
    payload: event.payload ?? {}
  });
}

function buildMatchPattern(raw: string | undefined): RegExp | null {
  if (!raw) return null;
  try {
    return new RegExp(raw);
  } catch {
    throw new MctError(
      { code: "INVALID_PARAMS", message: `Invalid --match pattern: ${raw}` },
      4
    );
  }
}

async function waitForEvent(
  filePath: string,
  options: { timeoutSeconds: number; sinceMs: number; type?: string; match?: string }
): Promise<{ file: string; matched: true; waitedMs: number; event: EventEntry }> {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  const matchPattern = buildMatchPattern(options.match);
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    const events = filterEvents(readAllEvents(filePath), {
      sinceMs: options.sinceMs,
      type: options.type
    });

    const matched = matchPattern
      ? events.find((event) => matchPattern.test(buildPayloadText(event)))
      : events[0];

    if (matched) {
      return {
        file: filePath,
        matched: true,
        waitedMs: Date.now() - startedAt,
        event: matched
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new MctError(
    {
      code: "TIMEOUT",
      message: `Timed out after ${options.timeoutSeconds}s waiting for events in ${filePath}`,
      details: {
        file: filePath,
        type: options.type ?? null,
        match: options.match ?? null,
        sinceMs: options.sinceMs
      }
    },
    2
  );
}

export function createEventsCommand() {
  const command = new Command("events").description(
    "Inspect the client event log (written by the mod to ~/.mct/logs/<client>/events.jsonl)"
  );

  command
    .command("list")
    .description("Print events. Defaults to the last 20 for the active client.")
    .option("--tail <n>", "Show the last N events (default 20)", (v) => Number(v))
    .option("--since <duration>", "Only show events since duration ago (e.g. 30s, 5m, 1h) or epoch ms")
    .option("--type <types>", "Comma-separated list of event types to include")
    .option("--all", "Show all events (ignore --tail)")
    .option("--file <path>", "Override the log file path")
    .action(
      wrapCommand(async (context, { options, globalOptions }: { options: ListOptions; globalOptions: { client?: string } }) => {
        const clientName = globalOptions.client ?? context.activeProfile?.clients[0];
        const filePath = options.file ?? resolveEventsFile(clientName);
        const events = readAllEvents(filePath);
        let filtered = filterEvents(events, {
          sinceMs: parseSince(options.since, Date.now()),
          type: options.type
        });

        if (!options.all) {
          const tail = options.tail ?? 20;
          if (filtered.length > tail) {
            filtered = filtered.slice(filtered.length - tail);
          }
        }

        return {
          file: filePath,
          total: events.length,
          returned: filtered.length,
          events: filtered
        };
      })
    );

  command
    .command("tail")
    .description("Shortcut for `events list --tail N`")
    .argument("[n]", "Number of events (default 20)")
    .option("--type <types>", "Comma-separated event types to include")
    .option("--file <path>", "Override the log file path")
    .action(
      wrapCommand(
        async (
          context,
          { args, options, globalOptions }: {
            args: (string | undefined)[];
            options: { type?: string; file?: string };
            globalOptions: { client?: string };
          }
        ) => {
          const tail = args[0] ? Number(args[0]) : 20;
          const clientName = globalOptions.client ?? context.activeProfile?.clients[0];
          const filePath = options.file ?? resolveEventsFile(clientName);
          let events = filterEvents(readAllEvents(filePath), {
            type: options.type
          });
          if (events.length > tail) events = events.slice(events.length - tail);
          return { file: filePath, returned: events.length, events };
        }
      )
    );

  command
    .command("wait")
    .description("Wait for a matching event. Defaults to events emitted after this command starts.")
    .option("--timeout <seconds>", "Timeout in seconds (default 10)", Number)
    .option("--since <duration>", "Also consider events since duration ago (e.g. 30s, 5m, 1h) or epoch ms")
    .option("--type <types>", "Comma-separated list of event types to include")
    .option("--match <pattern>", "Regex matched against event type and payload JSON")
    .option("--file <path>", "Override the log file path")
    .action(
      wrapCommand(async (context, { options, globalOptions }: { options: WaitOptions; globalOptions: { client?: string } }) => {
        const clientName = globalOptions.client ?? context.activeProfile?.clients[0];
        const filePath = options.file ?? resolveEventsFile(clientName);
        return waitForEvent(filePath, {
          timeoutSeconds: options.timeout ?? context.timeout("default"),
          sinceMs: parseSince(options.since, Date.now()) ?? Date.now(),
          type: options.type,
          match: options.match
        });
      })
    );

  command
    .command("clear")
    .description("Truncate the event log for the active client")
    .option("--file <path>", "Override the log file path")
    .action(
      wrapCommand(async (context, { options, globalOptions }: { options: { file?: string }; globalOptions: { client?: string } }) => {
        const { truncateSync, existsSync: exists, mkdirSync } = await import("node:fs");
        const clientName = globalOptions.client ?? context.activeProfile?.clients[0];
        const filePath = options.file ?? resolveEventsFile(clientName);
        if (exists(filePath)) {
          truncateSync(filePath, 0);
          return { cleared: true, file: filePath };
        }
        // ensure directory exists for future writes
        mkdirSync(path.dirname(filePath), { recursive: true });
        return { cleared: false, reason: "file_not_found", file: filePath };
      })
    );

  command
    .command("path")
    .description("Print the expected path to the event log for the active client")
    .action(
      wrapCommand(async (context, { globalOptions }: { globalOptions: { client?: string } }) => {
        const clientName = globalOptions.client ?? context.activeProfile?.clients[0];
        return { file: resolveEventsFile(clientName), exists: existsSync(resolveEventsFile(clientName)) };
      })
    );

  return command;
}
