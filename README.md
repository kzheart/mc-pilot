# MC Pilot

Automated testing framework for Minecraft plugins and mods. Control a real Minecraft client via CLI to simulate player actions and verify plugin behavior.

## Features

- **Real client** — Controls a real Minecraft client via Fabric Mod, natively compatible with all server features
- **AI-driven** — All operations exposed as CLI commands, designed for AI agents (e.g. Claude Code) to call
- **Zero intrusion** — Test plugins as-is, no modifications needed
- **Multi-version** — Supports Minecraft 1.18.2 ~ 1.21.4 (Fabric)
- **Multi-client** — Control multiple client instances simultaneously for multiplayer testing

## Architecture

```
AI / Test Script
     │ CLI commands
     ▼
┌─────────────────────────────┐
│  mct CLI (Node.js)          │
│  Server/client lifecycle    │
│  WebSocket command dispatch │
└────┬───────────────────┬────┘
     │ Process mgmt       │ WebSocket
     ▼                    ▼
  Paper Server      MC Client + Mod
  (plugin under     (executes actions /
   test)             returns state)
```

## Quick Start

### Requirements

- Node.js >= 20
- Java 17+ (to run Minecraft)

### Install

```bash
npm install -g mc-pilot
```

### Download Server and Client Mod

```bash
# Download Paper server
mct server download --type paper --version 1.20.4

# Download client mod (Fabric)
mct client download --version 1.20.4
```

### Launch and Test

```bash
# Start server
mct server start --eula
mct server wait-ready

# Launch client
mct client launch default
mct client wait-ready default

# Control the client
mct chat command "gamemode creative"
mct move to 100 64 100
mct block break 100 65 100
mct inventory get
mct screenshot --output ./screenshots/test.png

# Stop
mct client stop default
mct server stop
```

## CLI Commands

All commands output JSON by default. Use `--human` for human-readable output.

| Command | Description |
|---|---|
| `mct server` | Server management (search/download/start/stop) |
| `mct client` | Client management (download/launch/stop/list) |
| `mct chat` | Chat (send/command/wait/history) |
| `mct move` | Movement (coordinates/direction/jump/sneak/sprint) |
| `mct look` | Camera control (coordinates/entity/angle) |
| `mct position` | Get current position |
| `mct rotation` | Get current view direction |
| `mct block` | Block interaction (break/place/interact/get) |
| `mct entity` | Entity interaction (attack/interact/list/mount) |
| `mct inventory` | Inventory (get/slot/hotbar/drop/use) |
| `mct gui` | GUI / container (info/click/drag/screenshot/wait) |
| `mct screenshot` | Take a screenshot |
| `mct screen` | Get screen dimensions |
| `mct hud` | HUD queries (scoreboard/tab/bossbar/title) |
| `mct status` | Player status (health/effects/xp/gamemode) |
| `mct sign` | Sign block (edit/read) |
| `mct book` | Book (write/sign/read) |
| `mct resourcepack` | Resource pack (accept/reject/status) |
| `mct craft` | Crafting table (auto-craft from recipe) |
| `mct anvil` | Anvil (rename items) |
| `mct enchant` | Enchanting table |
| `mct trade` | Villager trading |
| `mct combat` | Combat combos (kill/engage/chase/clear/pickup) |
| `mct input` | Raw mouse/keyboard input |
| `mct wait` | Wait (seconds/ticks/conditions) |

Use `mct <command> --help` for detailed usage of each command.

### Global Options

```
--config <path>    Config file path (default: ./mct.config.json)
--state-dir <path> State directory (default: ./.mct-state/)
--client <name>    Target client (required with multiple clients)
--human            Human-readable output (default: JSON)
```

### Multi-Client

```bash
# Download and configure two clients with different WebSocket ports
mct client download --version 1.20.4 --name p1 --ws-port 25560
mct client download --version 1.20.4 --name p2 --ws-port 25561

# Launch both
mct client launch p1 --account Fighter1
mct client launch p2 --account Fighter2
mct client wait-ready p1
mct client wait-ready p2

# Control each client with --client
mct --client p1 chat send "Hello from p1"
mct --client p2 chat send "Hello from p2"
mct --client p1 combat kill --type zombie --nearest
mct --client p2 status health
```

## Examples

### Shop Plugin Test

```bash
mct chat command "shop"
mct gui wait-open --timeout 5
mct gui screenshot --output ./screenshots/shop.png
mct gui snapshot                      # inspect slot layout
mct gui click 11                      # click a category
mct gui wait-update --timeout 3
mct gui click 13 --button left        # buy an item
mct chat wait --match "purchased" --timeout 5
mct gui close
mct inventory get                     # verify item in inventory
```

### Crafting Table Workflow

```bash
# Open crafting table
mct block interact 12 80 34

# Craft sticks from planks (auto-places materials, auto-takes result)
mct craft --recipe '{"slots":["oak_planks",null,null,"oak_planks",null,null,null,null,null]}'

# Result is now in inventory
mct inventory get
```

### Enchanting Workflow

```bash
# Open enchanting table
mct block interact 16 80 40

# Manually place sword and lapis via GUI clicks
mct gui snapshot                       # check slot layout
mct gui click 36 --button left         # pick up sword from inventory
mct gui click 0 --button left          # place in enchant input slot
mct gui click 37 --button left         # pick up lapis
mct gui click 1 --button left          # place in lapis slot

# Select enchantment option (0=top, 1=middle, 2=bottom)
mct enchant --option 0
```

### PvP Test (Multi-Client)

```bash
mct client launch p1 --account Fighter1
mct client launch p2 --account Fighter2
mct client wait-ready p1 --timeout 60
mct client wait-ready p2 --timeout 60

mct --client p1 chat command "pvp challenge Fighter2"
mct --client p2 chat wait --match "challenge" --timeout 5
mct --client p2 chat command "pvp accept"
mct wait 3
mct --client p1 combat kill --nearest --type player
mct --client p2 status health
mct --client p1 hud scoreboard
```

### WorldGuard Region Protection Test

```bash
# Try breaking a block inside a protected region
mct chat command "tp TestPlayer 100 64 100"
mct wait 1
mct block break 100 64 100
mct chat history --last 3             # check for permission denied message
mct block get 100 64 100              # confirm block was NOT broken

# Break a block outside the region
mct move to 200 64 200
mct block break 200 64 200
mct block get 200 64 200              # confirm block WAS broken
```

## Supported Minecraft Versions

| Version | Loader | Status |
|---|---|---|
| 1.18.2 | Fabric | Supported |
| 1.20.1 | Fabric | Supported |
| 1.20.2 | Fabric | Supported |
| 1.20.4 | Fabric | Supported (default) |
| 1.21.1 | Fabric | Supported |
| 1.21.4 | Fabric | Supported |

## Project Structure

```
mc-pilot/
├── cli/              # CLI tool (TypeScript)
├── client-mod/       # Fabric client mod (Java, multi-version modules)
├── protocol/         # WebSocket protocol definitions
├── examples/         # Example test scripts
├── scripts/          # Internal E2E test scripts
└── paper-fixture/    # Internal test fixture Paper plugin
```

## License

MIT
