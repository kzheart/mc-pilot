#!/usr/bin/env bash
set -euo pipefail

MCT_BIN="${MCT_BIN:-mct}"

"$MCT_BIN" chat command "op TestPlayer"
"$MCT_BIN" chat command "eco give TestPlayer 10000"
"$MCT_BIN" chat command "shop"
"$MCT_BIN" gui wait-open --timeout 5
"$MCT_BIN" gui screenshot --output ./screenshots/shop-main.png
"$MCT_BIN" gui snapshot
"$MCT_BIN" gui click 11
"$MCT_BIN" gui wait-update --timeout 3
"$MCT_BIN" gui screenshot --output ./screenshots/shop-weapons.png
"$MCT_BIN" gui click 13 --button left
"$MCT_BIN" chat wait --match "购买成功" --timeout 5
"$MCT_BIN" gui close
"$MCT_BIN" inventory get
"$MCT_BIN" chat command "balance"
"$MCT_BIN" chat wait --match "余额" --timeout 3
