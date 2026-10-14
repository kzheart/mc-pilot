#!/usr/bin/env python3
"""Regression guard: ignored duplicate joins must not reset pack lifecycle state.

Vanilla 1.20.1–26.2 checks for an existing ConnectScreen before constructing its
replacement. Injecting at NEW preserves that early return; HEAD would erase the
active connection even though vanilla never starts another one. This is a static
source guard; runtime Mixin application is verified separately in client tests.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
def check_new_owner(source: str, label: str) -> None:
    imported = re.search(r"^import ([\w.]+\.ConnectScreen);$", source, re.MULTILINE)
    target = re.search(r'@At\(value = "NEW", target = "([^"]+)"\)', source)
    assert imported is not None and target is not None, label
    expected_owner = imported.group(1).replace(".", "/")
    assert target.group(1) == expected_owner, (label, target.group(1), expected_owner)
    assert 'argsOnly = true' in source and '@At("HEAD")' not in source, label


checks = 0
for version in ("1.20.1", "1.20.2", "1.20.4", "1.21.1", "1.21.4", "1.21.11"):
    source = (root / f"version-{version}/src/main/java/com/mct/mixin/ConnectScreenMixin.java").read_text()
    check_new_owner(source, version)
    checks += 1
source = (root / "shared/mixin-resourcepack-official/com/mct/mixin/ConnectScreenMixin.java").read_text()
check_new_owner(source, "official")
checks += 1
# 1.18.2 has no duplicate-join early return and intentionally retains HEAD.
source = (root / "version-1.18.2/src/main/java/com/mct/mixin/ConnectScreenMixin.java").read_text()
assert '@At("HEAD")' in source
# Legacy command-line joins may pass null; each version supplies only its typed constructor.
for version in ("1.18.2", "1.20.1", "1.20.2"):
    source = (root / f"version-{version}/src/main/java/com/mct/mixin/ConnectScreenMixin.java").read_text()
    assert "ServerAddress address, ServerInfo originalInfo" in source, version
    assert "ResourcePackSupport.prepareConnection(info, address," in source, version
    assert 'serverAddress -> new ServerInfo("MCT Auto Test", serverAddress,' in source, version
print(f"Resource-pack connection hook checks passed: {checks} guarded source sets; 3 nullable-entry adapters")
