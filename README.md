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
- **Session recording** — capture mp4 + command timeline + game events, replay them side by side (macOS)

## How It Works

```
AI / Test Script
     │ CLI commands (JSON in/out)
     ▼
┌─────────────────────────────┐
│  mct CLI (Node.js)          │
│  server/client lifecycle    │
│  WebSocket command dispatch │
└────┬───────────────────┬────┘
     │ process mgmt      │ WebSocket
     ▼                   ▼
  Server            MC Client + Mod
  (plugin under     (executes actions,
   test)             returns state)
```

## Quick Start

**Requirements:** Node.js ≥ 20, plus a Java runtime matching the Minecraft version (Java 8 for Forge 1.12.2, Java 17 for 1.18–1.20, Java 21 for 1.21.x, Java 25+ for 26.x — pass `--java <command>` when it is not the default `java`).

```bash
npm install -g @kzheart_/mc-pilot
```

```bash
# 1. Initialize a project in your plugin's directory
mct init --name my-plugin

# 2. Create a server and a client instance
mct server create paper-1.20.4 --type paper --version 1.20.4 --eula
mct client create fabric-1.20.4 --version 1.20.4

# 3. Start everything (server + client + plugin deployment)
mct up --profile 1.20

# 4. Drive the player, verify behavior
mct chat command "gamemode creative"
mct move to 100 64 100
mct block break 100 65 100
mct inventory get
mct gui screenshot

# 5. Tear down
mct down
```

Clients default to Simplified Chinese (`zh_cn`) with muted audio (`--no-mute` to opt out).

<details>
<summary><b>Project configuration</b> — profiles, server/client wiring, plugin deployment</summary>

`mct init` creates a global project config at `~/.mct/projects/<projectId>/project.json` (`projectId` is derived from the directory path). Profiles wire instances together:

```json
{
  "projectId": "-Users-kzheart-code-minecraft-my-plugin",
  "project": "my-plugin",
  "rootDir": "/Users/kzheart/code/minecraft/my-plugin",
  "defaultProfile": "1.20",
  "profiles": {
    "1.20": {
      "server": "paper-1.20.4",
      "clients": ["fabric-1.20.4"],
      "deployPlugins": ["./build/libs/my-plugin.jar"]
    }
  }
}
```

`mct up` waits for every profile client to join a world. When that is not what you want:

```bash
mct up --skip-client-ready   # launch clients but don't block on in-world checks
mct up --server-only-ok      # server only; skip client launch entirely
```

</details>

<details>
<summary><b>Non-default versions</b> — 26.x servers, legacy Forge 1.12.2</summary>

```bash
# Minecraft 26.x requires Java 25
mct server create vanilla-26.1 --type vanilla --version 26.1 --java /path/to/java-25 --eula

# Forge 1.12.2 requires Java 8; three Forge builds are selectable
mct client create forge-1.12.2 --loader forge --version 1.12.2 \
  --forge-version 14.23.5.2864 --java /path/to/java-8
```

Use `mct client search` / `mct server search` to discover supported versions, loaders, and verified client/server pairings.

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

## Command Reference

All commands output JSON by default; add `--human` for human-readable output. Run `mct <command> --help` for details.

| Area | Commands |
|---|---|
| **Project** | `init` `up` `down` `use` `deploy` `info` `schema` |
| **Instances** | `server` (search/create/start/stop/config/exec/logs) · `client` (search/create/launch/stop/wait-ready) · `plugin` · `skill` |
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

### Log diagnostics

```bash
# Append a marker, then inspect only newer matching lines
MARKER=$(mct server logs-mark --human | tail -1)
mct server logs --after-marker "$MARKER" --grep "ERROR|Exception"

mct server logs --since-start --grep "Enabled|ERROR"   # ignore stale lines
mct wait-log --grep "Done .* For help" --timeout 60    # wait for a fresh match
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

## Session Recording (macOS)

Record the client window as mp4 while commands run, then review a synchronized replay page (video + command timeline + game events). The recorder helper ships in the npm package — no build step.

```bash
mct record start --client bot1        # requires Screen Recording permission for your terminal
mct chat command "gamemode creative"  # every mct command lands in the timeline
mct record stop --client bot1
mct record view <recording-id>        # generates viewer.html and opens it
```

Artifacts live in `~/.mct/projects/<id>/recordings/<recording-id>/` and survive client crashes. When building from source, compile the helper once with `cd recorder/macos && swift build -c release` (or point `MCT_RECORDER_BIN` at a custom binary).

## Supported Versions

✅ verified · ⚠️ supported, limited validation · — not available

| Minecraft | Fabric | Forge | NeoForge |
|---|:-:|:-:|:-:|
| 1.12.2 | — | ⚠️ | — |
| 1.18.2 | ✅ | ✅ | — |
| 1.20.1 | ✅ | ⚠️ | ✅ |
| 1.20.2 | ✅ | ⚠️ | ⚠️ |
| 1.20.4 (default) | ✅ | ⚠️ | ✅ |
| 1.21.1 | ✅ | ✅ | ✅ |
| 1.21.4 | ✅ | ✅ | ⚠️ |
| 1.21.11 | ✅ | ✅ | ⚠️ |
| 26.1 | ✅ | ✅ | ✅ |
| 26.2 | ✅ | ✅ | ✅ |

Version notes:

- **26.1 servers** — Paper publishes no exact `26.1` artifact; the Fabric 26.1 client is verified against Paper 26.1.1 build 29 and 26.1.2 build 74. Paper 26.2 build 60 and Vanilla 26.2 are verified with the Fabric 26.2 client. `mct client search` / `mct server search` expose these verified pairings.
- **Forge 1.12.2** — built with the legacy Java 8 toolchain; Forge builds 14.23.5.2859 / 2860 / 2864 are selectable via `--forge-version` and verified to install, launch, and join a vanilla 1.12.2 server. On Apple Silicon, use an x86_64 Java 8 runtime under Rosetta (Minecraft 1.12.2 ships LWJGL2 x86_64 natives only).

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
