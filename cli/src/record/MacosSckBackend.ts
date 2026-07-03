import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MctError } from "../util/errors.js";
import type {
  RecorderBackend,
  RecordingArtifact,
  RecordingHandle,
  RecordStartOptions,
  RecordTarget,
  StopTarget,
} from "./RecorderBackend.js";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

export const HELPER_EVENT_LOG = "helper.jsonl";

interface HelperEvent {
  event: string;
  timestamp?: number;
  frames?: number;
  message?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const HELPER_BINARY_NAME = "mct-recorder";

export function resolveHelperBinary(): string {
  if (process.env.MCT_RECORDER_BIN) {
    return process.env.MCT_RECORDER_BIN;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(moduleDir, "../..");

  // 1) 随 npm 包分发的预编译二进制(发版时由 bundle:helper 写入 vendor/),即装即用
  const bundled = path.join(packageRoot, "vendor", HELPER_BINARY_NAME);
  if (existsSync(bundled)) {
    return bundled;
  }

  // 2) 仓库内开发构建兜底:cli/ → 仓库根 recorder/macos/.build
  return path.resolve(
    packageRoot,
    "..",
    `recorder/macos/.build/release/${HELPER_BINARY_NAME}`,
  );
}

async function readHelperEvents(eventLogPath: string): Promise<HelperEvent[]> {
  try {
    const raw = await readFile(eventLogPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as HelperEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is HelperEvent => event !== null);
  } catch {
    return [];
  }
}

async function waitForEvent(
  eventLogPath: string,
  eventName: string,
  helperPid: number,
  timeoutMs: number,
): Promise<HelperEvent | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const events = await readHelperEvents(eventLogPath);
    const error = events.find((event) => event.event === "error");
    if (error) {
      throw new MctError(
        {
          code: "RECORDER_ERROR",
          message: error.message ?? "recorder helper failed",
        },
        2,
      );
    }

    const match = events.find((event) => event.event === eventName);
    if (match) {
      return match;
    }

    if (!isPidRunning(helperPid)) {
      // 进程退出后给残余日志一次机会
      const finalEvents = await readHelperEvents(eventLogPath);
      return finalEvents.find((event) => event.event === eventName) ?? null;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return null;
}

/**
 * macOS ScreenCaptureKit 后端:spawn mct-recorder 长命子进程,
 * stdout 重定向到录制目录下的 helper.jsonl,start/stop 都从该文件读事件
 * (start 与 stop 是不同的 CLI 进程,无法共享 stdout 管道)。
 */
export class MacosSckBackend implements RecorderBackend {
  readonly name = "macos-sck";

  async isSupported(): Promise<{ ok: boolean; reason?: string }> {
    if (process.platform !== "darwin") {
      return {
        ok: false,
        reason: `platform ${process.platform} is not supported by ${this.name}`,
      };
    }

    const binary = resolveHelperBinary();
    if (!existsSync(binary)) {
      return {
        ok: false,
        reason:
          `recorder helper not found at ${binary}; ` +
          `try reinstalling the package, or for local dev run: cd recorder/macos && swift build -c release ` +
          `(or set MCT_RECORDER_BIN)`,
      };
    }

    const preflight = await new Promise<boolean>((resolve) => {
      const child = spawn(binary, ["--preflight"], { stdio: "ignore" });
      child.once("exit", (code) => resolve(code === 0));
      child.once("error", () => resolve(false));
    });
    if (!preflight) {
      return {
        ok: false,
        reason:
          "screen recording permission not granted; enable it for your terminal in " +
          "System Settings > Privacy & Security > Screen Recording",
      };
    }

    return { ok: true };
  }

  async start(
    target: RecordTarget,
    outputDir: string,
    opts: RecordStartOptions,
  ): Promise<RecordingHandle> {
    const binary = resolveHelperBinary();
    const fps = opts.fps ?? 30;
    const outputPath = path.join(outputDir, "recording.mp4");
    const eventLogPath = path.join(outputDir, HELPER_EVENT_LOG);

    const args = [
      "--pid",
      String(target.pid),
      "--output",
      outputPath,
      "--fps",
      String(fps),
    ];
    if (opts.windowTitle) {
      args.push("--window-title", opts.windowTitle);
    }

    const eventLogFd = openSync(eventLogPath, "a");
    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        detached: true,
        stdio: ["ignore", eventLogFd, eventLogFd],
      });
    } finally {
      closeSync(eventLogFd);
    }

    const helperPid = await new Promise<number>((resolve, reject) => {
      child.once("error", (error) =>
        reject(
          new MctError(
            {
              code: "RECORDER_ERROR",
              message: `cannot spawn recorder helper: ${error.message}`,
            },
            2,
          ),
        ),
      );
      child.once("spawn", () => resolve(child.pid!));
    });

    const started = await waitForEvent(
      eventLogPath,
      "started",
      helperPid,
      START_TIMEOUT_MS,
    );
    if (!started || typeof started.timestamp !== "number") {
      try {
        process.kill(helperPid, "SIGKILL");
      } catch {
        // helper 已退出
      }
      throw new MctError(
        {
          code: "RECORDER_ERROR",
          message: "recorder helper did not report started in time",
          details: { eventLogPath },
        },
        2,
      );
    }

    child.unref();
    return {
      backend: this.name,
      helperPid,
      outputPath,
      startedAt: started.timestamp,
      fps,
    };
  }

  async stop(target: StopTarget): Promise<RecordingArtifact> {
    const artifact: RecordingArtifact = {
      kind: "video",
      path: target.outputPath,
      startedAt: target.startedAt,
      fps: target.fps,
    };

    if (!isPidRunning(target.helperPid)) {
      // helper 已死(客户端崩溃时自动 finalize,或异常退出):尽力从日志拿帧数
      const events = await readHelperEvents(target.eventLogPath);
      const stopped = events.find((event) => event.event === "stopped");
      artifact.frames = stopped?.frames;
      artifact.interrupted = !stopped;
      return artifact;
    }

    process.kill(target.helperPid, "SIGTERM");
    const stopped = await waitForEvent(
      target.eventLogPath,
      "stopped",
      target.helperPid,
      STOP_TIMEOUT_MS,
    );
    if (!stopped) {
      throw new MctError(
        {
          code: "RECORDER_ERROR",
          message:
            "recorder helper did not finalize in time; recording file may be incomplete",
          details: {
            helperPid: target.helperPid,
            eventLogPath: target.eventLogPath,
          },
        },
        2,
      );
    }

    artifact.frames = stopped.frames;
    return artifact;
  }
}
