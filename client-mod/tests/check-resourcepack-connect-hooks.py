#!/usr/bin/env python3
"""Regression guard: ignored duplicate joins must not reset pack lifecycle state.

Vanilla 1.20.1–26.2 checks for an existing ConnectScreen before constructing its
replacement. Injecting at NEW preserves that early return; HEAD would erase the
active connection even though vanilla never starts another one. This is a static
source guard; runtime Mixin application is verified separately in client tests.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
checks = 0
for version in ("1.20.1", "1.20.2", "1.20.4", "1.21.1", "1.21.4", "1.21.11"):
    source = (root / f"version-{version}/src/main/java/com/mct/mixin/ConnectScreenMixin.java").read_text()
    assert '@At(value = "NEW", target = "net/minecraft/client/gui/screen/multiplayer/ConnectScreen")' in source, version
    assert 'argsOnly = true' in source and '@At("HEAD")' not in source, version
    checks += 1
source = (root / "shared/mixin-resourcepack-official/com/mct/mixin/ConnectScreenMixin.java").read_text()
assert '@At(value = "NEW", target = "net/minecraft/client/gui/screens/ConnectScreen")' in source
assert 'argsOnly = true' in source and '@At("HEAD")' not in source
checks += 1
# 1.18.2 has no duplicate-join early return and intentionally retains HEAD.
source = (root / "version-1.18.2/src/main/java/com/mct/mixin/ConnectScreenMixin.java").read_text()
assert '@At("HEAD")' in source
print(f"Resource-pack duplicate-join hook checks passed: {checks} guarded source sets; 1.18.2 unchanged")
