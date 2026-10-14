import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { invalidParams, MctError } from "../util/errors.js";

const execFileAsync = promisify(execFile);
export const RECORDING_DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  maxDurationSeconds: 1800,
};
export const RECORDING_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function validateRecordingName(name: string): string {
  if (
    !RECORDING_NAME.test(name) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)
  ) {
    throw invalidParams(
      "Recording name must be 1–80 ASCII letters, digits, underscores or hyphens, starting with a letter or digit (no path or extension)",
    );
  }
  return name;
}

export function recordingStartParams(
  name: string | undefined,
  options: {
    width?: number;
    height?: number;
    fps?: number;
    maxDuration?: number;
  },
): Record<string, unknown> {
  const width = options.width ?? RECORDING_DEFAULTS.width;
  const height = options.height ?? RECORDING_DEFAULTS.height;
  const fps = options.fps ?? RECORDING_DEFAULTS.fps;
  const maxDurationSeconds =
    options.maxDuration ?? RECORDING_DEFAULTS.maxDurationSeconds;
  for (const [field, value, min, max] of [
    ["width", width, 2, 7680],
    ["height", height, 2, 4320],
    ["fps", fps, 1, 120],
    ["max-duration", maxDurationSeconds, 1, 7200],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw invalidParams(
        `${field} must be an integer between ${min} and ${max}`,
      );
    }
  }
  if (width % 2 || height % 2) {
    throw invalidParams("Recording width and height must be even for H.264");
  }
  return {
    ...(name === undefined ? {} : { name: validateRecordingName(name) }),
    width,
    height,
    fps,
    maxDurationSeconds,
  };
}

export interface RecordingResponse {
  id?: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: unknown;
  details?: unknown;
}

export function checkRecordingResponse(
  value: unknown,
  action?: string,
): RecordingResponse {
  const response = value as RecordingResponse;
  if (!response || typeof response.success !== "boolean") {
    throw new MctError({
      code: "INTERNAL_ERROR",
      message: "Invalid recording response from the client mod",
    });
  }
  if (response.success) {
    if (
      (action === "start" || action === "stop") &&
      response.data?.state === "failed"
    ) {
      throw new MctError(
        {
          code: "RECORDING_FAILED",
          message: String(
            response.data.error ?? "Recording did not finalize successfully",
          ),
          details: response.data,
        },
        3,
      );
    }
    return response;
  }
  const error = response.error;
  const structured =
    error && typeof error === "object"
      ? (error as { code?: string; message?: string })
      : undefined;
  const detailMessage =
    response.details && typeof response.details === "object"
      ? (response.details as { message?: unknown }).message
      : undefined;
  const errorText = structured?.message ?? String(error ?? "Recording failed");
  const message =
    typeof detailMessage === "string"
      ? detailMessage.startsWith(`${errorText}:`)
        ? detailMessage
        : `${errorText}: ${detailMessage}`
      : errorText;
  const code =
    structured?.code ?? message.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1];
  if (
    code === "INVALID_ACTION" ||
    code === "UNKNOWN_ACTION" ||
    code === "UNSUPPORTED_ACTION" ||
    (/unknown|unsupported|unrecognized|not implemented/i.test(message) &&
      /action|recording\./i.test(message))
  ) {
    throw new MctError(
      {
        code: "RECORDING_UNSUPPORTED",
        message:
          "This running client mod does not support native recording. Update the MC Pilot client mod to a recording-capable build matching this Minecraft version and loader, restart the client, then run 'mct record status'. Updating the CLI alone is not enough.",
        details: { originalError: error },
      },
      3,
    );
  }
  throw new MctError(
    {
      code: code ?? "RECORDING_FAILED",
      message,
      details: response.details,
    },
    code === "INVALID_PARAMS" ? 4 : code === "TIMEOUT" ? 2 : 3,
  );
}

export async function inspectFfmpeg(executable = "ffmpeg") {
  if (!executable.trim() || executable.includes("\0")) {
    throw invalidParams(
      "FFmpeg executable must be a command name or local executable path",
    );
  }
  try {
    const options = {
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    };
    const { stdout, stderr } = await execFileAsync(
      executable,
      ["-version"],
      options,
    );
    const version = `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .find((line) => /^ffmpeg version /i.test(line));
    if (!version)
      throw new Error("Executable did not identify itself as FFmpeg");
    const encoders = await execFileAsync(
      executable,
      ["-hide_banner", "-encoders"],
      options,
    );
    const h264 = /^\s*V\S*\s+libx264\s/m.test(
      `${encoders.stdout}\n${encoders.stderr}`,
    );
    return {
      available: true,
      ready: h264,
      executable,
      version,
      libx264: h264,
      scope: "cli-process",
      downloaded: false,
      guidance: h264
        ? "The running game must also find this executable. Check 'mct record status' for the mod's capabilities."
        : "Install an FFmpeg build with the libx264 encoder and check again.",
    };
  } catch (error) {
    return {
      available: false,
      ready: false,
      executable,
      libx264: false,
      scope: "cli-process",
      downloaded: false,
      reason: error instanceof Error ? error.message : String(error),
      guidance:
        "Install FFmpeg with libx264 through your trusted OS package manager or a distribution linked from https://ffmpeg.org/download.html. Put ffmpeg on the game's PATH, or launch with 'mct client launch <client> --record-ffmpeg /absolute/path/to/ffmpeg'. Restart the client and check 'mct record status'. No binary is downloaded automatically.",
    };
  }
}

// Read only a finalized artifact inside the selected local client's recording
// directory. Never trust a path returned over WebSocket as an arbitrary file.
export async function verifiedRecordingPath(
  instanceDir: string,
  outputPath: string,
): Promise<string> {
  const root = await realpath(
    path.join(instanceDir, "minecraft", "recordings"),
  );
  const candidate = await realpath(outputPath);
  if (
    path.dirname(candidate) !== root ||
    !candidate.toLowerCase().endsWith(".mp4") ||
    candidate.toLowerCase().endsWith(".partial.mp4") ||
    !(await stat(candidate)).isFile()
  ) {
    throw invalidParams(
      "Recording artifact is not a finalized MP4 in this client's recordings directory",
    );
  }
  return candidate;
}

export async function probeRecording(outputPath: string) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        outputPath,
      ],
      { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
    );
    return { available: true, ...JSON.parse(stdout) };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
