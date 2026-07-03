import { Command } from "commander";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { createRecorderBackend } from "../record/factory.js";
import { HELPER_EVENT_LOG } from "../record/MacosSckBackend.js";
import {
  RecordingStateStore,
  TIMELINE_FILE,
  type ActiveRecording,
  type TimelineEntry,
} from "../record/recording-state.js";
import type { RecordingArtifact } from "../record/RecorderBackend.js";
import {
  renderViewerHtml,
  type ViewerEventEntry,
} from "../record/viewer-template.js";
import { wrapCommand } from "../util/command.js";
import type { CommandContext, GlobalOptions } from "../util/context.js";
import { MctError, invalidParams } from "../util/errors.js";
import { resolveMctHome, resolveProjectRecordingsDir } from "../util/paths.js";
import { resolveInstanceName } from "./request-helpers.js";

export interface RecordingManifest {
  recordingId: string;
  clientName: string;
  backend: string;
  startedIso: string;
  artifact: {
    kind: "video" | "frames";
    /** 相对 recordings/<id>/ 的路径,目录可整体拷贝 */
    path: string;
    startedAt: number;
    fps: number;
    frames?: number;
  };
  stoppedAt?: number;
  status: "recording" | "completed" | "interrupted";
}

const MANIFEST_FILE = "manifest.json";
const EVENTS_FILE = "events.jsonl";

function requireRecordingsDir(context: CommandContext): string {
  if (!context.projectId) {
    throw invalidParams(
      "record requires a project context (run inside a project or pass --project)",
    );
  }
  return resolveProjectRecordingsDir(context.projectId);
}

function requireClientName(
  context: CommandContext,
  globalOptions: GlobalOptions,
): string {
  return resolveInstanceName(context, globalOptions.client, "client");
}

function isPidRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function buildRecordingId(clientName: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 19);
  return `${timestamp}-${clientName}`;
}

async function readManifest(dir: string): Promise<RecordingManifest | null> {
  try {
    return JSON.parse(
      await readFile(path.join(dir, MANIFEST_FILE), "utf8"),
    ) as RecordingManifest;
  } catch {
    return null;
  }
}

