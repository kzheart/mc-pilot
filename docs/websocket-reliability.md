# WebSocket command reliability

## Lost game-thread callbacks

Minecraft's own executor is not a durable queue for commands from another
thread. In 26.1, `Minecraft.disconnect(Screen, boolean, boolean)` calls
`BlockableEventLoop.dropAllTasks()` when connected. That method clears its
pending runnable queue without completing the application futures waiting on
those runnables. The reconnect adapter invokes this path through
`ConnectScreen.startConnecting`.

Previously, each WebSocket decoder callback used `client.execute` to enqueue a
wrapper, then waited on a separate `CompletableFuture`. Two connections could
queue reconnect A and request B before the next frame. A cleared the native
queue; B never ran or completed. The CLI reported its 10-second response timeout
while the server still waited for its 30-second game-thread deadline.

Two requests on one socket are not an equivalent regression: Java-WebSocket
serializes that socket's decoder callbacks, hiding the competing queue entries.
Replies were already sent through the originating connection; this was not a
cross-connection response routing bug.

## Shared command mailbox

`shared/command-core/java/com/mct/core/concurrent/ClientTaskQueue.java` owns one
Minecraft-independent, Java 8-compatible mailbox. Both mapped `ActionHandler`
implementations and the legacy `MainThread` adapter call it. The existing Yarn
and official tick mixins, plus a small Forge 1.12 tick subscriber, drain it on the
client thread, including title screens and resource-pack prompts. Drain runs
before the sampler's player/world checks.

The mailbox is independent of the disposable native task queue. It does not
replay or retry requests. Each operation is a `FutureTask` and can start at most
once. A server-side deadline or interruption cancels and removes a pending task, so
resuming the client later cannot execute a command that expired on the server. The original wrapper did not
have that property: canceling its separate future still left `task.run()` queued.

The queue holds at most 1,024 pending operations. One drain processes at most 64
operations or 5 milliseconds, and nested drains do not recurse. These budgets
limit accumulated work; an individual operation that has already started cannot
be safely preempted or rolled back. Direct client-thread calls remain direct.
Existing default deadlines are unchanged. Interrupted waits restore the thread's
interrupt flag; main-thread deadline expiry reports `TIMEOUT` rather than a
misleading internal error.

This change does not serialize whole requests. Polling and wait commands still
release the main thread between individual observations. It also does not move
unrelated native resource-pack callbacks onto a new scheduler.

## CLI transport lifecycle and diagnostics

The CLI owns handshake, response and shutdown listeners in one lifecycle. A
closed connection immediately fails with the existing `CONNECTION_FAILED` code
instead of hanging until a fabricated timeout. Responses are correlated by
request ID. Unmatched IDs are ignored without resetting the deadline; invalid
response envelopes fail explicitly. A stalled close handshake is bounded.

Transport failures carry `details.phase` (`connect` or `response`), `requestId`,
`action`, URL, elapsed time and the configured timeout. `requestSent` and
`resultUnknown` distinguish a handshake failure from a submitted action whose
response was lost. Close failures additionally
include close code and reason. A timeout after unrelated response IDs records the
count and last unmatched ID. Request parameters are not included in diagnostics.
The request/response envelope and default timeouts are unchanged.

The CLI and server deadlines are separate. Modern main-thread calls retain a
30-second server deadline; the CLI's ordinary response deadline is 10 seconds.
A CLI timeout alone does **not** cancel a still-pending server operation. Such an
operation can start after the CLI has stopped waiting and before the server
budget expires. Legacy main-thread calls use their existing 10-second default;
network delay and earlier connection loss can still make the observed outcome
uncertain. This patch does not claim end-to-end cancellation on connection loss.
A small integration probe with Java-WebSocket 1.5.6 also showed that `onClose` can
be delayed while a decoder's `onMessage` retains the only available read buffer:
the selector cannot acquire a buffer to observe EOF until that callback returns.
Registering an `onClose` callback alone would not provide reliable cancellation.

The transport never retries an action automatically. A response timeout or
connection loss after submission leaves the outcome of an already-started action
unknown; inspect state before deciding whether to repeat a non-idempotent action.

A protocol response containing `error: "TIMEOUT"` is different from an outer
transport failure saying `Timed out waiting for response`. For example,
`gui.wait-update` captures its fingerprint when that wait request starts. If a
prior click has already changed the page, the new page becomes the baseline and
waiting for another change can legitimately expire. This is a separate
observation-order problem, not evidence that the WebSocket lost that command.

## Regression checks

- `sh client-mod/tests/run-client-task-tests.sh` runs deterministic Java 8-compatible
  tests for the old lost-future scenario, mailbox survival across native queue
  clearing, at-most-once execution, timeout/interruption cleanup, FIFO, nested
  drains, capacity, and frame budgets. Set `JAVA_HOME` if Java is not on PATH
- `node --test cli/dist/client/WebSocketClient.test.js`, after a normal CLI build,
  covers normal/abrupt close, handshake timeout, response timeout, malformed
  responses, unmatched IDs, independent simultaneous requests, and no retries
- `scripts/websocket-reconnect-diagnostic.mjs` is for a test-owned real client.
  It sends 16 parallel read-only status requests, repeated two-socket reconnects,
  a same-socket control, and optionally a pair of real CLI processes. It records
  request IDs and timestamps in `websocket-diagnostic.json`. Supply `--ws-url`,
  `--server-address`, and `--output-dir`; `--cli-path` and `--client` enable the
  CLI check. The harness may supply `--thread-dump-pid` only after verifying its
  exact still-running test JVM; a timeout then requests one SIGQUIT dump

Pure queue and transport tests establish the mechanism and lifecycle guarantees.
Loader startup, tick-hook application and resource-pack UI transitions still need
real-client coverage against rebuilt jars; old jars do not validate this fix.
