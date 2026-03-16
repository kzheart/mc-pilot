#!/usr/bin/env bash
set -euo pipefail

MCT_BIN="${MCT_BIN:-mct}"

"$MCT_BIN" chat command "tp TestPlayer 100 64 100"
"$MCT_BIN" wait 1
"$MCT_BIN" block break 100 64 100
"$MCT_BIN" chat history --last 3
"$MCT_BIN" block get 100 64 100
"$MCT_BIN" move to 200 64 200
"$MCT_BIN" block break 200 64 200
"$MCT_BIN" block get 200 64 200