async function writeManifest(dir: string, manifest: RecordingManifest) {
  await writeFile(
    path.join(dir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

/** 从客户端全量事件日志按录制时间窗切片到产物目录 */
async function sliceEvents(
  clientName: string,
  dir: string,
  startedAt: number,
  stoppedAt: number,
): Promise<number> {
  const sourcePath = path.join(
    resolveMctHome(),
    "logs",
    clientName,
    EVENTS_FILE,
  );
  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf8");
  } catch {
    return 0;
  }

  const lines = raw.split("\n").filter((line) => {
    if (!line) return false;
    try {
      const entry = JSON.parse(line) as { t?: number };
      return (
        typeof entry.t === "number" &&
        entry.t >= startedAt &&
        entry.t <= stoppedAt
      );
    } catch {
      return false;
    }
  });

  await writeFile(
    path.join(dir, EVENTS_FILE),
    lines.length ? `${lines.join("\n")}\n` : "",
    "utf8",
  );
  return lines.length;
}

async function countJsonlLines(filePath: string): Promise<number> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function startRecording(
  context: CommandContext,
  globalOptions: GlobalOptions,
  options: { fps?: number; backend?: string; windowTitle?: string },
) {
  const recordingsDir = requireRecordingsDir(context);
  const clientName = requireClientName(context, globalOptions);

  const backend = createRecorderBackend(options.backend);
  const supported = await backend.isSupported();
  if (!supported.ok) {
    throw new MctError(
      {
        code: "RECORDER_UNSUPPORTED",
        message: supported.reason ?? "recorder backend is not supported",
      },
      3,
    );
  }

  const manager = new ClientInstanceManager(context.globalState);
  const client = await manager.getClient(clientName);

  const store = new RecordingStateStore();
  await store.updateRecordings((state) => {
    const existing = state.active[clientName];
    if (existing) {
      if (isPidRunning(existing.helperPid)) {
        throw new MctError(
          {
            code: "ALREADY_RECORDING",
            message: `client ${clientName} is already being recorded (${existing.recordingId})`,
            details: { recordingId: existing.recordingId, dir: existing.dir },
          },
          2,
        );
      }
      // 残留条目且 helper 已死:自动清理后继续
      delete state.active[clientName];
    }
  });

  const recordingId = buildRecordingId(clientName);
  const dir = path.join(recordingsDir, recordingId);
  await mkdir(dir, { recursive: true });

  const handle = await backend.start({ clientName, pid: client.pid }, dir, {
    fps: options.fps,
    windowTitle: options.windowTitle,
  });

  const manifest: RecordingManifest = {
    recordingId,
    clientName,
    backend: backend.name,
    startedIso: new Date(handle.startedAt).toISOString(),
    artifact: {
      kind: "video",
      path: path.relative(dir, handle.outputPath),
      startedAt: handle.startedAt,
      fps: handle.fps,
    },
    status: "recording",
  };
  await writeManifest(dir, manifest);

  const active: ActiveRecording = {
    recordingId,
    clientName,
    backend: backend.name,
    helperPid: handle.helperPid,
    dir,
    outputPath: handle.outputPath,
    eventLogPath: path.join(dir, HELPER_EVENT_LOG),
    startedAt: handle.startedAt,
    fps: handle.fps,
    projectId: context.projectId,
  };
  await store.updateRecordings((state) => {
    state.active[clientName] = active;
  });

  return {
    recordingId,
    clientName,
    dir,
    startedAt: handle.startedAt,
    fps: handle.fps,
    helperPid: handle.helperPid,
  };
}

async function stopRecording(
  context: CommandContext,
  globalOptions: GlobalOptions,
) {
  const clientName = requireClientName(context, globalOptions);

  const store = new RecordingStateStore();
  const state = await store.readRecordings();
  const active = state.active[clientName];
  if (!active) {
    throw new MctError(
      {
        code: "NOT_RECORDING",
        message: `no active recording for client ${clientName}`,
      },
      2,
    );
  }

  const backend = createRecorderBackend(active.backend);
  let artifact: RecordingArtifact;
  try {
    artifact = await backend.stop({
      helperPid: active.helperPid,
      outputPath: active.outputPath,
      startedAt: active.startedAt,
      fps: active.fps,
      eventLogPath: active.eventLogPath,
    });
  } finally {
    // 无论 finalize 是否成功都摘掉活动状态,避免卡死的条目阻塞后续录制
    await store.updateRecordings((current) => {
      delete current.active[clientName];
    });
  }

  const stoppedAt = Date.now();
  const eventCount = await sliceEvents(
    clientName,
    active.dir,
    active.startedAt,
    stoppedAt,
  );

  const manifest = (await readManifest(active.dir)) ?? {
    recordingId: active.recordingId,
    clientName,
    backend: active.backend,
    startedIso: new Date(active.startedAt).toISOString(),
    artifact: {
      kind: artifact.kind,
      path: path.relative(active.dir, artifact.path),
      startedAt: artifact.startedAt,
      fps: artifact.fps,
    },
    status: "recording" as const,
  };
  manifest.artifact.frames = artifact.frames;
  manifest.stoppedAt = stoppedAt;
  manifest.status = artifact.interrupted ? "interrupted" : "completed";
  await writeManifest(active.dir, manifest);

  return {
    recordingId: active.recordingId,
    clientName,
    dir: active.dir,
    status: manifest.status,
    durationMs: stoppedAt - active.startedAt,
    frames: artifact.frames ?? null,
    events: eventCount,
    timelineEntries: await countJsonlLines(
      path.join(active.dir, TIMELINE_FILE),
    ),
  };
}

async function listRecordings(context: CommandContext) {
  const recordingsDir = requireRecordingsDir(context);

  let entries: string[];
  try {
    entries = (await readdir(recordingsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { recordings: [] };
  }

  const state = await new RecordingStateStore().readRecordings();
  const activeIds = new Set(
    Object.values(state.active).map((entry) => entry.recordingId),
  );

  const recordings = [];
  for (const name of entries.sort()) {
    const dir = path.join(recordingsDir, name);
    const manifest = await readManifest(dir);
    if (!manifest) continue;
    recordings.push({
      recordingId: manifest.recordingId,
      clientName: manifest.clientName,
      status: activeIds.has(manifest.recordingId)
        ? "recording"
        : manifest.status,
      startedIso: manifest.startedIso,
      stoppedAt: manifest.stoppedAt ?? null,
      dir,
    });
  }
  return { recordings };
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is T => entry !== null);
  } catch {
    return [];
  }
}

async function viewRecording(
  context: CommandContext,
  recordingId: string,
  options: { open?: boolean },
) {
  const recordingsDir = requireRecordingsDir(context);
  const dir = path.join(recordingsDir, recordingId);

  const manifest = await readManifest(dir);
  if (!manifest) {
    const available = (await listRecordings(context)).recordings.map(
      (entry) => entry.recordingId,
    );
    throw new MctError(
      {
        code: "NOT_FOUND",
        message: `recording ${recordingId} not found`,
        details: { available },
      },
      2,
    );
  }

  const timeline = await readJsonl<TimelineEntry>(
    path.join(dir, TIMELINE_FILE),
  );
  const events = await readJsonl<ViewerEventEntry>(path.join(dir, EVENTS_FILE));

  const html = renderViewerHtml({
    recordingId: manifest.recordingId,
    clientName: manifest.clientName,
    startedAt: manifest.artifact.startedAt,
    stoppedAt: manifest.stoppedAt,
    status: manifest.status,
    videoPath: manifest.artifact.path,
    timeline,
    events,
  });

  const viewerPath = path.join(dir, "viewer.html");
  await writeFile(viewerPath, html, "utf8");

  const shouldOpen = (options.open ?? true) && process.platform === "darwin";
  if (shouldOpen) {
    spawn("open", [viewerPath], { detached: true, stdio: "ignore" }).unref();
  }

  return {
    recordingId,
    viewer: viewerPath,
    opened: shouldOpen,
    timelineEntries: timeline.length,
    events: events.length,
  };
}

export function createRecordCommand() {
  const record = new Command("record").description(
    "Record the client screen during a test session",
  );

  record
    .command("start")
    .description("Start recording the client window")
    .option("--fps <fps>", "Capture frame rate (default 30)", Number)
    .option("--backend <name>", "Recorder backend (default: by platform)")
    .option(
      "--window-title <hint>",
      "Window title hint for locating the client window",
    )
    .action(
      wrapCommand(async (context, { options, globalOptions }) =>
        startRecording(
          context,
          globalOptions,
          options as { fps?: number; backend?: string; windowTitle?: string },
        ),
      ),
    );

  record
    .command("stop")
    .description("Stop recording and finalize artifacts")
    .action(
      wrapCommand(async (context, { globalOptions }) =>
        stopRecording(context, globalOptions),
      ),
    );

  record
    .command("list")
    .description("List recordings of the current project")
    .action(wrapCommand(async (context) => listRecordings(context)));

  record
    .command("view <id>")
    .description(
      "Generate viewer.html for a recording (opens in browser on macOS)",
    )
    .option("--no-open", "Do not open the viewer after generating it")
    .action(
      wrapCommand(async (context, { args, options }) =>
        viewRecording(context, args[0]!, options as { open?: boolean }),
      ),
    );

  return record;
}
