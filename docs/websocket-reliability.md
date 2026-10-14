# WebSocket command reliability

## Two independent transport failures

Minecraft's executor is not a durable queue for commands from another thread.
In 26.1, `Minecraft.disconnect(Screen, boolean, boolean)` calls
`BlockableEventLoop.dropAllTasks()` when connected. That method clears pending
runnables without completing application futures waiting on them. Yarn 1.20.4
has the equivalent `disconnect` → `cancelTasks` → `tasks.clear` path.

Previously, two WebSocket connections could enqueue reconnect A and request B
before the next frame. A cleared the native queue; B never ran or completed.
The CLI reached its 10-second response deadline while the server still waited
for its 30-second game-thread deadline. A same-socket-only test masked the race
because the old decoder callback serialized that socket's requests.

Separately, Java-WebSocket 1.5.6 invokes `onMessage` synchronously while holding a
read buffer. A blocking command can retain the only buffer allocated for a fresh
connection, leaving the selector blocked in `takeBuffer` and unable to observe
other connections or even TCP EOF. A spare buffer can mask that problem; merely
adding an `onClose` callback does not fix it. Actual Java-WebSocket/Node probes
confirmed both the fresh and warmed-buffer cases.

Replies were already routed to their originating socket. These bugs were not a
shared-response-socket mix-up.

## Shared bounded dispatch

`ConnectionRequestDispatcher` owns four daemon command workers, at most 64
connection lanes and 16 pending requests per lane. Accepted actions execute FIFO
within their connection. Each ready lane receives one turn before rejoining the
bounded ready queue. Polling/wait actions on one connection leave other workers
available. Saturation returns `CLIENT_BUSY` with the rejected request's ID; that
request is never executed. Responses and immediate admission errors may arrive
out of order and must be matched by ID.

A single periodic watchdog scans the bounded job set. There is no timer or
unbounded executor queue created per request. The shared `WebSocketRequestService`
handles JSON validation, budgets, error mapping and response framing. Yarn,
official and legacy adapters provide only action execution, event pointers,
frame writes and lifecycle hooks. Handshake validation precedes request admission.

Modern `onMessage` returns after validation and enqueueing, releasing the library
read buffer. Legacy frame readers likewise remain available while commands run;
its writers use a 64-frame/4-MiB queue so one active plus 16 accepted replies and
control frames fit without a scheduling-dependent false overload. A slow peer cannot occupy a command
worker or watchdog. Reader/writer counts are bounded by the connection limit.
Incomplete legacy handshakes expire. At an exhausted outgoing transport buffer,
the connection is closed; already submitted outcomes may be unknown.

Connection close removes pending requests and interrupts the worker waiting for
that connection. Worker ownership is synchronized before interrupting, and the
interrupt flag is cleared before reuse. Close never waits for a response callback
or holds a dispatcher lock while calling transport code, avoiding inversion with
WebSocket close monitors. An already-claimed send must still check connection
state. Server shutdown cancels its queues and closes its owned workers/connections.
An action already running on the Minecraft thread cannot be safely preempted or
rolled back.

## Durable game-thread mailbox

`ClientTaskQueue` is a separate Minecraft-independent, Java 8-compatible mailbox.
Both mapped `ActionHandler` implementations and legacy `MainThread` call it. The
existing Yarn/official tick mixins and a small Forge 1.12 tick subscriber drain it
on the client thread, including title screens and resource-pack prompts. Drain
runs before the sampler's player/world checks.

Each operation is a `FutureTask` and starts at most once. A server-side deadline
or worker interruption cancels and removes an unstarted task, preventing it from
executing when the client resumes. This is cancellation, not retry or replay. The
old separate `CompletableFuture` wrapper could still execute its side effect even
if only that future was canceled.

The mailbox holds at most 1,024 operations; a drain handles at most 64 operations
or 5 milliseconds and guards against recursive draining. These limits bound
accumulated work, not an individual operation already running. Direct
client-thread calls remain direct. Polling commands release the client thread
between observations. Unrelated native resource-pack callbacks retain their
native scheduling.

