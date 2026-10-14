# Block-use hand feedback regression tests

Run from the repository root with a full JDK 17+ and Python 3:

```sh
python3 client-mod/tests/interaction-feedback/run-tests.py
```

If `javac` is not on PATH, set `JAVAC=/path/to/jdk/bin/javac`. The Java runtime
can be selected with `JAVA=/path/to/jdk/bin/java`. A compiler module alone in a
stripped JRE can lack `ct.sym`; use a full JDK when `--release` is unavailable.

The harness compiles the real shared `InteractionAdapter` interfaces and the
complete, unmodified interaction factory extracted from every version adapter.
It compiles the legacy `BlockInteractionFeedback` helper in full with Java 8
language/API targeting. Small Minecraft API-shaped doubles make feedback and
manager calls observable without downloading or starting a game.

It covers both hands; accepted/client-swing, consume, pass and fail results;
server-driven successes; a non-singleton modern client success; synthetic
accepted/no-item-used and unaccepted/swing enum combinations; empty, unchanged,
consumed and replaced held stacks; independent manager/player creative flags;
exactly one manager call; returned result identity; call ordering; equip hand;
and exception propagation without fabricated feedback. The original held-stack
reference is intentionally observed even if the manager replaces the hand item.

Source-wiring assertions check both block actions and sign editing use the
feedback entry point, legacy handlers use their helper, and all 27 declared
variants include the corresponding shared source tree.

These are focused behavior and source-wiring tests, **not** real Minecraft API
compilation, loader integration, visual animation verification, or a full
27-variant build. Compile the changed sources against the intended Minecraft
versions and verify a live client separately.
