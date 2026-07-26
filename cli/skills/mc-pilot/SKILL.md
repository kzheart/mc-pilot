---
name: mc-pilot
description: "Automated testing of Minecraft plugins and mods using the mct CLI tool. Use this skill whenever the user is developing a Minecraft plugin or mod and needs to test, verify, or debug its behavior in a real Minecraft environment. Triggers on: testing Minecraft plugins, verifying plugin behavior, running Minecraft client automation, debugging mod functionality, checking if a plugin feature works correctly, simulating player actions in Minecraft. Also use this when the user says things like 'test this plugin', 'verify the shop works', 'check if protection is working', 'try breaking a block', or any request involving controlling a Minecraft client to validate plugin/mod behavior."
---

# MC Pilot

MC Pilot (`mct`) drives a real Minecraft client and server so plugin/mod behavior can be verified in-game, not guessed from logs alone.

## When To Use

Use this skill when the task needs any of these:

- Launching or controlling a Minecraft server/client for a test.
- Verifying a plugin/mod behavior through real player actions.
- Inspecting game state, GUI state, chat, inventory, HUD, entities, blocks, screenshots, or server logs.
- Reproducing a bug that only appears in Minecraft runtime.

Do not use this skill for pure static code review unless the user also asks to run or verify Minecraft behavior.

## Source Of Truth

Do not rely on memorized command flags. The CLI is self-describing:

```bash
mct schema
mct info
```

- Use `mct schema` for current commands, options, protocol actions, and error codes.
- Use `mct info` inside the project directory to confirm project id, active profile, configured server/client, and global state paths.
- For detailed command examples, read `references/commands.md`.

## Version Compatibility Discovery

Do not assume that the client and server must have identical version strings, and do not infer compatibility from version numbering alone. Query the CLI's verified compatibility metadata before creating test instances:

```bash
mct client search --loader fabric --version <client-version>
mct server search --type paper --version <server-version>
```

- Prefer `verifiedServers` returned by client search when selecting a test server. Pin the listed server `build` when one is present.
- Use `verifiedClients` returned by server search when the requested server has no same-number client variant.
- A pairing is supported only when it is explicitly listed as verified. Treat missing pairings as unverified and run a real join test before recording them.
- Keep the client version and server version as separate values in profiles, scripts, reports, and instance names.
- For example, the Fabric 26.1 client is verified with Paper 26.1.1 build 29 and Paper 26.1.2 build 74; Paper does not publish an exact 26.1 artifact.

## Required Testing Posture

When the user asks whether a Minecraft feature works, actually test it in a real server/client unless they explicitly only want a plan or static analysis.

- Prefer state/event/condition waits over blind time waits.
- Use `mct events wait`, `mct server logs --follow --first-match`, `mct gui wait-open`, `mct gui wait-update`, `mct client wait-ready`, or query commands with wait conditions where available.
- Capture screenshots for visual behavior, GUI alignment, HUD/resource-pack work, or any confusing failure.
- After every failure or surprising result, inspect `eventsSinceLastCall`, `lastEventType`, `mct events tail`, server logs, and a screenshot before retrying.
- Clean up client/server processes unless the user explicitly wants the environment left running.

## Bootstrap Flow

1. Confirm `mct` exists:

```bash
mct --cli-version
```

2. Query CLI and project context:

```bash
mct schema
mct info
```

3. If this is a new test project, initialize and create isolated instances. Names must include the plugin/test name, never generic names like `paper-1.20.4` or `fabric-1.20.4`.

```bash
mct init --name <plugin-or-test-name>
mct server create paper-<test>-<mc> --type paper --version <mc> --eula
mct client create fabric-<test>-<mc> --version <mc> --mute
```

Clients support `--loader fabric|forge|neoforge` (default fabric). When testing loader-specific mod behavior, name the instance after the loader, e.g.:

```bash
mct client create forge-<test>-<mc> --loader forge --version <mc> --mute
```

Forge 1.12.2 offers selectable builds. Query them first, use Java 8, and pin
the chosen build:

```bash
mct client search --loader forge --version 1.12.2
mct client create forge-<test>-1.12.2 --loader forge --version 1.12.2 \
  --forge-version 14.23.5.2864 --java /path/to/java-8 --mute
```

On Apple Silicon, use an x86_64 Java 8 runtime under Rosetta for 1.12.2
because its LWJGL2 natives are x86_64.

4. Configure the project profile in the path shown by `mct info`, including:

- `server` (single backend) or `servers` + `proxy` (proxy network topology, see below)
- `clients`
- `deployPlugins` (and `proxyPlugins` for proxy-side plugins)
- screenshot output directory if useful

5. Start and wait for readiness:

```bash
mct up --profile <profile>
```

If debugging startup separately:

```bash
mct deploy
mct server start <server> --eula
mct server wait-ready <server>
mct client launch <client>
mct client wait-ready <client>
```

`client wait-ready` means the client is connected and in-world by default. If it times out, use the returned diagnostics, `mct client reconnect`, `mct server readiness`, and logs instead of guessing.

## Proxy Networks (Velocity / BungeeCord)

For cross-server plugins (server switching, proxy-side plugins), build a proxy topology. Proxies are server instances too — same lifecycle commands (`start`/`stop`/`exec`/`logs`/`wait-ready`) apply.

