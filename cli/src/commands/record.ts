import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import {
  checkRecordingResponse,
  inspectFfmpeg,
  probeRecording,
  recordingStartParams,
  validateRecordingName,
  verifiedRecordingPath,
} from "../record/recording.js";
import { wrapCommand } from "../util/command.js";
import { MctError } from "../util/errors.js";
import {
  resolvePreferredClientName,
  sendClientRequest,
} from "./request-helpers.js";

export function createRecordCommand() {
  const command = new Command("record").description(
    "Record native Minecraft frames through the client mod (silent H.264 MP4)",
  );

  command
    .command("start [name]")
    .description(
      "Start recording to the client's gameDir/recordings (default 1920x1080 at 30 fps; framebuffer must match)",
    )
    .option(
      "--width <pixels>",
      "Native framebuffer width (default 1920; even)",
      Number,
    )
    .option(
      "--height <pixels>",
      "Native framebuffer height (default 1080; even)",
      Number,
    )
    .option(
      "--fps <fps>",
      "Requested capture and MP4 CFR rate, 1–120 (default 30)",
      Number,
    )
    .option(
      "--max-duration <seconds>",
      "Stop automatically after 1–7200 seconds (default 1800)",
      Number,
    )
    .option(
      "--timeout <seconds>",
      "Request timeout (default at least 30 seconds)",
      Number,
    )
    .action(
      wrapCommand<{
        width?: number;
        height?: number;
        fps?: number;
        maxDuration?: number;
        timeout?: number;
      }>(async (context, { args, options, globalOptions }) => {
        const params = recordingStartParams(args[0], options);
        return checkRecordingResponse(
          await sendClientRequest(
            context,
            resolvePreferredClientName(context, globalOptions),
            "recording.start",
            params,
            options.timeout ?? Math.max(30, context.timeout("default")),
          ),
          "start",
        );
      }),
    );

  for (const action of ["stop", "status", "list"] as const) {
    command
      .command(action)
      .description(
        {
          stop: "Stop recording and wait for MP4 finalization",
          status:
            "Inspect recording state, native dimensions, real capture rate and mod capabilities",
          list: "List finalized recordings for the selected running client",
        }[action],
      )
      .option(
        "--timeout <seconds>",
        "Request timeout (stop defaults to at least 60 seconds)",
        Number,
      )
      .action(
        wrapCommand<{ timeout?: number }>(
          async (context, { options, globalOptions }) =>
            checkRecordingResponse(
              await sendClientRequest(
                context,
                resolvePreferredClientName(context, globalOptions),
                `recording.${action}`,
                {},
                options.timeout ??
                  Math.max(
                    action === "stop" ? 60 : 10,
                    context.timeout("default"),
                  ),
              ),
              action,
            ),
        ),
      );
  }

  command
    .command("doctor")
    .description(
      "Discover an existing local FFmpeg and check libx264; never download or install binaries",
    )
    .option(
      "--ffmpeg <executable>",
      "FFmpeg executable to inspect (default: PATH)",
    )
    .action(
      wrapCommand<{ ffmpeg?: string }>(async (_context, { options }) =>
        inspectFfmpeg(
          options.ffmpeg ?? process.env.MCT_RECORD_FFMPEG ?? "ffmpeg",
        ),
      ),
    );

  command
    .command("view <name>")
    .description(
      "Resolve a finalized recording to a verified local file URL; never opens apps automatically",
    )
    .option(
      "--probe",
      "Inspect the MP4 with an existing local ffprobe, if available",
    )
    .action(
      wrapCommand<{ probe?: boolean }>(
        async (context, { args, options, globalOptions }) => {
          const name = validateRecordingName(args[0]!);
          const clientName = resolvePreferredClientName(context, globalOptions);
          const response = checkRecordingResponse(
            await sendClientRequest(context, clientName, "recording.list", {}),
          );
          const recordings = response.data?.recordings;
          const entry = Array.isArray(recordings)
            ? recordings.find((item) => item?.name === name)
            : undefined;
          if (
            !entry ||
            typeof entry.outputPath !== "string" ||
            entry.finalized !== true
          ) {
            throw new MctError(
              {
                code: "RECORDING_NOT_FOUND",
                message: `Finalized recording '${name}' was not found for this client`,
              },
              3,
            );
          }
          const client = await new ClientInstanceManager(
            context.globalState,
          ).getClient(clientName);
          try {
            const outputPath = await verifiedRecordingPath(
              client.instanceDir,
              entry.outputPath,
            );
            return {
              ...entry,
              local: true,
              outputPath,
              url: pathToFileURL(outputPath).href,
              ...(options.probe
                ? { probe: await probeRecording(outputPath) }
                : {}),
            };
          } catch (error) {
            return {
              ...entry,
              local: false,
              guidance:
                "The mod's artifact is not accessible as a verified local recording. Inspect it on the game host using outputPath.",
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        },
      ),
    );

  return command;
}
