#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT HUP INT TERM
javac=${JAVA_HOME:+"$JAVA_HOME/bin/"}javac
java=${JAVA_HOME:+"$JAVA_HOME/bin/"}java
"$javac" -source 8 -target 8 -Xlint:-options -d "$out" \
  "$root/shared/command-core/java/com/mct/core/concurrent/TemporaryInputLeases.java" \
  "$root/shared/command-core/java/com/mct/core/concurrent/ClientTaskQueue.java" \
  "$root/shared/command-core/java/com/mct/core/concurrent/ConnectionRequestDispatcher.java" \
  "$root/tests/ConnectionRequestDispatcherTest.java"
"$java" -cp "$out" com.mct.core.concurrent.ConnectionRequestDispatcherTest