On Forge 1.12, the native scheduled-task queue also runs callbacks while holding
its queue monitor. Calling `closeChannel().awaitUninterruptibly()` under that
monitor can conflict with Netty enqueueing a packet under the same monitor.
Draining the command mailbox from END tick runs outside that monitor. A bounded
lock-order probe demonstrates the hazard; an earlier live timeout without a
thread dump cannot by itself establish that historical stack.

## Cancellation-safe temporary input and resources

Interrupting an old press → wait → release sequence could skip release. Temporary
keys, movement helpers, modifiers, clicks and drags now acquire a shared physical
control lease before pressing, and close it in finally, including partial-acquire
failures. There are at most 64 retained scopes and 128 controls per scope; capacity
is reserved before effects and exhaustion returns `CLIENT_BUSY`.

The main tick drains closed leases independently of canceled request futures and
ordinary mailbox saturation. Cancellation only marks cleanup, so the command
worker does not wait for a paused game. A normal completed action synchronously
drains its cleanup before returning, preserving repeated key/click behavior.
Overlapping temporary holders cannot release one another. Explicit key-down,
sneak and sprint intent is retained separately from temporary ownership. Key,
scancode and mouse identities use resolved bindings, including aliases and mouse
remaps. All adapters share bookkeeping for a physical control. Native physical
input changed by a human while an automated hold is active is not attributed to
individual owners; these guarantees cover synthetic command ownership and the
state observed at acquisition, not arbitrary simultaneous manual input changes.

Cleanup failures retain bounded ownership records for a later tick and emit a
warning rather than silently abandoning a held control. Server shutdown marks
all scopes closed; a continuing client tick releases them. No code forces game
callbacks after the game thread itself has stopped. Legacy GUI drag cleanup is
tied to its original screen and tolerates that screen being replaced. Cleanup
releases temporary input state, not already-sent game actions or inventory/world
changes.

A canceled screenshot waiter also owns an image that may be produced by an
already-started render callback. `AsyncResource` closes an unclaimed late result
exactly once, while normal successful consumers retain responsibility for their
claimed image. It creates no threads, queues or retries.

## Budgets and compatibility

New CLI requests optionally include `timeoutMs`, an integer from 1 through
86,400,000. This is a relative server budget measured with a monotonic clock from
receipt, including parsing, queueing and execution waiting. It makes no assumption
that client and server wall clocks match. Invalid, negative, fractional,
non-finite and oversized budgets are rejected before command execution. Numeric
tokens are limited to 64 characters and decimal scale to -8 through 64 before
exact integer conversion, avoiding unbounded allocation for hostile exponents.

Old clients omit this field. Their new dispatcher queue wait is bounded by the
era's existing main-thread default (legacy 10 seconds, modern 30 seconds), while
execution retains the original handler-specific limits. An old `wait.perform`
or GUI wait therefore is not silently shortened to a new whole-request default.
Old mods ignore the new optional field. Existing IDs, success/data/error fields
and native action error strings remain compatible; failures may additionally
include `details.phase` and `details.resultUnknown`.

A server-relative budget is not an end-to-end cancellation acknowledgement. A
client can time out while its request is in transit or after an action started.
Disconnect cancellation takes effect when the server observes the close. The
transport never retries automatically. Inspect resulting state before deciding
whether to repeat a non-idempotent action.

## CLI lifecycle and diagnostics

The CLI owns handshake, response and shutdown listeners in one lifecycle. A
closed connection fails with `CONNECTION_FAILED` immediately instead of waiting
for a fabricated timeout. Only matching response IDs complete a request;
unmatched IDs do not reset the deadline. Invalid envelopes fail explicitly, and
an unacknowledged close handshake is bounded.

Transport errors include phase (`connect` or `response`), request ID, action,
URL, elapsed time, configured timeout, `requestSent` and `resultUnknown`. Close
errors include close code and reason. Timeout after unmatched responses includes
the count and last unmatched ID. Request parameters are not copied into errors.

