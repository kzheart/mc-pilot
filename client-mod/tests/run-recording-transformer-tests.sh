#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
asm=${MCT_TEST_ASM_JAR:-${1:-}}
[[ -f "$asm" ]] || { echo "Set MCT_TEST_ASM_JAR (or first argument) to the official org.ow2.asm:asm-debug-all:5.2 JAR" >&2; exit 1; }
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
mapfile -t fixtures < <(find "$root/client-mod/tests/recording-transformer/java" -name '*.java' -print)
javac -source 8 -target 8 -Xlint:-options -cp "$asm" -d "$out" \
  "$root/client-mod/shared/forge-1.12/java/com/mct/legacy/recording/RecordingTransformer.java" "${fixtures[@]}"
java -Xverify:all -cp "$out:$asm" RecordingTransformerTest
