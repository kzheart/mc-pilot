#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
mapfile -t gpu_stubs < <(find "$root/client-mod/tests/recording-adapters/java/com/mojang" -name '*.java' -print)
for api in v1 v2; do
mkdir -p "$out/$api"
javac -source 8 -target 8 -Xlint:-options -d "$out/$api" \
  "$root/client-mod/tests/recording-adapters/java/com/mct/core/recording/RecordingController.java" \
  "$root/client-mod/shared/recording-render/java/com/mct/core/recording/render/PboCapture.java" \
  "$root/client-mod/tests/recording-adapters/java/PboCaptureTest.java" \
  "$root/client-mod/shared/recording-gpu/java/com/mct/core/recording/render/GpuCapture.java" \
  "$root/client-mod/shared/recording-gpu-$api/java/com/mct/core/recording/render/GpuReadback.java" \
  "$root/client-mod/tests/recording-adapters/java/GpuCaptureTest.java" "${gpu_stubs[@]}"
java -cp "$out/$api" PboCaptureTest
java -cp "$out/$api" GpuCaptureTest
done
