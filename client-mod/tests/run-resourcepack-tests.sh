#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT HUP INT TERM
javac=${JAVA_HOME:+"$JAVA_HOME/bin/"}javac
java=${JAVA_HOME:+"$JAVA_HOME/bin/"}java
"$javac" -d "$out" \
  "$root/shared/resourcepack-core/java/com/mct/core/resourcepack/ResourcePackPolicy.java" \
  "$root/shared/resourcepack-core/java/com/mct/core/resourcepack/ResourcePackLifecycle.java" \
  "$root/tests/ResourcePackLifecycleTest.java"
"$java" -cp "$out" ResourcePackLifecycleTest
