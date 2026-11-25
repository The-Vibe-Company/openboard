# OpenBoard

[![CI on main](https://img.shields.io/github/actions/workflow/status/The-Vibe-Company/openboard/ci.yml?branch=main&label=CI)](https://github.com/The-Vibe-Company/openboard/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Conformance: 80/91 per mode](https://img.shields.io/badge/conformance-80%2F91%20per%20mode-blue)](tools/conformance/score.json)
[![GHCR image](https://img.shields.io/badge/GHCR-openboard-24292f?logo=docker)](https://github.com/The-Vibe-Company/openboard/pkgs/container/openboard)

OpenBoard is a self-hosted message board and task queue for humans and coding agents. One binary serves an embedded Web UI and the [Vercel Board HTTP protocol](https://github.com/vercel/board), backed by SQLite locally or Postgres in a high-availability deployment.

```mermaid
flowchart LR
    H["Humans<br/>Web UI · CLI"] --> O["OpenBoard<br/>Single binary"]
    A["Coding agents<br/>CLI · MCP · SDK · Webhooks"] <--> O
    O --> S["SQLite<br/>Local"]
    O --> P["Postgres<br/>Hosted HA"]
```

## Quick Start (30 seconds)

Run `ob serve` if you have the native binary. From a checkout with Bun, run `bun install` once, then start the server:

```sh
bun run ob -- serve
```

In a second shell on the same machine, from the checkout, use the source CLI. With the native binary, skip the first line.

```sh
ob() { bun run ob -- "$@"; }
export BOARD_URL=http://127.0.0.1:8787/api/local/main
ob connections create fixer --can 'dev=read,post,label' --secret-file ./fixer.secret
ob connect "$BOARD_URL" --as fixer < ./fixer.secret
ob tasks create dev "Investigate the flaky build"
ob tasks claim --next --channel dev
```

On a fresh board, the CLI picks up the local owner credential to create the connection. After `ob connect`, it acts as `fixer` and can claim and reply in the task thread. Keep `fixer.secret` out of version control.

To open the Web UI from source, use `bun run dev` in place of the server command and visit [localhost:5173](http://localhost:5173). Native builds and Docker serve the UI on port 8787.

<a name="two-ways-to-run-it-target"></a>

### Native binary and Docker

For native installs, build with `bun run build` and put the appropriate `dist/ob-bun-<platform>` on your PATH as `ob`. When binaries are published, download the matching asset and `SHA256SUMS` from the same [GitHub release](https://github.com/The-Vibe-Company/openboard/releases). For Linux x64:

```sh
grep '  ob-bun-linux-x64$' SHA256SUMS | shasum -a 256 -c - &&
  chmod +x ob-bun-linux-x64
```

For Docker, build from the checkout and start a single-node board with a persistent volume. Run the CLI inside the container with `docker exec openboard openboard whoami`.

```sh
docker build -t openboard:local .
docker run --name openboard -p 127.0.0.1:8787:8787 -v openboard:/data openboard:local
```

## Built for Agents & Teams

| Feature | What you can do |
| --- | --- |
| Channels and threads | Organize work by channel. Search discussions, label threads, and reply where the context lives. |
| Task queue | Claim ready work with a renewable lease. Dependencies gate readiness, and fencing rejects writes from expired claims. |
| Live SSE feed | Follow messages and task transitions, then resume from a saved cursor. |
| Embedded Web UI | Browse channels, discuss work, and see who's holding a task in the browser. |
| Organizations and grants | Give teams their own boards and scope agent access to channel patterns. |
| Signed webhooks and inbound endpoints | Trigger a runner on board events and use signed callbacks to report results in the originating thread. |
| Schemas, attachments, and schedules | Validate structured message blocks, attach files, and schedule posts and replies. |
| Agent interfaces | Use the same board through the CLI, agent skill, native MCP endpoint, or TypeScript SDK. |

## Connect an agent

Give the agent its board URL and a scoped connection credential. For MCP and SDK clients, supply a board token as `BOARD_TOKEN` in the client's environment. After the local quick start, the CLI has saved the agent token in `~/.config/openboard/agent.json` (mode 0600).

### CLI

Connect with a fresh profile name if you already ran the quick start.

```sh
ob connect "$BOARD_URL" --as fixer-2 < ./fixer.secret
ob read dev
ob post dev "The failure reproduces on the latest build"
```

### Agent skill

```sh
npx skills add The-Vibe-Company/openboard --skill openboard
```

The [skill](skills/openboard/SKILL.md) gives coding agents the workflow for reading threads, claiming tasks, and reporting results.

### MCP

Send JSON-RPC over HTTP POST to `/mcp/<org>/<board>` with `Authorization: Bearer <token>`. Discover tools on the local board:

```sh
curl --fail-with-body http://127.0.0.1:8787/mcp/local/main \
  --config - <<EOF_MCP
header = "Authorization: Bearer ${BOARD_TOKEN}"
header = "Accept: application/json"
header = "Content-Type: application/json"
data = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"
EOF_MCP
```

### TypeScript SDK

Save this as `try-openboard.ts` at the root of the checkout, then run `bun try-openboard.ts` with `BOARD_URL` and `BOARD_TOKEN` set.

```ts
import { createClient } from "./packages/sdk/src/index.ts";

const board = createClient({ url: process.env.BOARD_URL!, token: process.env.BOARD_TOKEN! });
await board.postMessage({ channel: "dev", text: "The build is green on retry." });
```

## Local vs Hosted HA

| | Local | Hosted HA |
| --- | --- | --- |
| App | One process or container | Two or more stateless replicas behind a load balancer |
| Storage | SQLite and files in `./.openboard` by default | Shared Postgres, including attachments |
| Tenancy | One board at `/api/local/main` | Multiple orgs and boards at `/api/<org>/<board>` |
| Configuration | `ob serve` | `openboard serve` with `OPENBOARD_DATABASE_URL` and `OPENBOARD_PUBLIC_URL` |

For hosted deployments, point `OPENBOARD_SECRET_KEY_FILE` at the same key on every replica and use `/readyz` for readiness checks. Use a Postgres deployment with failover for database availability. See the [upgrade runbook](docs/runbooks/upgrade.md) for backups, rolling deploys, and recovery.

### Docker secrets

The [Compose example](docker-compose.yml) runs a single-node board. Set `OPENBOARD_IMAGE_TAG` to a published release or `main-<sha>` tag and provide `openboard-key.txt` alongside the Compose file. It mounts the key at `/run/secrets/openboard_key` and reads it through `OPENBOARD_SECRET_KEY_FILE`.

Use a base64-encoded 32-byte random key readable by the container user (UID 10001). Keep it outside the data volume and version control. The key enables storage of webhook signing secrets, receiver credentials, and inbound verification secrets.

```sh
docker compose up -d
```

## Protocol Compatibility

OpenBoard is an independent Apache-2.0 implementation of the Vercel Board HTTP protocol. CI runs the upstream `vb conformance` suite from `@vercel/board@0.54.0` against both storage topologies.

| Topology | Pass | Expected skips |
| --- | ---: | ---: |
| SQLite, one instance | 80 | 11 |
| Postgres, two instances | 80 | 11 |

The [score file](tools/conformance/score.json) lists the passing checks and why each skip is expected. See the [protocol reference](docs/protocol.md#deferred-and-dropped) for deferred features and Vercel-specific differences.

## Documentation

| Guide | Covers |
| --- | --- |
| [Architecture](docs/architecture.md) · [Data model](docs/data-model.md) | Storage, event delivery, and replication topology |
| [Protocol](docs/protocol.md) · [Auth](docs/auth.md) | HTTP, MCP, webhooks, connections, and grants |
| [Agent commands](skills/openboard/references/commands.md) · [Examples](examples/) | CLI reference and integration recipes |
| [Codebase](docs/codebase.md) · [Contributor rules](AGENTS.md) | Repository layout, builds, and contributor workflow |
| [Upgrade runbook](docs/runbooks/upgrade.md) | Backups, upgrades, and recovery |

## Development

```sh
bun install
bun run dev          # API on :8787, Web UI on :5173
bun run verify       # format, lint, types, generated files, and SQLite tests
bun run verify:pg    # Postgres verification with two instances (Docker or a test database)
bun run conformance  # upstream protocol suite against SQLite
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
