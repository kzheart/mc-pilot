#!/usr/bin/env bash
set -euo pipefail

MCT_BIN="${MCT_BIN:-mct}"

"$MCT_BIN" client launch player1 --account Fighter1 --ws-port 25560
"$MCT_BIN" client launch player2 --account Fighter2 --ws-port 25561
"$MCT_BIN" client wait-ready player1 --timeout 60
"$MCT_BIN" client wait-ready player2 --timeout 60
"$MCT_BIN" --client player1 chat command "pvp challenge Fighter2"
"$MCT_BIN" --client player2 chat wait --match "挑战" --timeout 5
"$MCT_BIN" --client player2 chat command "pvp accept"
"$MCT_BIN" wait 3
"$MCT_BIN" --client player1 position get
"$MCT_BIN" --client player2 position get
"$MCT_BIN" --client player1 entity attack --nearest
"$MCT_BIN" wait 1
"$MCT_BIN" --client player2 status health
"$MCT_BIN" --client player1 screenshot --output ./screenshots/pvp-scoreboard.png
"$MCT_BIN" --client player1 hud scoreboard
