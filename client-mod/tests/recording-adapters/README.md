# Recording render-adapter checks

Run `bash client-mod/tests/run-recording-adapter-tests.sh` with a JDK on PATH.
The tests compile as Java 8 and exercise the production shared PBO/GPU lifecycle
against deterministic fake native drivers. Both engine map API families run.
They verify:

- No allocations while idle; at most two PBOs or one GPU readback buffer
- No CPU mapping before fence/callback readiness
- Borrowed-frame release on saturation, stop, restart and native failures
- Stale callbacks cannot map canceled buffers or submit to a new session
- Bottom-up RGBA readback is converted to top-down rows
- Cleanup survives a lost GL context; metrics reset for each session
- A canceled GPU callback retains only one lightweight ticket until its fence drains,
  even after repeated stop/start; a stalled readback times out without another transfer

These are lifecycle tests, not real GPU or game tests. Real variant JAR builds
and runtime recordings remain necessary to validate engine mappings and hooks.

Production mapping families:

- Yarn 1.18.2–1.21.4: `Framebuffer.draw(int,int)` before presentation, LWJGL3 PBOs
- Yarn 1.21.11: `Framebuffer.blitToScreen`, engine fenced texture-to-buffer copy
- Official 26.1: `RenderTarget.blitToScreen`, engine command-encoder map API
- Official 26.2: tail of final `GameRenderer.render(DeltaTracker,boolean)`, buffer map API
- Forge 1.12.2: version-local `Framebuffer.framebufferRender(int,int)` transform before presentation, LWJGL2 PBOs

Core encoding/session sources are tested separately under `tests/recording`.
The existing WebSocket regression suite additionally checks recording-only error
messages without changing normal errors or socket/request lifecycle behavior.
