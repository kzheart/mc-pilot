# Shared native recording core

This Java 8 source set has no Minecraft, OpenGL, JSON, or network dependencies. All client variants use the same encoder/session state machine; version-specific adapters only read their final native framebuffer.

## Adapter contract

- Use `RecordingController.getInstance()` for one recording per Minecraft process
- Update actual physical framebuffer dimensions and game directory with `updateSource(...)` every completed render; never substitute logical window dimensions on HiDPI displays
- Call `handle("recording.start|stop|status|list", params)` on the connection request worker, never on Minecraft's render/client thread
- `acquireFrame(System.nanoTime())` claims one CFR sampling opportunity and returns a pooled `Capture` or null immediately
- Fill `Capture.bytes` with top-down, tightly packed RGBA; its `width`, `height`, and `fps` are immutable session settings
- Call `submitFrame(capture, captureTimeNanos)` once, or `releaseFrame(capture)` once if unused. Submission always transfers ownership, even when false. Never access the byte array afterward
- Async callbacks use `isAccepting(capture)` and `signalFailure(capture, reason)` so old callbacks cannot affect a new session. `sessionId` lets adapters reset per-session metrics
- `cancel(reason)` is nonblocking and gracefully freezes/finalizes an active session. Invoke it on game shutdown, not ordinary WebSocket close or world disconnect. The core has a bounded JVM shutdown hook as a fallback
- `signalFailure(...)` immediately stops acquisition; an independent watchdog kills the encoder without waiting on its pipe-writing thread
- GPU buffers, pending readbacks, and GPU fences remain the adapter's responsibility. Update metrics and allocation state without calling the blocking command API

## Behavior and limits

Defaults are native 1920×1080 at 30 CFR, H.264/yuv420p MP4, no audio. Requested dimensions must exactly equal the actual framebuffer. There is no scaling, screenshot sequence, operating-system capture, or pixel transport over WebSocket.

The renderer may run at any FPS. Sampling is limited to the requested recording FPS; the encoder repeats the last capture for missing slots. The first capture fills startup delay. Thus sparse captures preserve wall-clock duration instead of speeding up playback. `rendererFps`, `capturedFps`, and encoded CFR `fps` describe different rates.

- Even dimensions from 2×2 up to 7680×4320, subject to the combined memory limit
- 1–120 FPS
- Six preallocated RGBA buffers, a four-frame queue, at most 256 MiB for the raw pool; 4K fits, 8K does not. GPU adapter allocations are additional and must also be bounded
- Default maximum duration 1800 seconds, configurable from 1–7200 seconds; reaching it gracefully finalizes with `stopReason: maximum_duration`
- 2 GiB FFmpeg output-size guard and 64 MiB free-space reserve checked before start and once per second. FFmpeg's size guard is approximate at the muxer boundary; size exhaustion can be a failed recording rather than a guaranteed complete movie
- First-frame deadline 15 seconds, blocked-pipe deadline 10 seconds, finalization deadline 20 seconds; shutdown uses a 2-second bounded wait
- Logs retain at most 8192 characters
- Finalized listing is capped at 1000 files and indicates truncation

Only `state: stopped` / `finalized: true` confirms a complete MP4. A failed recording can retain a hidden `.partial.mp4` for diagnosis. Output is first encoded to a same-directory temporary path; exclusive reservation prevents conflicting sessions. Final publication uses an atomic no-overwrite hard link where supported, and a `CREATE_NEW` copy otherwise. Names with reservation locks are never listed as complete, including interrupted fallback copies. Final public paths are never deleted automatically on failure, because Java 8 cannot safely unlink a path replaced by an external writer between an identity check and deletion. A leftover reservation must be recovered manually after confirming the associated recording/process is no longer active; use a new name to record immediately.

Names are 1–80 ASCII letters/digits/underscores/hyphens, start with a letter/digit, have no extension or path components, and exclude Windows device names. Output stays under the game's `recordings` directory and existing names are never overwritten.

FFmpeg is discovered on `PATH`, or selected using `-Dmct.record.ffmpeg=/absolute/path/ffmpeg` before launch. No protocol field can choose an executable, command, output path, codec, or FFmpeg options. Process launch never invokes a shell. `capabilities.ffmpegAvailable` means an executable was found; actual encoder/codec failure is surfaced by recording status. `lastControlError: {code,message}` preserves an actionable latest command failure and is cleared by a successful start.

Terminal sessions release the controller's reference to pooled images automatically; already-issued GPU captures retain their original owner until returned. Start/stop lifecycle cancellation is generation-checked, while status/list never cancel or take ownership of a recording.

## Tests

Run `JAVA_HOME=/path/to/jdk client-mod/tests/recording/run-tests.sh` from the repository root. The suite supports actual Java 8 or Java 9+ `--release 8`, requires FFmpeg/ffprobe with libx264 and Python 3, and creates no network traffic. Set `RECORDING_TEST_OUTPUT` to a fresh directory to keep media/evidence instead of automatic cleanup.

The standalone suite covers integer CFR boundaries, bounded ownership/pressure, strict configuration, output publication races, independent first-frame/stall/finalization deadlines, thread-creation/start rollback, cancellation during construction, automatic pool-owner release, lifecycle/resize/interrupt behavior, and stale GPU callbacks. Actual media is decoded and ffprobed, including native 1920×1080@30, channel order/top-down orientation, exact CFR frame count, sparse-capture duration, and no audio. These tests do not replace the separate game-renderer/runtime matrix.
