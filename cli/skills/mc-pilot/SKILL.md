---
name: mc-pilot
description: "Automated testing of Minecraft plugins and mods using the mct CLI tool. Use this skill whenever the user is developing a Minecraft plugin or mod and needs to test, verify, or debug its behavior in a real Minecraft environment. Triggers on: testing Minecraft plugins, verifying plugin behavior, running Minecraft client automation, debugging mod functionality, checking if a plugin feature works correctly, simulating player actions in Minecraft. Also use this when the user says things like 'test this plugin', 'verify the shop works', 'check if protection is working', 'try breaking a block', or any request involving controlling a Minecraft client to validate plugin/mod behavior."
---

# MC Pilot

MC Pilot (`mct`) drives a real Minecraft client against a server that lives in your project, so plugin/mod behavior can be verified in-game, not guessed from logs alone.

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
- Use `mct info` inside the project directory to confirm the project root, `mct.json` path, active profile and configured server/client.
- For detailed command examples, read `references/commands.md`.

## Version Compatibility Discovery

Client versions are limited to what the mct client mod supports; query them instead of guessing:

```bash
mct client search --loader fabric --version <mc-version>
```

- Run the server on the same Minecraft version as the client unless `client search` notes say otherwise (e.g. a patch-only server version that should use a neighbouring client).
- Keep the client version and server version as separate values in profiles, scripts, reports and instance names.

## Required Testing Posture

When the user asks whether a Minecraft feature works, actually test it in a real server/client unless they explicitly only want a plan or static analysis.

- Prefer state/event/condition waits over blind time waits.
- Use `mct events wait`, `mct wait-log`, `mct gui wait-open`, `mct gui wait-update`, `mct client wait-ready`, or query commands with wait conditions where available.
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

3. If this is a new test project, initialize it in the plugin's own repository. Everything for the test stays inside that directory: servers in `run/<name>/`, screenshots and recordings in `.mct/` (both git-ignored by `init`). Deleting the directory removes the whole environment.

```bash
mct init --name <plugin-or-test-name>
```

4. Put a server in `run/<name>/`. mct does not download servers; fetch the jar yourself. Paper example:

```bash
mkdir -p run/paper-<mc>
curl -fsSL -o run/paper-<mc>/paper.jar "$(curl -fsSL https://fill.papermc.io/v3/projects/paper/versions/<mc>/builds/latest | jq -r '.downloads."server:default".url')"
cp build/libs/<plugin>.jar run/paper-<mc>/plugins/   # mkdir plugins/ first
```

Velocity uses the same API with `projects/velocity`. Spigot needs BuildTools; vanilla jars come from Mojang's version manifest.

On first start mct writes `online-mode=false` and a free `server-port` into a missing `server.properties`, so a fresh Paper directory needs nothing else. Copy the rebuilt plugin jar into `plugins/` yourself and restart the server after every rebuild: a live PluginClassLoader keeps the old jar and lazily loaded classes fail with `NoClassDefFoundError`.

5. Create a client. Names must include the plugin/test name, never generic names like `fabric-1.20.4`.

