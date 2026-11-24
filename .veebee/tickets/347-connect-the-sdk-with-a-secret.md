---
id: 347
title: Connect the SDK with a secret
milestone: M12-mcp-sdk-skill
package: sdk
writes:
  - packages/sdk/src/connect.ts
  - packages/sdk/src/client.ts
  - packages/sdk/src/index.ts
  - packages/sdk/test/connect.test.ts
  - packages/sdk/README.md
conformance: []
modes: [local, hosted]
depends_on: [103]
status: done
claimed_by: codex
issue: 532
---

## What the user does
As a developer writing a runner or an agent, I write `const board = await openboard({ url: process.env.BOARD_URL, secret: process.env.OPENBOARD_SECRET, as: "run-812" })` and use `board` for as long as my process lives, without handling tokens.

## Done when
- [ ] `bun test packages/sdk/test/connect.test.ts` passes against a fake `fetch`: `openboard({ url, secret, as })` claims once (`POST /x/connections/claim` with the secret as bearer and `{ profile }`), then sends the `obt_` token on every call; it refreshes the token before `expiresAt` (`POST /x/connections/refresh`) and once on a 401 from an expired token, then gives up with `BoardError` `unauthorized`; `idempotencyKey`, `can` and `ttl` pass through to the claim; `openboard({ url, token })` uses a token as given and never claims
- [ ] in the same file, the secret is sent only to `/x/connections/claim` at the given `BOARD_URL`, never kept on the returned object (`JSON.stringify(board)` and `Object.keys` show no secret), never in an error's message; a secret that is not `obc_…` is refused before any request

## Out of scope
- Publishing (348); webhook signature helpers for receivers (not in the cut; listed as a gap in the PR that wrote this ticket).

## Notes
docs/auth.md "One-line UX per surface" (SDK: `openboard({ url, secret: process.env.OPENBOARD_SECRET, as: 'fixer-2' })` claims and refreshes, or `token:`), "Mode 2" (claim answer `{ agent, token, env }`) and "Refresh" (new token with the same pins, the previous one valid 60 s, never past `hardExpiresAt`). Built on `createClient` (`packages/sdk/src/client.ts`); time and timers come from options so tests use a fake clock (the SDK reads nothing from the environment, docs/codebase.md 5.5). Depends on 103, the last ticket before it to change `packages/sdk/src/index.ts` (it adds `tail`). `ob connect` (`packages/cli/src/commands/connect.ts`) keeps its own storage; it may call this later.

Orchestrator note: the dependency on 215 (serving production) was dropped: it ordered milestones, it is not a technical need, and 215 waits on the owner's production secrets.
