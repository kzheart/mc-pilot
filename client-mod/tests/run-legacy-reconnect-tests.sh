#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture="$root/tests/legacy-reconnect"
repo=$(CDPATH= cd -- "$root/.." && pwd)
cache=${MCT_TEST_CACHE_ROOT:-"$(dirname "$repo")/mcpilot-resourcepack/tmp"}
guava=${MCT_TEST_GUAVA_JAR:-"$cache/resourcepack-real/mct-cache/client/runtime/1.12.2/libraries/com/google/guava/guava/21.0/guava-21.0.jar"}
[ -f "$guava" ] || { echo "Missing Guava21 jar: $guava" >&2; exit 1; }
source=${MCT_RECONNECT_SOURCE:-"$root/shared/forge-1.12/java/com/mct/legacy/SessionActions.java"}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT HUP INT TERM
javac=${JAVA_HOME:+"$JAVA_HOME/bin/"}javac
java=${JAVA_HOME:+"$JAVA_HOME/bin/"}java
python3 "$fixture/extract.py" \
  "$source" \
  "$fixture/LegacyReconnectGuardTest.java.template" "$out/LegacyReconnectGuardTest.java"
"$javac" -encoding UTF-8 -source 8 -target 8 -Xlint:-options -cp "$guava" -d "$out" \
  "$root/shared/resourcepack-core/java/com/mct/core/resourcepack/ResourcePackPolicy.java" \
  "$root/shared/forge-1.12/java/com/mct/legacy/LegacyActionException.java" \
  "$fixture/java/net/minecraft/util/text/TextComponentString.java" \
  "$out/LegacyReconnectGuardTest.java"
if [ "${1:-}" = "--expect-red" ]; then
  if "$java" -cp "$out:$guava" LegacyReconnectGuardTest > "$out/result.log" 2>&1; then
    cat "$out/result.log"; echo 'Expected the pre-guard source to fail, but it passed' >&2; exit 1
  fi
  cat "$out/result.log"
  grep -q 'same-target race must construct one connector: expected 1, got 2' "$out/result.log"
  echo 'PASS expected red: exact production reconnect body constructed two connectors'
else
  "$java" -cp "$out:$guava" LegacyReconnectGuardTest
fi
