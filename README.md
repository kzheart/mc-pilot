# MC Pilot

> Automated testing for Minecraft plugins and mods — drive a **real Minecraft client** from the command line, simulate player actions, and verify server-side behavior.

[![npm](https://img.shields.io/npm/v/%40kzheart_%2Fmc-pilot?label=npm)](https://www.npmjs.com/package/@kzheart_/mc-pilot)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Unlike protocol-level bots, MC Pilot injects a mod into a genuine Minecraft client, so everything a real player sees — GUIs, scoreboards, titles, resource packs, anvils, villager trades — is observable and scriptable. Every operation is a CLI command with JSON output, which makes it a natural tool for **AI coding agents** (Claude Code, Codex, Cursor, …) to test the plugin they just wrote.

## Highlights

- **Real client, zero intrusion** — test plugins/mods as-is; the client mod executes actions and reports state, the server needs no changes
- **AI-first design** — JSON output by default, machine-readable `mct schema`, bundled Coding Agent Skill
- **Wide version coverage** — Minecraft 1.12.2 – 26.2, Fabric / Forge / NeoForge, 27 client variants
- **Multiplayer testing** — run multiple clients simultaneously (PvP, trading, cross-player interactions)
- **Proxy networks** — Velocity / BungeeCord topologies with automatic forwarding configuration

## How It Works

```
AI / Test Script
     │ CLI commands (JSON in/out)
     ▼
┌─────────────────────────────┐
│  mct CLI (Node.js)          │
│  client + server processes  │
│  WebSocket command dispatch │
└────┬───────────────────┬────┘
     │ process mgmt      │ WebSocket
     ▼                   ▼
  Server            MC Client + Mod
  (plugin under     (executes actions,
   test)             returns state)
```

## Quick Start

**Requirements:** Node.js ≥ 20, plus a Java runtime matching the Minecraft version (Java 8 for Forge 1.12.2, Java 17 for 1.18–1.20, Java 21 for 1.21.x, Java 25+ for 26.x — pass `--java <command>` to `client create`, or set `servers.<name>.java` in `mct.json`, when it is not the default `java`).

```bash
npm install -g @kzheart_/mc-pilot
```

```bash
# 1. Initialize a project in your plugin's directory (creates mct.json and run/)
mct init --name my-plugin

# 2. Put a server in run/ (mct runs servers, it does not download them)
mkdir -p run/paper-1.20.4/plugins
curl -fsSL -o run/paper-1.20.4/paper.jar "$(curl -fsSL https://fill.papermc.io/v3/projects/paper/versions/1.20.4/builds/latest | jq -r '.downloads."server:default".url')"
cp build/libs/my-plugin.jar run/paper-1.20.4/plugins/

# 3. Create a client and wire both into a profile in mct.json (see below)
mct client create fabric-1.20.4 --version 1.20.4

# 4. Start everything and wait until the client is in-world
mct up --eula

# 5. Drive the player, verify behavior
mct chat command "gamemode creative"
mct move to 100 64 100
mct block break 100 65 100
mct inventory get
mct gui screenshot

# 6. Tear down
mct down
```

Clients default to Simplified Chinese (`zh_cn`) with muted audio (`--no-mute` to opt out).

<details>
<summary><b>Project configuration</b> — mct.json, profiles, server directories</summary>

`mct init` creates `mct.json` in the project root and a `run/` directory, and adds `run/` and `.mct/` (screenshots) to `.gitignore`. Everything a test needs lives in the project: delete the directory and the environment is gone. Only shared downloads and client instances stay under `~/.mct`.

```json
{
  "project": "my-plugin",
  "defaultProfile": "1.20",
  "profiles": {
    "1.20": {
      "servers": ["paper-1.20.4"],
      "clients": ["fabric-1.20.4"]
    }
  },
  "servers": {
    "paper-1.20.4": { "java": "/path/to/java-17", "jvmArgs": ["-Xmx2G"] }
  }
}
```

Each name in `servers` is a directory under `run/` holding a server jar. The optional top-level `servers` map sets per-server `java`, `jvmArgs` and `jar` (when a directory holds several jars). On its first start mct seeds a missing `server.properties` with `online-mode=false` and a free port; after that it only checks: `server start` refuses an un-accepted EULA (`--eula` accepts it), online-mode, or a busy port before launching.

`mct up` waits for every profile client to join a world. When that is not what you want:

```bash
mct up --skip-client-ready   # launch clients but don't block on in-world checks
mct up --server-only-ok      # server only; skip client launch entirely
```

</details>

<details>
<summary><b>Non-default versions</b> — 26.x servers, legacy Forge 1.12.2</summary>

```bash
# Forge 1.12.2 requires Java 8; three Forge builds are selectable
mct client create forge-1.12.2 --loader forge --version 1.12.2 \
  --forge-version 14.23.5.2864 --java /path/to/java-8
```

Minecraft 26.x servers need Java 25: set `"java"` for that server in `mct.json`.

Use `mct client search` to discover supported client versions and loaders.

</details>

## AI Agent Integration

The npm package bundles the `mc-pilot` Coding Agent Skill. Install it into your agent(s) of choice — Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Windsurf, Copilot, or the standard Agents path:

```bash
mct skill install
```

Selections persist in `~/.mct/skill-install.json` and stay in sync automatically on future npm updates (`mct skill sync` / `mct skill status` to manage manually). For non-interactive installs, set `MCT_SKILL_TARGETS=codex,claude` (or `all` / `none`).

Agents can also introspect the full command surface at runtime:

```bash
mct schema   # machine-readable CLI + WebSocket protocol schema
mct info     # current project, active profile, state root
```

## Reclaiming Disk Space

Servers, worlds and screenshots live inside each project (`run/`, `.mct/`), so deleting a project or a `run/<name>` directory frees them. What remains under `~/.mct` is shared: client instances and the download cache. `mct cache clean` reports what can go and only deletes with `--yes`:

```bash
mct cache clean                        # dry run: unused client runtimes, old server-jar cache
mct cache clean --clients-idle 30d     # also clients not launched for 30 days
mct cache clean --clients-idle 30d --yes
```

Client runtimes still used by a remaining client, and running clients, are never removed.

## Command Reference

All commands output JSON by default; add `--human` for human-readable output. Run `mct <command> --help` for details.

| Area | Commands |
|---|---|
| **Project** | `init` `up` `down` `use` `info` `schema` `cache` |
| **Instances** | `server` (start/stop/status/exec) · `client` (search/create/launch/stop/wait-ready) · `skill` |
| **Movement & world** | `move` `look` `position` `rotation` `block` `entity` |
| **Chat & UI** | `chat` `gui` `sign` `book` `hud` `resourcepack` |
| **Items & stations** | `inventory` `craft` `recipe` `anvil` `enchant` `trade` |
| **Combat & input** | `combat` `input` |
| **Observation** | `status` `screenshot` `screen` `image` `events` `wait` `wait-log` `record` |

Global options:

```
--project <id>     Project ID (default: derived from cwd)
--profile <name>   Profile name (default: project's defaultProfile)
--client <name>    Target client (required with multiple clients)
--human            Human-readable output (default: JSON)
```

## Multi-Client Testing

```bash
mct client create p1 --version 1.20.4 --ws-port 25560
mct client create p2 --version 1.20.4 --ws-port 25561

mct client launch p1 --server 127.0.0.1:25565 --account Fighter1
mct client launch p2 --server 127.0.0.1:25565 --account Fighter2
mct client wait-ready p1 && mct client wait-ready p2

mct --client p1 chat command "pvp challenge Fighter2"
mct --client p2 chat wait --match "challenge" --timeout 5
mct --client p2 chat command "pvp accept"
mct --client p1 combat kill --nearest --type player
mct --client p2 status health
```

## Recipes

### Shop plugin (GUI interaction)

```bash
mct chat command "shop"
mct gui wait-open --timeout 5
mct gui snapshot                      # inspect slot layout
mct gui click 11                      # click a category
mct gui wait-update --timeout 3
mct gui click 13 --button left        # buy an item
mct chat wait --match "purchased" --timeout 5
mct gui close
mct inventory get                     # verify item arrived
```

### Region protection (WorldGuard)

```bash
mct chat command "tp TestPlayer 100 64 100"
mct block break 100 64 100
mct chat history --last 3             # expect a permission-denied message
mct block get 100 64 100              # block must still exist

mct move to 200 64 200
mct block break 200 64 200
mct block get 200 64 200              # block must be gone
```

### Server console and logs

```bash
# exec returns the lines the command logged, plus a cursor
mct server exec "data get entity @p Health"      # → data.output, data.cursor

# Wait for something the server logs later; --after also matches lines already written
C=$(mct server status | jq '.data.servers[0].logCursor')
mct chat command "shop buy diamond"
mct wait-log --grep "purchased diamond" --after "$C" --timeout 10

# Anything else: read the server's own log
grep -E "ERROR|Exception" run/paper-1.20.4/logs/latest.log
```

<details>
<summary><b>More recipes</b> — crafting, enchanting, screenshots</summary>

### Crafting table

```bash
mct block interact 12 80 34           # open the crafting table
mct craft --recipe '[["oak_planks",null,null],["oak_planks",null,null],[null,null,null]]'
mct inventory get                     # result is in inventory
```

The legacy 9-slot object form `'{"slots":[...]}'` is also accepted and normalized.

### Enchanting table

```bash
mct block interact 16 80 40
mct gui click 36 --button left        # pick up sword from inventory
mct gui click 0 --button left         # place in enchant input slot
mct gui click 37 --button left        # pick up lapis
mct gui click 1 --button left         # place in lapis slot
mct enchant --option 0                # 0=top, 1=middle, 2=bottom
```

### Screenshot tuning

```bash
# Screenshots use a longer timeout and one retry by default; tune if the client is slow
mct screenshot --timeout 45 --retries 2 --output ./screenshots/check.png
```

</details>

More runnable examples live in [`examples/`](examples/) (shop, PvP, WorldGuard, proxy networks).

## Supported Versions

✅ verified · ⚠️ supported, limited validation · — not available

| Minecraft | Fabric | Forge | NeoForge |
|---|:-:|:-:|:-:|
| 1.12.2 | — | ✅ | — |
| 1.18.2 | ✅ | ✅ | — |
| 1.20.1 | ✅ | ✅ | ✅ |
| 1.20.2 | ✅ | ✅ | ⚠️ |
| 1.20.4 (default) | ✅ | ✅ | ✅ |
| 1.21.1 | ✅ | ✅ | ✅ |
| 1.21.4 | ✅ | ✅ | ✅ |
| 1.21.11 | ✅ | ✅ | ✅ |
| 26.1 | ✅ | ✅ | ✅ |
| 26.2 | ✅ | ✅ | ✅ |

Version notes:

- **26.1 servers** — Paper publishes no exact `26.1` artifact; the Fabric 26.1 client is verified against Paper 26.1.1 build 29 and 26.1.2 build 74. Paper 26.2 build 60 and Vanilla 26.2 are verified with the Fabric 26.2 client.
- **NeoForge 1.20.2** — NeoForge 20.2 clients cannot join Paper/Bukkit-family 1.20.2 servers at all (upstream `Invalid payload REGISTER!` handshake incompatibility, fixed in NeoForge 20.4). The variant works against vanilla servers; this is why it stays at limited validation.
- **Forge 1.12.2** — built with the legacy Java 8 toolchain; Forge builds 14.23.5.2859 / 2860 / 2864 are selectable via `--forge-version`. The legacy mod implements the full protocol (chat, status, movement, blocks, entities, combat, inventory, GUI interaction, crafting/anvil/enchant/trade, signs, books, HUD, screenshots, keyboard/mouse input, reconnect), verified end-to-end against a vanilla 1.12.2 server. Only `input scroll` is unavailable (LWJGL2 offers no event injection). On Apple Silicon, use an x86_64 Java 8 runtime under Rosetta (Minecraft 1.12.2 ships LWJGL2 x86_64 natives only).

## Development

```bash
git clone https://github.com/kzheart/mc-pilot.git
cd mc-pilot
npm ci

npm run test:cli        # CLI unit tests
npm run test:e2e        # CLI system E2E tests
npm run check:protocol  # verify CLI/protocol schema sync
npm run test:real       # full suite against a real client (slow)

cd client-mod && ./gradlew build          # build client mod (all modern variants)
cd client-mod/legacy && ./gradlew build   # Forge 1.12.2 variant (requires Java 8)
```

### Project Structure

```
mc-pilot/
├── cli/              # CLI tool (TypeScript)
├── client-mod/       # Fabric/Forge/NeoForge client mod (Java, multi-version modules)
│   ├── legacy/       # Forge 1.12.2 (Java 8 toolchain)
│   └── mc26/         # Minecraft 26.x variants (Java 25 toolchain)
├── protocol/         # WebSocket protocol definitions
├── examples/         # Example test scripts
├── scripts/          # Internal E2E test scripts
└── paper-fixture/    # Internal test fixture Paper plugin
```

## License

[MIT](LICENSE)
