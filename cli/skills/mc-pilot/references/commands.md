# MC Pilot Command Reference

## Global Options

```
--human                   Human-readable output (default: JSON)
--project <dir>           Project root containing mct.json (default: nearest mct.json upward from cwd)
--profile <name>          Profile name (default: defaultProfile in mct.json)
--client <name>           Target client name (required when multiple clients are running)
```

## Project Lifecycle

| Command | Description | Key Options |
|---|---|---|
| `init` | Create `mct.json`, `run/`, and add `run/` + `.mct/` to `.gitignore` | `--name <name>` |
| `up` | Start backends, then proxy, then launch clients and wait until in-world | `--profile <name>`, `--eula`, `--server-only-ok`, `--skip-client-ready` |
| `down` | Stop clients, proxy and servers for a profile | `--profile <name>` |
| `use <profile>` | Set the default profile | |
| `info` | Show current project and global state | |
| `cache clean` | Reclaim disk: obsolete server-jar cache, client runtimes no client uses (dry run unless `--yes`) | `--clients-idle <30d>`, `--yes` |

## server — Run server directories

A server is a directory holding a server jar: `run/<name>/` inside the project, or any path. mct does not download or configure servers; it starts, stops and talks to them.

| Subcommand | Description | Key Options |
|---|---|---|
| `start [name]` | Check EULA / online-mode / port, start, and wait until reachable | `--eula`, `--no-wait`, `--timeout <s>` |
| `stop [name]` | Console stop (saves worlds), kill if it hangs | |
| `status [name]` | Running state, port, `logPath`, `logCursor`; no name lists every server under `run/` | |
| `exec <command...>` | Run a console command; returns `output` (log lines it produced) and `cursor` | `--server <name>`, `--wait <s>` |

`wait-log --grep <regex> [--server <name>] [--after <cursor>] [--timeout <s>]` waits for a server log line. With `--after` it also matches lines written before the call, so pass the `cursor` from `server exec` or `server status`. On timeout it fails with `TIMEOUT` and the last log lines.

