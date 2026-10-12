#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT HUP INT TERM
javac=${JAVA_HOME:+"$JAVA_HOME/bin/"}javac
java=${JAVA_HOME:+"$JAVA_HOME/bin/"}java
"$javac" -source 8 -target 8 -d "$out" \
  "$root/shared/forge-1.12/java/com/mct/legacy/LegacyResourcePackUrls.java" \
  "$root/legacy/tests/LegacyResourcePackUrlsTest.java"
"$java" -cp "$out" com.mct.legacy.LegacyResourcePackUrlsTest
sh "$root/tests/run-resourcepack-tests.sh"
