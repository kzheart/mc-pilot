#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
fixtures="$root/client-mod/tests/websocket-regression"
# Optional overrides let CI supply its own JDKs/jars without downloading or touching a game install.
cache=${MCT_TEST_CACHE_ROOT:-"$(dirname "$root")/mcpilot-resourcepack/tmp"}
java8=${MCT_TEST_JAVA8_HOME:-"$cache/resourcepack-matrix/provision/jdk8/jdk8u504-b01"}
java25=${MCT_TEST_JAVA25_HOME:-"$cache/resourcepack-matrix/provision/jdk25/jdk-25.0.4.1+1"}
libs="$cache/resourcepack-real/mct-cache/client/runtime/1.20.4/libraries"
ws=${MCT_TEST_WEBSOCKET_JAR:-"$cache/resourcepack-real/final/client-mod/version-1.21.11/build/processIncludeJars/Java-WebSocket-1.5.6.jar"}
gson=${MCT_TEST_GSON_JAR:-"$libs/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar"}
slf4j=${MCT_TEST_SLF4J_JAR:-"$libs/org/slf4j/slf4j-api/2.0.9/slf4j-api-2.0.9.jar"}
for file in "$java8/bin/javac" "$java25/bin/java" "$ws" "$gson" "$slf4j"; do
  [[ -f "$file" ]] || { echo "Missing regression dependency: $file (set MCT_TEST_* overrides)" >&2; exit 1; }
done
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cp="$ws:$gson:$slf4j"
mapfile -t stubs < <(find "$fixtures/java" -name '*.java' -print)
common=(
  "$root/client-mod/shared/command-core/java/com/mct/core/concurrent/TemporaryInputLeases.java"
  "$root/client-mod/shared/command-core/java/com/mct/core/concurrent/ClientTaskQueue.java"
  "$root/client-mod/shared/command-core/java/com/mct/core/concurrent/ConnectionRequestDispatcher.java"
  "$root/client-mod/shared/command-core/java/com/mct/core/protocol/WebSocketRequestService.java"
  "$root/client-mod/shared/forge-1.12/java/com/mct/legacy/LegacyWebSocketServer.java"
  "$root/client-mod/shared/forge-1.12/java/com/mct/legacy/ActionRouter.java"
  "$root/client-mod/shared/forge-1.12/java/com/mct/legacy/LegacyActionException.java"
  "$root/client-mod/shared/java/com/mct/core/util/ActionException.java"
)
for variant in modern official legacy; do
  mkdir -p "$out/$variant"
  sources=("${common[@]}" "${stubs[@]}")
  if [[ "$variant" == modern ]]; then sources+=("$root/client-mod/shared/java/com/mct/core/protocol/MctWebSocketServer.java"); fi
  if [[ "$variant" == official ]]; then sources+=("$root/client-mod/shared/java-official/com/mct/core/protocol/MctWebSocketServer.java"); fi
  "$java8/bin/javac" -source 8 -target 8 -Xlint:-options -cp "$cp" -d "$out/$variant" "${sources[@]}"
  for version in 8 25; do
    home=$java8; [[ "$version" == 25 ]] && home=$java25
    echo "=== $variant / JDK $version ==="
    if [[ "$variant" == legacy ]]; then
      "$home/bin/java" -cp "$out/$variant:$cp" com.mct.test.LegacyWriterBackpressureTest
    fi
    node "$fixtures/run.cjs" "$home/bin/java" "$out/$variant:$cp" "$variant"
  done
done
