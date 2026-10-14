# Legacy reconnect race regression

Run with either Java 8 or Java 25:

```sh
JAVA_HOME=/path/to/jdk client-mod/tests/run-legacy-reconnect-tests.sh
```

This is a focused, pure-Java test, not a Minecraft launch or native build.
`extract.py` copies `reconnectClient`, `isConnectingTo`, and `canonicalAddress`
and their native-screen/policy state fields
**verbatim from the current production SessionActions.java** into a generated
fixture in a temporary directory. It does not rewrite their implementation.
Balanced-brace extraction accounts for strings and comments. Each run prints
SHA-256 hashes of the complete source snapshot and extracted method/state text.

The fixture replaces only the surrounding game boundaries:

- One fake Minecraft main executor serializes every `onClient` callback
- Two command workers synchronize at a barrier after fake disconnect polling,
  guaranteeing both pass the entry check before competing at the final callback
- A fake `GuiConnecting` constructor counts native connection attempts and
  installs matching current-server data
- Tiny Params, JsonObject, player/network, and resource-pack fakes record calls
  and reject game operations made off the fake main thread
- Production `ResourcePackPolicy` and the actual Guava 21 jar are compiled/used

Assertions cover the concurrent same-target race, existing connecting state,
different targets, retry from a failed screen despite matching remembered server
data, missing/malformed remembered addresses, default port, host case, IDN and
IPv6 equivalence, invalid input, and preserving pack policy/pending state when a
duplicate is skipped. Explicit policy conflicts are checked both at entry and in
a synchronized two-worker final-callback race; unknown external screen policy is
never silently overridden. A false disconnect-poll result must produce TIMEOUT
before policy/constructor changes, while an intervening same-target native
connection can satisfy the poll even before the old world becomes null. The existing five-second production disconnect-poll budget
is asserted unchanged. The constructor count is a deterministic proxy for avoiding
a second native connect/model-reload path; real Forge reload latency is not modeled.

The runner requires a local Guava 21 jar. Set `MCT_TEST_GUAVA_JAR`, or use
`MCT_TEST_CACHE_ROOT` for the existing cache layout. No download is performed.

## Exact pre-fix red baseline

Point the read-only source override at an old SessionActions.java:

```sh
MCT_RECONNECT_SOURCE=/path/to/old/SessionActions.java \
JAVA_HOME=/path/to/jdk \
client-mod/tests/run-legacy-reconnect-tests.sh --expect-red
```

The old reconnect method is still extracted verbatim; absent new helper methods
and state fields are omitted. The same forced race must fail specifically with two constructors
instead of one. `--expect-red` treats a green result or a different failure as an
error. Neither source tree is modified, and only test-owned executors are created.
