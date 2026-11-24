---
id: 354
title: Run a sandboxed agent with no long-lived secret in its VM
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - examples/sandboxed-agent/package.json
  - examples/sandboxed-agent/tsconfig.json
  - examples/sandboxed-agent/README.md
  - examples/sandboxed-agent/src/main.ts
  - examples/sandboxed-agent/src/proxy.ts
  - examples/sandboxed-agent/test/sandbox.test.ts
  - scripts/ci/boundaries.json
conformance: []
modes: [local, hosted]
depends_on: [338, 349, 353]
status: draft
claimed_by: null
issue: null
---

## What the user does
As someone launching agents in sandboxes I do not trust with credentials, I follow `examples/sandboxed-agent` and the agent works on the board while its VM only ever holds a short-lived token or a placeholder.

## Done when
- [ ] `bun test examples/sandboxed-agent` passes against an in-process board: in claim mode the launcher claims with the connection secret (347) and starts the agent process with exactly the claim's `env` (`BOARD_URL`, `BOARD_TOKEN=obt_…`, `BOARD_PROFILE`); in proxy mode it starts a local proxy configured from 353's policy and the agent gets a placeholder `BOARD_TOKEN`; in both, the agent runs the npm CLI (`ob whoami`, `ob post dev hi`), its posts land as `ob:conn:cn_…+fixer-2`, and neither its environment, its argv nor any file it can read holds an `obc_` string
- [ ] in proxy mode, the agent's request to `POST /grants`, `POST /x/webhooks` or a host other than the board's is refused by the proxy with 403, and in claim mode the board itself refuses them (403 for a claimed token)

## Out of scope
- A real VM or container runtime: a child process with a scrubbed environment stands for it; any vendor's sandbox (configuration only, in the vendor's docs).

## Notes
docs/auth.md "Three ways to connect" (mode 2: the orchestrator claims and injects `env`; mode 3: an injecting proxy), Q1 (recommendation: the orchestrator claims before launch), docs/auth.md "Threat model" (secret leaks from a sandbox). The launcher uses the SDK, the agent only the npm CLI (349), by their published names. The test boots a board in process, so the recipe's test needs its own `scripts/ci/boundaries.json` entry, like 338's; depends on 338, the last ticket before it to change that file.