```bash
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

6. Add a profile to `mct.json`. `servers` lists directories under `run/`; `servers` (top-level) holds optional per-server launch settings — use `java` whenever the server needs a different Java than the one on PATH:

```json
{
  "project": "<name>",
  "defaultProfile": "dev",
  "profiles": {
    "dev": { "servers": ["paper-<mc>"], "clients": ["fabric-<test>-<mc>"] }
  },
  "servers": {
    "paper-<mc>": { "java": "/path/to/java-21/bin/java", "jvmArgs": ["-Xmx2G"] }
  }
}
```

If a server directory holds more than one jar, also set `"jar": "<file>"` there.

7. Start and wait for readiness:

```bash
mct up --eula
```

If debugging startup separately:

```bash
mct server start <server> --eula      # waits until reachable; fails with phase + console tail
mct client launch <client>
mct client wait-ready <client>
```

`server start` checks before launching: EULA accepted (`--eula` writes it), `online-mode` off, port free. A server that crashes during boot fails with `SERVER_EXITED` and the last console lines in `details.recentLines`; read them before retrying.

`client wait-ready` means the client is connected and in-world by default. It
reconnects on its own when the client is parked on a title/disconnect screen, so
a timeout means something else is wrong: use the returned diagnostics
(`screenCategory`, `disconnectReason`, `reconnectAttempts`), `mct server status`,
and the server log instead of guessing.

`up` refuses to launch clients when the entry point (the proxy when there is
one, otherwise the first backend) has online-mode on: mct clients use offline
accounts and the server rejects them with "Failed to login: Invalid session"
(`登录失败：无效会话`). Set it to false in `server.properties` / `velocity.toml` /
`config.yml` and restart. Never "fix" this by retrying — it never resolves on
its own.

`up` and `down` echo the `profile` they acted on — check it against the
profile you asked for before treating any result as evidence. An unknown
`--profile` is rejected with the available names, never silently replaced by the
default.

When `mct events wait` / `mct chat wait` times out, read the error `details`
before touching the plugin: `observedOfType` and `recentEvents` show what
actually arrived in the window (with `§` colour codes stripped), and `typeCounts`
exposes a mistyped `--type`. A pattern that missed is not a plugin defect.

## Proxy Networks (Velocity / BungeeCord)

A proxy is just another directory under `run/`; `start`/`stop`/`exec`/`wait-log` work the same. mct does not write proxy or forwarding config — you do. Profile:

```json
{ "servers": ["lobby", "game"], "proxy": "velocity", "clients": ["<client>"] }
```

Start the proxy once so it generates its config, then edit it:

- Velocity `velocity.toml`: `online-mode = false`, `[servers]` entries pointing at each backend's `127.0.0.1:<server-port>`, `try = [...]`, and keep an explicit empty `[forced-hosts]` section — without it Velocity falls back to example hosts referencing servers that do not exist and refuses to start.
- Modern forwarding (`player-info-forwarding-mode = "modern"`, backends 1.13+ Paper): copy the proxy's `forwarding.secret` into each backend's `config/paper-global.yml` → `proxies.velocity.enabled: true` / `secret` (1.13–1.18: `paper.yml` → `settings.velocity-support`).
- Legacy forwarding (BungeeCord, or Velocity `legacy`): `ip_forward: true` in the proxy `config.yml`, and `settings.bungeecord: true` in each backend's `spigot.yml`.
- Switching modes: turn the other mode off on the backends. Leftover `bungeecord: true` next to Velocity modern forwarding (or the reverse) makes Paper reject the handshake.

`mct up` checks this before starting anything: every backend port must be listed in the proxy, the forwarding secret must match, and the backend forwarding switch must be on. Mismatches fail with `PROXY_CONFIG_MISMATCH` listing each problem; `proxyWarnings` lists checks skipped because a config file was not generated yet. Clients connect to the proxy port.

Cross-server switch test pattern:

```bash
mct up                                         # client joins via proxy into the first backend
C=$(mct server status game | jq .data.logCursor)
mct chat command "server game"                 # proxy /server command switches backend
mct client wait-ready <client>                 # confirm re-entered world after switch
mct wait-log --server game --grep "joined the game" --after "$C"
```

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
mct gui wait-open --timeout 10
mct inventory held --wait 10 --type minecraft:diamond
```

### Server Console And Logs

`mct server exec` returns the log lines the command produced, so no follow-up log read is needed:

```bash
mct server exec "data get entity @e[tag=probe,limit=1] Health"
# → data.output: ["... has the following entity data: 20.0f"], data.cursor: 18234
```

To assert on something the server logs later, wait from a cursor taken before the action. `--after` also matches lines already written, so there is no race:

```bash
C=$(mct server status | jq .data.servers[0].logCursor)   # or .data.cursor from server exec
mct chat command "shop buy diamond"
mct wait-log --grep "purchased diamond" --after "$C" --timeout 10
```

For anything else read the server's own log directly: `run/<name>/logs/latest.log` (BungeeCord: `proxy.log.0`). `mct server status` prints its `logPath`. Startup output before logging initializes is in `run/<name>/.mct-console.log`.

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

`mct down` stops processes but leaves worlds and databases on disk. They live in
the project's `run/` directory, so removing `run/<name>` (or the whole project)
deletes them; nothing for the project is kept under `~/.mct`. Shared downloads
and clients are under `~/.mct`: `mct cache clean` reports what it can reclaim
(client runtimes no client uses, the old server-jar cache), `--clients-idle 30d`
adds clients unused for that long, and `--yes` deletes.

## Pitfalls

- Test clients use offline accounts: every entry-point server needs `online-mode=false`. `server start` refuses to boot otherwise.
- Test players usually need OP for setup commands (`mct server exec "op <player>"`).
- Use namespaced vanilla commands such as `minecraft:enchant` when plugins override command names.
- Do not mutate a live player's `SelectedItem` NBT directly; use `/give`, plugin UI, or item entities.
- Restart the server after replacing a plugin jar; never swap jars under a running server.
- `latest.log` is recreated on every server start, so cursors from a previous run are stale; take a fresh one after restarting.
- `mct screenshot` is slower than state queries; use explicit `--timeout` for busy scenes.

## Reference

Read `references/commands.md` for command tables and lower-level examples. Prefer `mct schema` over any written reference when they differ.
