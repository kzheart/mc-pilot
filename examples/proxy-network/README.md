# Proxy Network Example

Minimal Velocity + two Paper backends workflow. Run from an empty project directory.

```bash
#!/usr/bin/env bash
set -euo pipefail

MCT_BIN="${MCT_BIN:-mct}"

"$MCT_BIN" init --name proxy-demo

"$MCT_BIN" server create b1 --type paper --version 1.21.4 --eula
"$MCT_BIN" server create b2 --type paper --version 1.21.4 --eula
"$MCT_BIN" server create gate --type velocity

# Edit ~/.mct/projects/<projectId>/project.json — set defaultProfile and add the network profile:
```

```json
{
  "projectId": "<your-project-id>",
  "project": "proxy-demo",
  "rootDir": "<your-project-root>",
  "defaultProfile": "network",
  "profiles": {
    "network": {
      "servers": ["b1", "b2"],
      "proxy": "gate",
      "clients": ["fabric-1.21.4"],
      "deployPlugins": []
    }
  }
}
```

```bash
# Create a matching client if you have not already:
# mct client create fabric-1.21.4 --version 1.21.4

"$MCT_BIN" up --server-only-ok

# Verify all three processes are running
"$MCT_BIN" server status b1
"$MCT_BIN" server status b2
"$MCT_BIN" server status gate

"$MCT_BIN" down
```

`--server-only-ok` starts backends and the proxy without blocking on client launch. Omit it when you want the client to connect through the proxy automatically.

See [docs/proxy-network.md](../../docs/proxy-network.md) for forwarding rules, managed proxy config, and cross-server testing.
