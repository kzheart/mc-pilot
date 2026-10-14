# Native client recording

`mct record` records Minecraft's own rendered framebuffer through the MC Pilot client mod. It works independently of desktop window capture permissions and does not use ScreenCaptureKit, OBS, screenshots over WebSocket, or an external OS recorder. FFmpeg is a local encoder process only. Output is **silent H.264 MP4**, with no audio stream.

The recording hooks cover all client variants listed by `mct client search`: Fabric, Forge and NeoForge, including Forge 1.12.2 and Minecraft 26.x. A matching recording-capable mod must actually be installed and running; the CLI cannot add recording support to an older mod. Build/runtime verification results belong to the test report rather than being inferred from the catalog.

## Use this unpublished build locally

This change is not a published npm/GitHub release. The CLI still reports version `0.19.0`, and the mod catalog retains the existing artifact versions/tags. Installing a current registry CLI or running `client create` without a matching local build can select an older released/cached mod without recording support.

A reproducible source install uses the supplied checkout and its lockfile:

```bash
cd /path/to/mc-pilot-source
npm ci --ignore-scripts
npm run build
node cli/dist/index.js record --help
node cli/dist/index.js schema
```

Use `node /absolute/path/to/mc-pilot-source/cli/dist/index.js` in place of `mct` below, or install the explicitly supplied local CLI tarball into your chosen prefix. Do not substitute a registry package and assume it contains this patch. A local package can be produced with `npm pack --workspace cli` after building; no publish step is needed. The packaged command, schemas and skill files are checked by the package tests.

Install the supplied **matching loader and Minecraft version JAR** into the stopped client's actual `gameDir/mods`, replacing its old MC Pilot JAR and keeping exactly one MC Pilot mod in that directory. For example, the tested Fabric 1.21.11 artifact is `client-mod/version-1.21.11/build/libs/mct-client-mod-fabric-1.21.11.jar`. Do not install a Fabric JAR into Forge/NeoForge or use a neighboring client version unless the catalog explicitly maps it.

For managed clients, `mct client list` exposes each instance's `env.MCT_CLIENT_MOD_JAR`; the launcher copies that configured source into the game directory. Update the configured source as well if it is different from the installed file, so the next launch cannot restore an older build. Stop recording and stop the client before replacing any JAR, then launch it and verify `mct record status` reports `supported: true`.

If creating a fresh client from a source checkout, the downloader first looks under `client-mod/[gradleBuild/]<gradleModule>/build/libs/` for the exact catalog artifact name. Run create from that checkout after building the selected variant and use a new instance name. Local build selection and launch-argument plumbing have automated tests; the separate runtime report records which real Minecraft create/launch routes were actually exercised. The native-recording runtime test also verifies the simpler route of installing the exact built JAR directly into `gameDir/mods` before launch.

## Setup and first recording

