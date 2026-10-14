import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkRecordingResponse,
  inspectFfmpeg,
  recordingStartParams,
  validateRecordingName,
  verifiedRecordingPath,
} from "./recording.js";

test("recording start uses safe 1080p30 defaults without optional name", () => {
  assert.deepEqual(recordingStartParams(undefined, {}), {
    width: 1920,
    height: 1080,
    fps: 30,
    maxDurationSeconds: 1800,
  });
  assert.deepEqual(
    recordingStartParams("shop-1_ok", {
      width: 1280,
      height: 720,
      fps: 60,
      maxDuration: 12,
    }),
    {
      name: "shop-1_ok",
      width: 1280,
      height: 720,
      fps: 60,
      maxDurationSeconds: 12,
    },
  );
});

test("recording name never accepts a path, extension, shell text or unsafe basename", () => {
  for (const name of [
    "",
    ".",
    "..",
    "../x",
    "CON",
    "com1",
    "LPT9",
    "/tmp/file",
    "a/b",
    "a\\b",
    "a.mp4",
    "-a",
    "a b",
    "a;touch x",
    "x\0",
    "a".repeat(81),
  ]) {
    assert.throws(() => validateRecordingName(name), {
      code: "INVALID_PARAMS",
    });
  }
  assert.equal(validateRecordingName("A".repeat(80)), "A".repeat(80));
});

test("recording options reject nonfinite, fractional, odd and out-of-budget values", () => {
  for (const options of [
    { width: 0 },
    { width: 1 },
    { width: 1921 },
    { width: 7682 },
    { height: 4322 },
    { height: 1079 },
    { height: Number.NaN },
    { fps: 0 },
    { fps: 121 },
    { fps: 29.97 },
    { fps: Infinity },
    { maxDuration: 0 },
    { maxDuration: 7201 },
    { maxDuration: 1.5 },
  ])
    assert.throws(() => recordingStartParams("safe", options), {
      code: "INVALID_PARAMS",
    });
});

test("recording responses surface failures instead of nesting them inside success", () => {
  const success = { success: true, data: { state: "recording" } };
  assert.equal(checkRecordingResponse(success), success);
  for (const error of [
    "INVALID_ACTION",
    "UNKNOWN_ACTION: recording.start",
    "Unknown action: recording.status",
    { code: "UNKNOWN_ACTION", message: "Unavailable" },
  ]) {
    assert.throws(
      () => checkRecordingResponse({ success: false, error }),
      (value: unknown) => {
        assert.equal((value as { code: string }).code, "RECORDING_UNSUPPORTED");
        assert.match(
          (value as Error).message,
          /restart.*Updating the CLI alone/s,
        );
        return true;
      },
    );
  }
  assert.throws(
    () =>
      checkRecordingResponse({
        success: false,
        error: "RECORDING_FFMPEG_UNAVAILABLE: executable missing",
      }),
    { code: "RECORDING_FFMPEG_UNAVAILABLE" },
  );
  assert.throws(
    () =>
      checkRecordingResponse({
        success: false,
        error: { code: "INVALID_PARAMS", message: "bad dimensions" },
      }),
    { code: "INVALID_PARAMS", exitCode: 4 },
  );
  assert.throws(() => checkRecordingResponse({}), { code: "INTERNAL_ERROR" });
});

test("artifact review confines access to finalized local files, including symlink containment", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-record-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "minecraft", "recordings");
  await mkdir(dir, { recursive: true });
  const good = path.join(dir, "good.mp4");
  const partial = path.join(dir, "bad.partial.mp4");
  const outside = path.join(root, "outside.mp4");
  await Promise.all(
    [good, partial, outside].map((file) => writeFile(file, "test")),
  );
  assert.equal(await verifiedRecordingPath(root, good), good);
  await assert.rejects(verifiedRecordingPath(root, partial), {
    code: "INVALID_PARAMS",
  });
  await assert.rejects(verifiedRecordingPath(root, outside), {
    code: "INVALID_PARAMS",
  });
  if (process.platform !== "win32") {
    const link = path.join(dir, "escape.mp4");
    await symlink(outside, link);
    await assert.rejects(verifiedRecordingPath(root, link), {
      code: "INVALID_PARAMS",
    });
  }
});

test("FFmpeg doctor reports missing executable without downloading", async () => {
  const result = await inspectFfmpeg(
    path.join(os.tmpdir(), "mct-does-not-exist", "ffmpeg"),
  );
  assert.equal(result.available, false);
  assert.equal(result.ready, false);
  assert.equal(result.downloaded, false);
  assert.match(result.guidance, /Install FFmpeg/);
});

test("FFmpeg doctor checks identity and libx264 with literal arguments", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-ffmpeg-doctor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "ffmpeg with spaces");
  await writeFile(
    executable,
    '#!/bin/sh\ncase "$1" in\n-version) echo "ffmpeg version test";;\n-hide_banner) echo " V....D libx264 H.264 encoder";;\nesac\n',
  );
  await chmod(executable, 0o755);
  const ready = await inspectFfmpeg(executable);
  assert.equal(ready.ready, true);
  assert.equal(ready.libx264, true);
  assert.equal(ready.scope, "cli-process");
  await writeFile(executable, '#!/bin/sh\necho "not ffmpeg"\n');
  assert.equal((await inspectFfmpeg(executable)).available, false);
  await writeFile(executable, '#!/bin/sh\necho "ffmpeg version no-h264"\n');
  const noEncoder = await inspectFfmpeg(executable);
  assert.equal(noEncoder.available, true);
  assert.equal(noEncoder.ready, false);
});

test("failed stop exits with recording diagnostics but status can inspect a failed session", () => {
  const response = {
    success: true,
    data: {
      state: "failed",
      finalized: false,
      error: "encoder exited",
      outputPath: "/game/recordings/test.mp4",
    },
  };
  assert.equal(checkRecordingResponse(response, "status"), response);
  assert.throws(() => checkRecordingResponse(response, "stop"), {
    code: "RECORDING_FAILED",
    message: "encoder exited",
  });
  assert.throws(
    () =>
      checkRecordingResponse({
        success: false,
        error: "RECORDING_FRAMEBUFFER_MISMATCH",
        details: { message: "Requested 1920x1080 but framebuffer is 1280x720" },
      }),
    {
      code: "RECORDING_FRAMEBUFFER_MISMATCH",
      message:
        "RECORDING_FRAMEBUFFER_MISMATCH: Requested 1920x1080 but framebuffer is 1280x720",
    },
  );
});
