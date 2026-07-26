# MC Pilot Command Reference

## Global Options

```
--human                   Human-readable output (default: JSON)
--project <name>          Project name (default: from mct.project.json)
--profile <name>          Profile name (default: from mct.project.json)
--client <name>           Target client name (required when multiple clients are running)
```

## Project Lifecycle

| Command | Description | Key Options |
|---|---|---|
| `init` | Initialize a new project (creates mct.project.json) | `--project <name>` |
| `deploy` | Deploy plugin JARs to server instance | `--profile <name>` |
| `up` | Deploy + start server + launch clients + wait ready | `--profile <name>`, `--eula` |
| `down` | Stop server and clients for a profile | `--profile <name>` |
| `use <profile>` | Set the default profile | |
| `info` | Show current project and global state | |

## server — Manage server instances

| Subcommand | Description | Key Options |
|---|---|---|
| `create <name>` | Create a new server instance (offline mode by default) | `--type <paper\|vanilla\|purpur\|spigot\|velocity\|bungeecord>`, `--version <ver>` (proxy types: proxy's own version), `--port`, `--eula` (ignored for proxies), `--online-mode` |
| `search` | Search available server versions | `--type`, `--version` |
| `start [name]` | Start a server instance | `--eula` |
| `stop [name]` | Stop a server instance | |
| `config [name]` | Update instance settings while stopped (syncs instance.json + server.properties) | `--port <number>`, `--online-mode <true\|false>` |
| `status [name]` | Show server status | |
| `list` | List server instances | `--all` (all projects) |
| `wait-ready [name]` | Wait until server port is connectable | `--timeout <seconds>` |
| `exec <command...>` | Send a console command directly to the server stdin FIFO (bypasses client chat) | `--server <name>` |
| `logs [name]` | Read / tail / grep / follow the server log | `--tail <n>`, `--grep <pattern>`, `--since <lineNumber>`, `--follow`, `--timeout <s>`, `--first-match` |

Server name can be omitted if a profile is active (resolved from profile).

`server logs --follow` keeps polling the log file until either `--timeout` seconds elapse or (with `--first-match`) a line matching `--grep` appears. Returns `{ matched, matches, timedOut }`. Use this instead of `sleep N` when waiting for an async server-side event.

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

## record — Test session recording (macOS)

| Subcommand | Description | Key Options |
|---|---|---|
| `start` | Start recording the client window | `--client <name>`, `--fps <n>` (default 30), `--backend <name>` |
| `stop` | Stop and finalize the recording (writes mp4, timeline, sliced events) | `--client <name>` |
| `list` | List recordings of the current project | |
| `view <id>` | Generate viewer.html (video + command/event timeline) and open it | `--no-open` |

Records the client window as mp4 while commands run, then produces a synchronized
replay page. Requires a project context. macOS-only for now; the recorder helper
ships inside the npm package (universal binary), so it works out of the box —
only the terminal's Screen Recording permission is required. (Source checkouts:
build once with `cd recorder/macos && swift build -c release`, or set
`MCT_RECORDER_BIN`.) Every mct command issued during recording is automatically
captured into the timeline.

```
mct record start --client bot1 --fps 30
# ... run test commands ...
mct record stop --client bot1
mct record view <recording-id>
```

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

## plugin — Plugin center catalog

| Subcommand | Description | Key Options |
|---|---|---|
| `list` | List all plugins | `--query <text>` |
| `info <id>` | Show plugin details | |
| `add <jar-path>` | Add a JAR to the catalog (id/name auto-derived) | `--id`, `--name` |
| `update <id>` | Update plugin metadata | `--name`, `--version`, `--description`, `--author`, `--dependencies`, `--tags` |
| `remove <id>` | Remove plugin from catalog + delete JAR | |
| `install <id>` | Install plugin + dependencies to a server | `--server <name>`, `--project <name>` |
| `resolve <ids...>` | Resolve dependency tree | |

Storage: `~/.mct/plugins/catalog.json` + `~/.mct/plugins/jars/`