Server name can be omitted if a profile is active (the profile's first backend).

## client — Manage client instances

| Subcommand | Description | Key Options |
|---|---|---|
| `create <name>` | Create a new client instance | `--version <ver>`, `--loader <fabric\|forge\|neoforge>`, `--ws-port`, `--account` |
| `search` | Search available client version/loader combos | `--version <ver>` |
| `launch [name]` | Launch a client instance | `--server <addr>`, `--account`, `--headless` |
| `stop <name>` | Stop a client instance | |
| `list` | List all client instances and status | |
| `wait-ready [name]` | Wait until client WebSocket is connected and the player is in-world | `--timeout <seconds>`, `--no-world-check` |
| `reconnect` | Reconnect the client to the server | `--address` |
| `respawn` | Respawn the player after death (sends C2S respawn packet) | |

Client name can be omitted if a profile is active (resolved from profile).

`client respawn` is the reliable fallback when the DeathScreen auto-respawn mixin misses. Returns `{ requested, wasDead, wasOnDeathScreen }`.

## chat — Chat and server commands

| Subcommand | Description | Key Options |
|---|---|---|
| `send <message>` | Send a chat message (always goes through the client) | |
| `command <command>` | Execute a command. Defaults to auto-routing: real player context when available, server stdin when explicitly requested or needed. | `--via <auto\|server\|client>`, `--server <name>` |
| `history` | Get chat history | `--last <n>` |
| `wait` | Wait for a message matching a pattern | `--match <pattern>`, `--timeout <seconds>` |
| `last` | Get the last chat message | |

`chat command` defaults to `--via auto`. In normal project usage it prefers a real player sender via the client, so player-scoped commands like `@s` and plugin commands that require player context work without extra flags. Pass `--via server` or use `server exec` when you explicitly need console semantics.

## move — Movement control

| Subcommand | Description |
|---|---|
| `to <x> <y> <z>` | Move to coordinates (straight-line, times out 30s) |
| `forward <blocks>` | Move forward |
| `back <blocks>` | Move backward |
| `left <blocks>` | Move left |
| `right <blocks>` | Move right |
| `jump` | Jump once |
| `sneak <on\|off>` | Toggle sneaking |
| `sprint <on\|off>` | Toggle sprinting |

## look — Camera / view direction control

| Subcommand | Description | Key Options |
|---|---|---|
| `at <x> <y> <z>` | Look at coordinates | |
| `entity` | Look at an entity | `--nearest`, `--type <type>` |
| `set` | Set camera angle directly | `--yaw <deg>`, `--pitch <deg>` |

## position — Position query

| Subcommand | Description |
|---|---|
| `get` | Get current player position (x, y, z) |

## rotation — View direction query

| Subcommand | Description |
|---|---|
| `get` | Get current view direction (yaw, pitch) |

## block — Block interaction

| Subcommand | Description | Key Options |
|---|---|---|
| `break <x> <y> <z>` | Break a block | |
| `place <x> <y> <z>` | Place the held block | `--block <type>` |
| `interact <x> <y> <z>` | Right-click a block (open chest, door, etc.) | |
| `get <x> <y> <z>` | Query block info at coordinates | |

## entity — Entity interaction

| Subcommand | Description | Key Options |
|---|---|---|
| `attack` | Attack an entity | `--nearest`, `--type <type>` |
| `interact` | Right-click an entity | `--nearest`, `--type <type>` |
| `mount` | Mount an entity | `--nearest`, `--type <type>` |
| `list` | List nearby entities | `--type <type>`, `--radius <r>` |
| `info` | Get detailed entity info | `--nearest`, `--type <type>` |
| `dismount` | Dismount from vehicle | |
| `steer` | Steer a mounted vehicle | flags combinable |

## inventory — Inventory and item operations

| Subcommand | Description | Key Options |
|---|---|---|
| `get` | Get full inventory contents | |
| `slot <slot>` | Get a specific slot | |
| `held` | Get currently held item | |
| `hotbar <slot>` | Switch active hotbar slot (0-8) | |
| `drop` | Drop the held item | `--all` |
| `use` | Use (right-click) the held item | |
| `swap-hands` | Swap main hand and off-hand | |

## gui — GUI / container interaction

| Subcommand | Description | Key Options |
|---|---|---|
| `info` | Get current GUI info (title, type, slots) | |
| `snapshot` | Get full GUI snapshot with all slot contents | |
| `slot <slot>` | Get a specific GUI slot | |
| `click <slot>` | Click a GUI slot | `--button <left\|right\|middle>`, `--shift` |
| `drag` | Drag across GUI slots | |
| `close` | Close the current GUI | |
| `wait-open` | Wait for a GUI to open | `--timeout <seconds>` |
| `wait-update` | Wait for the GUI to update | `--timeout <seconds>` |
| `screenshot` | Screenshot the current GUI | `--output <path>` |

## screenshot

```
mct screenshot --output <path>
```

Take a screenshot and save to the specified path.

## screen

| Subcommand | Description |
|---|---|
| `size` | Get screen dimensions |

## hud — HUD element queries

| Subcommand | Description | Key Options |
|---|---|---|
| `scoreboard` | Get sidebar scoreboard | |
| `tab` | Get tab list (player list) | |
| `bossbar` | Get boss bar(s) | |
| `actionbar` | Get action bar text | |
| `title` | Get current title/subtitle | |
| `nametag` | Get a player's nametag info | `--player <name>` |

## status — Player status queries

| Subcommand | Description |
|---|---|
| `health` | Get health and hunger (includes `isDead`, `awaitingRespawn`, `onDeathScreen`, `deathCount`, `recentDeaths`) |
| `effects` | Get active potion effects |
| `experience` | Get XP level and progress |
| `gamemode` | Get current game mode |
| `world` | Get current world info |
| `all` | Get all status at once |

`status health` response shape:
```json
{
  "health": 0.0, "maxHealth": 20.0, "food": 20, "saturation": 0.0, "absorption": 0.0,
  "isDead": true, "awaitingRespawn": true, "onDeathScreen": true,
  "deathCount": 2,
  "recentDeaths": [{"timestamp": "...", "message": "...", "x": 0, "y": 0, "z": 0}]
}
```
Check `awaitingRespawn` to detect a stuck dead player — then call `mct client respawn`.

## sign — Sign block operations

| Subcommand | Description | Key Options |
|---|---|---|
| `read <x> <y> <z>` | Read sign text | |
| `edit <x> <y> <z>` | Edit sign text | `--lines <line1> <line2> <line3> <line4>` |

## book — Book and quill operations

Must hold a writable book.

| Subcommand | Description | Key Options |
|---|---|---|
| `read` | Read book contents | |
| `write` | Write book pages | `--pages <page1> <page2> ...` |
| `sign` | Sign and close the book | `--title <title>` |

## resourcepack — Resource pack operations

| Subcommand | Description |
|---|---|
| `status` | Get resource pack status |
| `accept` | Accept pending resource pack |
| `reject` | Reject pending resource pack |

## combat — Combat combo operations

| Subcommand | Description | Key Options |
|---|---|---|
| `kill` | Attack target until it dies | `--nearest`, `--type <type>` |
| `engage` | Approach and attack once | `--nearest`, `--type <type>` |
| `chase` | Chase target without attacking | `--nearest`, `--type <type>` |
| `clear` | Kill all entities of type in radius | `--type <type>`, `--radius <r>` |
| `pickup` | Pick up nearby dropped items | `--radius <r>` |

## craft — Crafting table recipe

```
mct craft --recipe '[[null,"diamond",null],[null,"stick",null],[null,"stick",null]]'
```

Prerequisite: open crafting table with `block interact <x> <y> <z>`. Use a 3x3 row array for new automation. Auto-places materials, crafts, and moves result to inventory.

## anvil — Anvil rename

```
mct anvil --slot <inventory-slot> --name "New Name"
```

Prerequisite: open anvil with `block interact <x> <y> <z>`.

## enchant — Enchanting table

```
mct enchant --option <0|1|2>
```

Prerequisite: open enchanting table with `block interact`. Place item and lapis manually via `gui click` first. Options: 0=top, 1=middle, 2=bottom.

## trade — Villager trading

```
mct trade --index <trade-index>
```

Prerequisite: open trade GUI with `entity interact --nearest --type villager`. Use `gui snapshot` to inspect available trades.

## wait — Wait and synchronization

```
mct wait <seconds>
mct wait --ticks <n>
mct wait --until-health-above <value> --timeout <seconds>
mct wait --until-gui-open --timeout <seconds>
mct wait --until-on-ground --timeout <seconds>
```

## input — Raw mouse/keyboard input

| Subcommand | Description | Key Options |
|---|---|---|
| `click <x> <y>` | Click at screen coords | `--button <left\|right\|middle>` |
| `double-click <x> <y>` | Double-click at screen coords | |
| `mouse-move <x> <y>` | Move mouse to coords | |
| `drag <fromX> <fromY> <toX> <toY>` | Mouse drag | `--button` |
| `scroll <x> <y>` | Scroll at coords | `--delta <n>` |
| `key` | Keyboard input | |
| `type <text>` | Type text into focused field | |
| `mouse-pos` | Get current mouse position | |
| `keys-down` | Get currently held keys | |


## record — Native mod video recording

All commands target the selected running client (`--client`, profile or default); no project or joined world is required. Output is silent H.264 MP4 from native render-frame pixels, never OS capture.

| Subcommand | Description | Key options |
|---|---|---|
| `start [name]` | Start a unique mod-owned recording | `--width 1920`, `--height 1080`, `--fps 30`, `--max-duration 1800`, `--timeout` |
| `stop` | Stop and wait for encoder finalization | `--timeout` (at least 60s by default) |
| `status` | Mod capability, encoder readiness, state and actual capture metrics | `--timeout` |
| `list` | Finalized videos in the client's `gameDir/recordings` | `--timeout` |
| `view <name>` | Verified local file URL or inaccessible-host-path guidance | `--probe` (existing ffprobe only) |
| `doctor` | Check existing CLI-local FFmpeg identity and libx264; no installation | `--ffmpeg <executable>` |

Start width/height are native pixels and must match the framebuffer (even, 2–7680 × 2–4320, additionally bounded by frame memory). FPS is 1–120; duration is 1–7200 seconds. No output-path, backend, window-title, encoder-execute or audio options exist. Names contain only ASCII letters/digits/underscore/hyphen, start with a letter/digit, have at most 80 characters, and cannot be Windows device names. No `.mp4` extension or directories.

Configure explicit window size using `client create` or `client launch --width 1920 --height 1080`, and the encoder via `--record-ffmpeg /absolute/path/to/ffmpeg`. A create setting persists; launch flags are one-shot overrides. The launcher forwards `MCT_RECORD_FFMPEG` as `-Dmct.record.ffmpeg=...`; otherwise the mod uses its PATH. Restart the game after changing encoder configuration.

`record start` returning does not stop capture. Stop before cleanup and require `state=stopped`, `finalized=true` before reviewing `outputPath`. A CFR `fps=30` output may contain duplicate frames: use `capturedFps` (fresh framebuffer samples / elapsed seconds), `captured`, `encoded`, `duplicate`, `dropped`, `sourceWidth` and `sourceHeight` for truthful evidence. `rendererFps` is the game render-rate estimate, separate from `capturedFps` and requested CFR `fps`. Recording survives routine WebSocket disconnects. After ambiguous transport failure, read status instead of retrying start.
