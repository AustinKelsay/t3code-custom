# Remote Access Setup

Use this when you want to open T3 Code from another device (phone, tablet, another laptop).

## CLI ↔ Env option map

The T3 Code CLI accepts the following configuration options, available either as CLI flags or environment variables:

| CLI flag                | Env var               | Notes                              |
| ----------------------- | --------------------- | ---------------------------------- |
| `--mode <web\|desktop>` | `T3CODE_MODE`         | Runtime mode.                      |
| `--port <number>`       | `T3CODE_PORT`         | HTTP/WebSocket port.               |
| `--host <address>`      | `T3CODE_HOST`         | Bind interface/address.            |
| `--base-dir <path>`     | `T3CODE_HOME`         | Base directory.                    |
| `--dev-url <url>`       | `VITE_DEV_SERVER_URL` | Dev web URL redirect/proxy target. |
| `--no-browser`          | `T3CODE_NO_BROWSER`   | Disable auto-open browser.         |
| `--auth-token <token>`  | `T3CODE_AUTH_TOKEN`   | WebSocket auth token.              |

> TIP: Use the `--help` flag to see all available options and their descriptions.

## Security First

- Always set `--auth-token` before exposing the server outside localhost.
- Treat the token like a password.
- Prefer binding to trusted interfaces (LAN IP or Tailnet IP) instead of opening all interfaces unless needed.

## 1) Build + run server for remote access

Remote access should use the built web app (not local Vite redirect mode).

```bash
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host 0.0.0.0 --port 3773 --auth-token "$TOKEN" --no-browser
```

Then open on your phone:

`http://<your-machine-ip>:3773`

Example:

`http://192.168.1.42:3773`

Notes:

- `--host 0.0.0.0` listens on all IPv4 interfaces.
- `--no-browser` prevents local auto-open, which is usually better for headless/remote sessions.
- Ensure your OS firewall allows inbound TCP on the selected port.

## 2) Tailnet / Tailscale access

If you use Tailscale, prefer Tailscale Serve so the web app loads over HTTPS on your `ts.net`
hostname. This is required for browser microphone access.

```bash
bun run start:web:tailscale
```

Open from any device in your tailnet:

`https://<device>.<tailnet>.ts.net/?token=<token>`

The helper prints the exact phone URL after it builds `apps/web`, builds `apps/server`,
configures `tailscale serve`, and starts the server bound to loopback on the host machine.

Important:

- `tailscale serve` changes machine-level Tailscale serve state, not just this process
- if the host already uses `tailscale serve` for something else, inspect that config before reusing this helper
- use `tailscale serve status` to confirm what is currently published on the node

For a stable personal host, the recommended environment is:

```bash
.env.local

# local only, gitignored
T3CODE_PORT=3773
T3CODE_AUTH_TOKEN="<long-random-token>"
T3CODE_HOME="/absolute/path/to/.t3"
OPENAI_API_KEY="<openai-api-key>"
T3CODE_VOICE_MODEL="gpt-realtime"
T3CODE_TTS_MODEL="gpt-4o-mini-tts"
T3CODE_VOICE_NAME="alloy"
```

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run start:web:tailscale
```

`bun run start:web:tailscale` now loads `.env.local` automatically before building or starting the server.

Operational note:

- do not run the Electron desktop app at the same time as the remote web session unless you intentionally want both processes touching the same `T3CODE_HOME`

If you prefer to run it manually:

```bash
TSNET_HOST="$(tailscale status --json | jq -r '.CertDomains[0]')"
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/web build
bun run --cwd apps/server build
tailscale serve --bg --https 443 http://127.0.0.1:3773
bun run --cwd apps/server start -- --host 127.0.0.1 --port 3773 --auth-token "$TOKEN" --no-browser
```

Then open:

`https://$TSNET_HOST/?token=$TOKEN`

If you need to inspect the current proxy config, run `tailscale serve status`.
