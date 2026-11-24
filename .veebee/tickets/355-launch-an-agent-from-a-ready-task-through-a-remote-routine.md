---
id: 355
title: Launch an agent from a ready task through a remote routine
milestone: M12-mcp-sdk-skill
package: tools
writes:
  - examples/remote-routine/package.json
  - examples/remote-routine/tsconfig.json
  - examples/remote-routine/README.md
  - examples/remote-routine/webhook.json
  - examples/remote-routine/src/main.ts
  - examples/remote-routine/src/verify.ts
  - examples/remote-routine/src/launch.ts
  - examples/remote-routine/test/launch.test.ts
  - examples/remote-routine/test/fixtures/agent.ts
  - scripts/ci/boundaries.json
conformance: []
modes: [local, hosted]
depends_on: [319, 354]
status: draft
claimed_by: null
issue: 540
---

## What the user does
As a team lead, I create a task in `work/fix/` and, with no one watching, a remote routine starts an agent that claims it, works and completes it.

## Done when
- [ ] `bun test examples/remote-routine` passes against an in-process board: a webhook from `examples/remote-routine/webhook.json` (`{ "tail": "work/fix/", "became": { "task": "ready" } }`, standard-webhooks) delivers to the routine, which verifies it, claims a token for profile `run-<thread>` with the delivery ID as `idempotencyKey`, and starts `RUNNER_COMMAND` (here `test/fixtures/agent.ts`) with only the claim's `env` plus `OPENBOARD_TASK=<thread>`; the fixture agent runs `ob tasks claim <thread>` then `ob tasks complete <thread> --result done`, and the task ends `completed`
- [ ] in the same file, the same delivery sent twice starts one agent; a delivery with a bad signature starts none; two tasks becoming ready start two agents with two profiles
- [ ] with `ob serve`, the routine running (`bun examples/remote-routine/src/main.ts --port 9100` with the webhook secret and the connection secret from files named in its README), and the webhook created from `webhook.json`: `ob tasks create work/fix/web "fix the build"` leads to `ob read <id>` showing the agent's claim and completion within a few seconds

## Out of scope
- Linking the run in the thread (356); reporting turns, failures and wake-ups back (357-359); any specific orchestrator: a hosted launcher is reached by the same webhook with its own signing preset (314) and body template (317), configuration only.

## Notes
- docs/protocol.md "Worked example: board event → … routine → agent → board" (setup and run, steps 1 to 4), stated generically: a remote routine is any HTTPS endpoint that launches an agent when called. This recipe is a small one that can run next to the board; a hosted launcher replaces it with configuration, and no product's name appears in this recipe or in `packages/` (AGENTS.md non-negotiable 1; docs/project.md 6 phase C keeps the owner's launcher in its own recipe).
- The routine holds the connection secret (claim mode of 354; Q1's recommendation), so the agent's environment holds only the claimed token. Uses the SDK (347) and starts the agent with the npm CLI (349) on its `PATH`.
- `verify.ts` repeats 338's Standard Webhooks check: recipes never import each other (docs/codebase.md 3.1).
- Per-process state (deliveries seen, runs started) is allowed in a recipe; the module-state rule covers `packages/*/src` and `apps/openboard/src` only.
