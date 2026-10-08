# Proxy Network Example

Minimal Velocity + two Paper backends. Run from an empty project directory with `curl` and `jq` installed.

```bash
#!/usr/bin/env bash
set -euo pipefail

MCT_BIN="${MCT_BIN:-mct}"
MC=1.21.4

fill() { # project version -> latest build jar URL
  curl -fsSL "https://fill.papermc.io/v3/projects/$1/versions/$2/builds/latest" \
    | jq -r '.downloads."server:default".url'
}

"$MCT_BIN" init --name proxy-demo

mkdir -p run/lobby run/game run/velocity
curl -fsSL -o run/lobby/paper.jar "$(fill paper "$MC")"
cp run/lobby/paper.jar run/game/paper.jar
curl -fsSL -o run/velocity/velocity.jar "$(fill velocity 3.4.0)"   # Velocity 4.x needs Java 25

printf 'online-mode=false\nserver-port=25565\n' > run/lobby/server.properties
printf 'online-mode=false\nserver-port=25566\n' > run/game/server.properties

# First boot generates paper-global.yml, spigot.yml, velocity.toml and forwarding.secret.
for s in lobby game; do "$MCT_BIN" server start "$s" --eula && "$MCT_BIN" server stop "$s"; done
"$MCT_BIN" server start velocity --timeout 60 || true
"$MCT_BIN" server stop velocity
```

Then edit the generated files as described in [docs/proxy-network.md](../../docs/proxy-network.md): `[servers]`, `online-mode = false` and `player-info-forwarding-mode = "modern"` in `run/velocity/velocity.toml`, and the forwarding secret in each backend's `config/paper-global.yml`.

Add the profile to `mct.json`:

```json
{
  "project": "proxy-demo",
  "defaultProfile": "network",
  "profiles": {
    "network": {
      "servers": ["lobby", "game"],
      "proxy": "velocity",
      "clients": ["fabric-1.21.4"]
    }
  }
}
```

```bash
# Create a matching client if you have not already:
# mct client create fabric-1.21.4 --version 1.21.4

"$MCT_BIN" up --server-only-ok     # checks forwarding config, starts backends then proxy
"$MCT_BIN" server status           # lists lobby, game and velocity
"$MCT_BIN" down
```

`--server-only-ok` starts the servers without launching clients. Omit it to have the client connect through the proxy.