Install FFmpeg with `libx264` using a trusted OS package manager or a distribution linked by [FFmpeg](https://ffmpeg.org/download.html). Nothing is downloaded or installed automatically by the recording commands. Discover an existing installation:

```bash
mct record doctor
mct record doctor --ffmpeg /absolute/path/to/ffmpeg
```

The doctor runs bounded, argument-array-only `-version` and `-encoders` checks. Its `scope: "cli-process"` is deliberate: finding FFmpeg in the CLI's environment does not prove that the running game can find it. Always inspect the game's capability separately:

```bash
mct record status --client <client>
```

The game uses the local JVM property `-Dmct.record.ffmpeg=/absolute/path/to/ffmpeg`, falling back to `ffmpeg` on its own PATH. You can configure this when creating a client (saved with the instance) or for one launch:

```bash
mct client create <client> --version <supported-version> \
  --width 1920 --height 1080 --record-ffmpeg /absolute/path/to/ffmpeg
mct client launch <client> --width 1920 --height 1080 \
  --record-ffmpeg /absolute/path/to/ffmpeg
```

`MCT_RECORD_FFMPEG` is also forwarded as that JVM property by both packaged and repository launchers. Executable configuration is local launch configuration, never a WebSocket recording parameter. A changed PATH or executable setting requires restarting an already-running client.

Window size is changed only when explicitly configured. `--width` and `--height` must be given together; a create setting persists, a launch override applies to that launch. On HiDPI displays the framebuffer can differ from the logical window size. Check `sourceWidth` and `sourceHeight` from the mod and adjust the actual window as necessary.

```bash
mct record start shop-demo --client <client>
# Run normal mct actions; record start exits while the mod keeps recording
mct gui info --client <client>
mct record status --client <client>
mct record stop --client <client>
mct record list --client <client>
mct record view shop-demo --client <client> --probe
```

A world is not required: title screens and in-game menus can also be recorded when the render backend is available. The usual `--client` selection, active profile, and default-client resolution apply. No project directory is required.

## Native dimensions, frame rate and bounds

Start accepts an optional name plus:

| Option | Default | Allowed |
| --- | --- | --- |
| `--width` | 1920 | Even integer, 2–7680 |
| `--height` | 1080 | Even integer, 2–4320 |
| `--fps` | 30 | Integer, 1–120 |
| `--max-duration` | 1800 seconds | Integer, 1–7200 |
| `--timeout` | At least 30 seconds | Transport timeout, not recording duration |

The requested width and height **must match the actual framebuffer**. A smaller framebuffer is never enlarged to claim 1080p. A mismatch reports `RECORDING_FRAMEBUFFER_MISMATCH`: resize the actual game, or explicitly request the dimensions reported by status, for example `mct record start demo --width 1280 --height 720`. The default command does not silently resize a window. A resize during recording ends that session rather than mixing resolutions.

Memory is bounded by a 256 MiB frame-buffer budget; the combined width and height can be rejected even if each individual value is in range. The maximum output budget is 2 GiB, and recordings stop at the selected duration or another recorder limit. Slow encoding must not create an unbounded queue or freeze command dispatch.

`fps` is the requested constant-frame-rate (CFR) MP4 rate. It is not proof of 30 distinct frames being captured every second. Inspect:

- `capturedFps`: actual fresh framebuffer samples divided by elapsed recording wall-clock seconds (not an estimate of game render rate)
- `captured`, `encoded`, `duplicate`, `dropped`: real capture/encoding counts, including CFR repeated frames and dropped work
- `rendererFps`: the game's render-rate estimate, separate from capture rate
- `width`, `height`, `sourceWidth`, `sourceHeight`, `upscaled: false`, `audio: false`

Report a 30 fps container and a lower actual capture rate separately. Do not describe duplicated frames as distinct 30 fps capture.

## Completion, storage and review

The lifecycle is `idle`, `starting`, `recording`, `stopping`, `stopped`, or `failed`. Start acknowledges a running encoder and can succeed before the first frame has arrived. Verify that `captured` increases and that no `error` appears before relying on the session; startup has a bounded first-frame deadline. A successful stop waits for encoder finalization. Use an artifact only after `state: "stopped"` and `finalized: true`; a failed or incomplete file is not a finished recording. Stop's CLI timeout defaults to at least 60 seconds.

The mod chooses `<gameDir>/recordings/<name>.mp4`. For managed clients this is normally `~/.mct/clients/<client>/minecraft/recordings/`. The returned `outputPath` is authoritative and belongs to the game host, not the current project. Temporary `.partial.mp4` files are not listed as finished videos. Existing files are never overwritten.

Names are 1–80 ASCII letters, digits, underscores or hyphens, beginning with a letter or digit. Do not supply a directory or `.mp4` extension; Windows device names are rejected. If omitted, the mod generates a name.

`record view <name>` resolves a finalized entry from the selected mod's list and returns a verified local `file:` URL. It does not open another application automatically, execute paths from the response, or expose a local HTTP server. If the file is not safely accessible inside that local client's recordings directory, it returns `local: false` with the game-host path and guidance. `--probe` uses an already-installed local `ffprobe` when possible, reporting whether the inspection succeeded.

For independent media verification:

```bash
ffprobe -v error -show_streams -show_format -of json /returned/outputPath.mp4
```

Check H.264 video, actual width/height, duration, stream frame rate, and absence of audio. Then play the MP4 or inspect decoded frames for the intended visual behavior. Container metadata cannot establish distinct captured FPS; retain the mod's final status for that.

`lastControlError` is supplementary: null or `{code, message}` for the latest rejected control command, cleared by a successful start. For example, rejecting a second start does not fail the already-running recording. Session failure is reported by `state` and `error`.

## Errors and lifecycle ownership

- `RECORDING_UNSUPPORTED`: install the matching recording-capable MC Pilot mod and restart. Updating only the CLI does not change the running mod. `mct client search` helps resolve the version/loader, and `mct record status` confirms actual support.
- `RECORDING_FFMPEG_UNAVAILABLE` / `RECORDING_START_FAILED`: inspect the game's encoder capability and logs, install a suitable local FFmpeg explicitly, configure its executable, and restart.
- `RECORDING_FRAMEBUFFER_MISMATCH` / `RECORDING_SOURCE_UNAVAILABLE`: inspect native dimensions and render-backend support. This is not permission to fall back to desktop capture.
- `RECORDING_ALREADY_ACTIVE`: inspect the existing session, then stop it before starting another.
- `RECORDING_FILE_EXISTS`: choose a fresh name. There is no overwrite flag.
- `TIMEOUT` or a connection closing after start was sent: the result is uncertain. Query status before deciding what to do; never blindly retry a mutating request.

Recordings survive normal one-shot CLI WebSocket disconnects. Stop the recording and verify finalization before `mct down`, client shutdown, or test cleanup. Abrupt process termination can leave an unfinalized partial file. Duration/size limits provide bounds, but are not a substitute for explicit stop and artifact verification.

## Protocol

The four control-plane actions are `recording.start`, `recording.stop`, `recording.status`, and `recording.list`. Their schema and capabilities are included in `mct schema`, canonical `protocol/actions.json`, and the packaged protocol copy. No video frames travel over WebSocket. Start accepts only `name`, `width`, `height`, `fps`, and `maxDurationSeconds`; arbitrary output paths, encoder commands, filters, and executable arguments are rejected.
