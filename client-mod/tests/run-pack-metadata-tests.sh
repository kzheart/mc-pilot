#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT HUP INT TERM
javac=${JAVA_HOME:+"$JAVA_HOME/bin/"}javac
java=${JAVA_HOME:+"$JAVA_HOME/bin/"}java
"$javac" -d "$out" \
  "$root/buildSrc/src/main/java/ModPackMetadata.java" \
  "$root/tests/ModPackMetadataTest.java"
"$java" -cp "$out" ModPackMetadataTest "$out"
python3 "$root/tests/check-pack-metadata-projection.py" "$out"