A received protocol response containing `error: "TIMEOUT"` differs from an outer
transport error saying `Timed out waiting for response`. `gui.wait-update`, for
example, captures its fingerprint when the wait starts. A click that already
changed the page can become the baseline, so waiting for a further change can
expire even though a subsequent snapshot shows the intended page. That is an
observation-order issue, not proof of a missing WebSocket response.

## Legacy reconnect while a connection is in progress

Forge 1.12 reconnect has two main-thread phases, separated by native disconnect
processing. Separate sockets can otherwise interleave these phases and create
two `GuiConnecting` instances. Its constructor can synchronously clear a server
resource pack and reload Forge models. Real-client thread dumps showed this
reload running, not a transport deadlock; a sufficiently slow first reload can
still exceed a request budget and leave its started result unknown.

Both phases now inspect the native connecting screen. The same canonical target
and compatible policy reuse it and return `alreadyConnecting: true`, without
resetting resource-pack override or pending state. An explicit conflicting or
unknown policy, a different target, or an unknown current target returns
`INVALID_STATE`. Wait for that connection to finish or explicitly disconnect
before changing targets. This does not cancel an already-started native connector.
Host names, default ports and literal IPv6 addresses are normalized without DNS.
A failed five-second disconnect poll returns `TIMEOUT` before a new connector or
policy override is created. Once the native screen has changed after failure,
an explicit retry is allowed; no persistent connecting flag blocks it.

## Regression checks

- `sh client-mod/tests/run-client-task-tests.sh`: lost-native-queue red proof,
  mailbox survival, timeout/interruption cleanup, FIFO, at-most-once execution,
  nested drains, capacity and frame budgets
- `sh client-mod/tests/run-connection-request-tests.sh`: bounded dispatch,
  fairness, concurrent connections, admission saturation, receipt-based deadlines,
  old-client queue-only budgets, close cancellation, interrupt ownership, external
  monitor inversion and shutdown cleanup
- `sh client-mod/tests/run-temporary-input-tests.sh`: cancellation, partial press,
  paused-tick cleanup, overlapping aliases, persistent intent, limits and shutdown
- `sh client-mod/tests/run-legacy-reconnect-tests.sh`: exact production method
  extraction, two-worker duplicate red/green, target/policy conflicts, no reset
  on skips, address normalization and failed disconnect polling
- `sh client-mod/tests/run-async-resource-tests.sh`: late resource ownership,
  cancellation/completion races, exactly-once close and normal ownership transfer
- `node --test cli/dist/client/WebSocketClient.test.js`, after a CLI build:
  normal/abrupt close, handshake/response timeouts, IDs, malformed responses,
  protocol-vs-transport errors, relative budgets and no retries
- `bash client-mod/tests/run-websocket-regression-tests.sh`: actual Yarn,
  official and legacy server wrappers on Java 8 and 25, real sockets, fresh-buffer
  isolation, deadlines, close cancellation, large frames and shutdown cleanup
- `scripts/websocket-dispatch-diagnostic.mjs`: test-owned real-client long waits,
  second-socket responsiveness, admission backpressure, correlated deadlines and
  graceful/abrupt-close worker reclamation, temporary input cancellation,
  overlapping/persistent holds, partial combos and canceled inventory-screen drags
- `scripts/websocket-input-effects-diagnostic.mjs`: test-owned real-client
  movement starts then stops after close, repeated inventory key toggles and
  cursor-stack pickup/return, without using key resets to conceal cleanup failures
- `scripts/websocket-reconnect-diagnostic.mjs`: test-owned real-client status
  concurrency, separate-socket reconnect races, same-socket control and real CLI
  concurrency with correlated timestamps. It is not for production clients

Set `JAVA_HOME` if Java is absent from PATH. Exact-wrapper WebSocket integration
and rebuilt real-client loader tests complement the pure Java tests. Old native
jars do not validate changes to dispatch or tick hooks.
