# Real WebSocket dispatch regression tests

Run from the repository root:

```sh
client-mod/tests/run-websocket-regression-tests.sh
```

The script compiles the **unchanged production** Yarn, official-mappings, and
legacy WebSocket servers, shared request service, connection dispatcher, client
task queue, and legacy router. Only Minecraft, ActionDispatcher, and EventRecorder
are substituted with tiny test boundaries. Node's real `ws` client connects over
loopback TCP. Modern adapters use the actual cached Java-WebSocket 1.5.6 jar.
Each of the three adapters runs on JDK 8 and JDK 25; all sources are compiled with
JDK 8. A single reported CPU deliberately restricts the modern library to one
WebSocket decoder, so a synchronous/blocking transport regression is exposed.

The fake game has a scheduled main thread and controllable pause/resume and
operation gates. Tests cover:

- A blocked **first-ever** socket, without warming Java-WebSocket's buffers, while
  a second socket completes its handshake and action
- Per-connection FIFO execution, matching IDs, and exactly one response per ID
- A 16-request pending lane, immediate `CLIENT_BUSY` rejection for eight excess
  requests, and continued service on another socket
- Explicit queued/executing deadlines, their phase and result-unknown metadata,
  and cancellation of a worker's not-yet-started main-thread task
- Negative, zero, fractional (including precision-hidden fractions), NaN,
  overflow, huge exponents, overlong numeric tokens, out-of-range and wrong-type budgets,
  rejected before actions run
- Old requests without `timeoutMs`: handlers keep running beyond the queue budget
- Graceful WebSocket close and abrupt TCP termination canceling both queued game
  tasks and queued per-connection actions without side effects
- Already-started game-thread effects completing without interruption after a
  timeout or either kind of close
- A deterministically paused legacy writer: all seventeen normally admitted
  responses fit, the queue remains capped at 64 frames, and its 4 MiB payload
  budget includes the in-flight frame (no production test hooks or real sockets)
- A 100,000-byte response (exercises the legacy 64-bit frame length) interleaved
  with eight ping/pong frames
- Shutdown with live sockets and a pending main-thread task; sockets close,
  canceled work does not execute, and dispatcher/legacy transport threads exit

To keep tests fast, the harness changes each instance's default **queue-only**
budget to 80ms by reflection; production source files are never rewritten. The
old-client handler is then held for 140ms to prove missing-budget compatibility.
Explicit request deadlines remain the production implementation.

The runner only creates a temporary compilation directory, its own child JVMs,
and loopback connections. It never touches a running game, distribution jar,
Gradle build, or original checkout. Time bounds fail stalled operations; final
cleanup terminates only a test-owned JVM if it does not exit promptly.

## Dependency locations

The default dependency locations reuse the investigation's read-only sibling
cache at `../mcpilot-resourcepack/tmp`. Override them for another checkout/CI:

- `MCT_TEST_CACHE_ROOT`: cache root containing `resourcepack-matrix` and
  `resourcepack-real`
- `MCT_TEST_JAVA8_HOME`, `MCT_TEST_JAVA25_HOME`: local JDK directories
- `MCT_TEST_WEBSOCKET_JAR`: Java-WebSocket 1.5.6 jar
- `MCT_TEST_GSON_JAR`: Gson jar (tested with 2.10.1)
- `MCT_TEST_SLF4J_JAR`: slf4j-api jar (tested with 2.0.9)

Node 20+ and the repository's installed `ws` dependency are required. No network
installation is performed. These are transport/lifecycle integration tests,
not a full Minecraft/Forge/Fabric build or an in-game acceptance test.
