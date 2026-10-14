#!/usr/bin/env sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
out=${RECORDING_TEST_OUTPUT:-$(mktemp -d)}
if [ -z "${RECORDING_TEST_OUTPUT:-}" ]; then trap 'rm -rf "$out"' EXIT HUP INT TERM; fi
mkdir -p "$out/classes" "$out/media"
javac=${JAVA_HOME:+"$JAVA_HOME/bin/"}javac
java=${JAVA_HOME:+"$JAVA_HOME/bin/"}java
if "$javac" -version 2>&1 | grep -q 'javac 1\.8'; then release='-source 8 -target 8'; else release='--release 8'; fi
# Intentional word splitting: release is a fixed local compiler-flag list.
"$javac" $release -Xlint:all -Xlint:-options -d "$out/classes" \
  "$root"/shared/recording-core/java/com/mct/core/recording/*.java "$here/RecordingCoreTest.java"
"$java" -ea -cp "$out/classes" com.mct.core.recording.RecordingCoreTest "$out/media"
python3 "$here/verify-media.py" "$out/media"
