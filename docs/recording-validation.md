# Native recording and hand-feedback validation

Validated 2026-10-14. This report distinguishes the earlier silent-recording baseline from the later hand-feedback fix and opt-in game-audio prototype. These source changes are published in CLI `0.20.0` and Mod `0.10.0`; publication does not broaden the live-validation scope below.

## Provenance and scope

- The recording baseline was based on upstream `0a9438f738b760ca4fd3de20e6cfaa8037602335` and completed at `7b0d84c122c5ba9cad4b7b28fb5a59fd8a763ae0`. It retained previously unpublished, validated command-queue, WebSocket, temporary-input and resource-pack fixes, then added native recording and loader-specific corrections
- The delivered test bundle retained `0.19.0`. Before source publication, the changes were rebased onto upstream `9e3362f22a6e1f6ac8ee1945ee095d5253b1dc44`, preserving its `0.19.1` version and client-cleanup reminders. The subsequent release bumps the CLI to `0.20.0` and catalog artifacts to Mod `0.10.0`, including the legacy Forge release tag. A CLI upgrade alone does not replace existing client JARs; use the [release installation instructions](recording.md#install-the-released-recording-build).
- All 27 catalog Minecraft/loader variants received real-game **silent-video** recording checks against that earlier baseline. That result predates the final hand-feedback and audio changes and is not a 27-variant validation of the latest source
- The later hand-feedback fix is wired across all 27 variants. Before release, the reported complete build and live audiovisual demonstration covered **Fabric 1.20.1 only**. The release workflow builds all 27 variants; Forge/NeoForge 1.20.1 inherit the audio source but have not received corresponding live audio/runtime validation. Other Minecraft versions do not claim game-audio support.

## Hand-feedback regression coverage

Block interaction, placement and sign editing now apply vanilla's result-aware client hand swing and held-item equip feedback after exactly one interaction-manager call. The original interaction result and original held-stack reference are preserved; pass, fail, consume and server-driven swing outcomes do not receive fabricated client swings.

The focused harness passed **12,672 behavior scenarios and 10 exception-propagation checks**. It compiles the real interaction interfaces/factories or legacy helper against small Minecraft API-shaped doubles. Cases cover both hands, result variants, creative/infinite-material checks, unchanged/consumed/replaced stacks, call count and ordering, original result identity and exception behavior. Source-wiring checks cover all 27 declared variants.

These are focused behavior tests, not a substitute for full Minecraft API builds or live validation of all variants. Run them from the repository root using a full JDK 17+:

```sh
python3 client-mod/tests/interaction-feedback/run-tests.py
```

The separate `block.break` swing omission and unsuccessful-placement polling behavior were not changed by this fix.

## Continuous Fabric 1.20.1 audiovisual sample

The Linux cloud sample shows one continuous session: approach a cottage, open the door, enter, open a chest, collect planks with actual GUI mouse input, leave, close the door and place two blocks. Scene construction and player reset occurred before recording. There were no teleports, console/world-edit commands, cuts, speed changes, external audio or reconstructed sounds during the recorded session.

| Measurement | Result |
| --- | --- |
| Video | Native 1920×1080 H.264, 30 fps CFR |
| Duration | 61.533 seconds |
| Output frames | 1,846 |
| Fresh captured frames | 1,651; `capturedFps` 26.84 |
| Repeated frames | 195, or 10.56% of output slots |
| Dropped video frames | 0 |
| Audio | Actual game mix, AAC stereo, 48 kHz |
| Nonzero source sample frames | 1,545,793 |
| Dropped source sample frames | 0 |
| Video/audio duration difference | 0.333 ms |

Fresh capture rate is measured against the recorder's 61.512-second monotonic interval; CFR output rounds to 61.533 seconds. A 30 fps container therefore does not imply 30 distinct captured frames per second. The cloud renderer was Mesa llvmpipe, so these results are not a hardware-GPU performance guarantee.

The final deliverable was recompressed to 18,557,489 bytes while retaining all video timestamps and frame count and copying the AAC payload byte-for-byte. Complete media decode passed. Its SHA256 is `48edc2fe1f4fa71218bae67808e80f6524a5ba07915a131844dc6a1305a83e25`.

Five measured events had sound preceding the first changed video frame by **14.7, 5.3, 50.3, 11 and 45 ms**; all measured offsets were below 51 ms, with no growing drift evident in this sample. Visual granularity was 33.33 ms and audio onset used a −60 dBFS RMS threshold. These measurements are evidence for those events, not a universal synchronization guarantee or subjective listening assessment.

## Audio setup and verification limits

Audio is opt-in with the game JVM argument `-Dmct.record.audio=true` **before game startup**. Keep in-game audio unmuted (`client create/launch --no-mute` for managed clients). The prototype captures Minecraft's genuine OpenAL mix, never microphone or desktop/system audio. See [audio setup and status checks](recording.md#opt-in-game-audio-prototype-1201).

The ordinary-playback tee used OpenAL's null output backend in the cloud test. No physical speaker playback, hardware audio-device behavior, subjective listening quality, macOS audio or Windows audio verification is claimed.

Additional recording checks passed 26 shared-core tests, eight audio scenario groups with decoded-media checks, and native OpenAL mix/context/clock/timeout tests. Synthetic PCM fixtures establish recorder plumbing only; the continuous game sample separately establishes real game-mix provenance. Final authored-source/build comparison covered 215 files with no mismatches. A second cold download/build of the reproduction package was not performed.

To rerun the repository's shared recording/media regressions with a JDK, FFmpeg and ffprobe installed:

```sh
sh client-mod/tests/recording/run-tests.sh
bash client-mod/tests/run-recording-adapter-tests.sh
```

Inspect final status, decode the complete MP4 and check actual visual/audio events before making a new validation claim. Retain `capturedFps`, duplicate/drop counts, audio sample statistics and finalization results alongside media metadata.