```bash
mct server create <test>-b1 --type paper --version <mc> --eula
mct server create <test>-b2 --type paper --version <mc> --eula
mct server create <test>-gate --type velocity   # or --type bungeecord; no EULA needed
```

Profile fields for topology (`servers` takes precedence over `server`; clients connect to the proxy port automatically):

```json
{
  "servers": ["<test>-b1", "<test>-b2"],
  "proxy": "<test>-gate",
  "clients": ["<client>"],
  "deployPlugins": ["path/to/backend-plugin.jar"],
  "proxyPlugins": ["path/to/proxy-plugin.jar"]
}
```

`mct up` handles forwarding automatically: it picks modern (Velocity, all backends >= 1.13) or legacy (BungeeCord, or any older backend) mode, generates and syncs `forwarding.secret`, and writes the backend config files. Do not hand-edit the proxy's `velocity.toml`/`config.yml` — mct regenerates them on every start. Check `topologyWarnings` in the `up` output for degraded setups (spigot/vanilla backends).

Cross-server switch test pattern:

```bash
mct up --profile <profile>                    # client joins via proxy into the first backend
mct chat command "server <test>-b2"           # proxy /server command switches backend
mct client wait-ready <client>                # confirm re-entered world after switch
mct server logs <test>-b2 --grep "joined the game"   # confirm arrival on target backend
```

For proxy version selection use `mct server search --type velocity|bungeecord`; `--version` on a proxy instance means the proxy's own version, not a Minecraft version.

## Isolation Rules

Parallel tests can collide if they reuse instance names, ports, or project directories.

- Use unique project, server, and client names per test.
- Check for existing processes before creating or starting:

```bash
mct server status
mct client list
```

- If another task owns a running instance, create new names for this task.
- Prefer `--client <name>` whenever more than one client may exist.

## Core Verification Patterns

### General Assertions

```bash
mct chat command "gamemode creative @s"
mct position get
mct block get <x> <y> <z>
mct inventory get
mct status all
mct chat history --last 10
```

`mct chat command` defaults to auto-routing: it prefers real player context when a client is available and can be forced with `--via client` or `--via server`.

### Async Outcomes

Use event/log/condition waits:

```bash
mct events wait --type chat.received --match "purchased" --timeout 10
mct server logs --follow --grep "reward claimed" --timeout 20 --first-match
mct gui wait-open --timeout 10
mct inventory held --wait 10 --type minecraft:diamond
```

Clear state before a new assertion window:

```bash
mct events clear
mct chat clear
```

### GUI/Menu Tests

```bash
mct chat command "shop"
mct gui wait-open --timeout 10
mct gui layout
mct gui snapshot
mct gui screenshot --output ./shop.png
mct gui click <slot>
mct gui wait-update --timeout 5
mct inventory get
```

Use `mct gui layout` before image matching when validating GUI coordinates. It returns GUI bounds, title coordinates, and slot centers.

### Block Protection

```bash
mct chat command "tp @s <x> <y> <z>"
mct block break <x> <y> <z>
mct events wait --type chat.received --match "permission|protect|deny" --timeout 5
mct block get <x> <y> <z>
```

### Resource Packs

Do not click screenshots to accept resource packs. Use the mod action:

```bash
mct resourcepack status
mct resourcepack accept
mct resourcepack status
```

### Player Death

If dangerous actions are involved:

```bash
mct status health
mct client respawn
mct client wait-ready
```

Check `isDead`, `awaitingRespawn`, `onDeathScreen`, `deathCount`, and `recentDeaths`. Add protection, creative mode, safe teleport, armor, or peaceful difficulty when the test is not specifically about death.

### Screenshots

Use screenshots as evidence, not decoration:

```bash
mct screenshot --output ./before.png
mct gui screenshot --output ./gui.png
```

Then inspect the image file. For image geometry helpers:

```bash
mct image bbox <image.png>
mct image locate-template <screenshot.png> <template.png> --expected <x,y,w,h>
```

## Recording On macOS

When a replay would help the user, record the test session:

```bash
mct record start --client <client>
# run test commands
mct record stop --client <client>
mct record view <recording-id>
```

If screen-recording permission is missing, tell the user and continue without recording. Recording is helpful, not a blocker.

## Cleanup

Unless the user explicitly asks to keep the environment alive:

```bash
mct down
```

Or stop individually:

```bash
mct client stop <client>
mct server stop <server>
```

Always clean up after failures too. Stale clients, ports, and `~/.mct/state` entries are a common source of false failures.

## Pitfalls

- Servers are created with `online-mode=false` by default (test clients use offline accounts). Pass `--online-mode` on create only when Mojang auth is genuinely needed; fix an existing instance with `mct server config <name> --online-mode <true|false>`.
- Do not edit `server.properties` directly; `mct server start` rewrites managed keys (port, online-mode) from `instance.json`. Change them with `mct server config` while the server is stopped.
- Test players usually need OP for setup commands.
- Use namespaced vanilla commands such as `minecraft:enchant` when plugins override command names.
- Do not mutate a live player's `SelectedItem` NBT directly; use `/give`, plugin UI, or item entities.
- Server logs are append-only; use `mct server logs-mark`, `--after-marker`, or `--since-start` to avoid stale matches.
- `mct screenshot` is slower than state queries; use explicit `--timeout` for busy scenes.

## Reference

Read `references/commands.md` for command tables and lower-level examples. Prefer `mct schema` over any written reference when they differ.
