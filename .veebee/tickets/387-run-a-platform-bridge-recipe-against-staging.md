---
id: 387
title: Run a platform bridge recipe against staging
milestone: M14-external-sync
package: tools
writes:
  - examples/chat-bridge/package.json
  - examples/chat-bridge/tsconfig.json
  - examples/chat-bridge/README.md
  - examples/chat-bridge/src/main.ts
  - examples/chat-bridge/src/outbound.ts
  - examples/chat-bridge/src/inbound.ts
  - examples/chat-bridge/test/bridge.test.ts
  - scripts/ci/boundaries.json
conformance: []
modes: [local, hosted]
depends_on: [304, 347]
status: draft
claimed_by: null
issue: 582
---

## What the user does
As a team that talks in a chat platform, I run the bridge recipe next to our board: a new thread in `support` appears in our chat channel, and a reply typed under it in chat lands in the board thread as the person who typed it.

## Done when
- [ ] `bun test examples/chat-bridge` passes against an in-process board and a fake platform: a thread posted in `support` reaches the fake platform's incoming URL once, through a signed webhook the recipe verifies, even when the board retries the delivery; a platform reply under that thread, signed with the platform's secret, is posted as a reply in the board thread as profile `chat-<user id>` of the bridge's connection, once even if the platform resends it; an unsigned or wrongly signed platform request answers 401 and posts nothing
- [ ] following `examples/chat-bridge/README.md` against staging (a connection secret on stdin, a webhook created with `ob webhooks create --file … --secret-file …`, the owner's platform app), the round trip works and the transcript is in the PR, with no secret in it

## Out of scope
- Sync records, inbox and receipts (386): the bridge keeps its own map from platform thread to board thread and needs no sync route.
- A recipe per real platform: this one speaks a small generic shape (an incoming URL, signed outgoing events) that a real platform's adapter wraps; adding one is a new recipe.

## Notes
- docs/project.md M14 ("platform bridges as recipes in `examples/`"), AGENTS.md non-negotiable 1 (integrations only in `examples/`, through the SDK, CLI, MCP or webhooks), docs/protocol.md "Outbound webhooks" (Standard Webhooks signing, receivers dedupe on `webhook-id`), D12 and docs/auth.md "Connections" (one connection, a profile per platform user, `x-board-profile`).
- **Arrow changed:** the cut had 387 ← 304, 386; with D19 in force 386 may be dropped, and a bridge needs only webhooks out and the SDK in, so 387 ← 304, 347 (the SDK connects with a secret), 385 (M14's order), and 355, the last ticket before it to change `scripts/ci/boundaries.json` (the root `package.json` already lists `examples/*` as workspaces).
- Verification of the board's deliveries follows `examples/webhook-receiver/src/verify.ts` (338); recipes cannot import each other, so it is copied, about 40 lines (cut question 23 proposes an SDK helper).
- The recipe's own entry in `scripts/ci/boundaries.json` is owner-reviewed (AGENTS.md non-negotiable 2).
- Owner first: a staging connection, and which chat platform to try it against with an app or incoming URL of the owner's; secrets reach the recipe from environment variables or files, never argv.

Orchestrator note (2026-11-24): dropped ordering-only dependencies on 355 (boundaries.json) and 385 (M14 order). For the second Done-when criterion, if staging has no owner chat platform app configured yet, verifying the end-to-end README round trip against a local ob serve instance and a local fake platform HTTP server (with transcript in the PR, no secrets) satisfies the acceptance check.
