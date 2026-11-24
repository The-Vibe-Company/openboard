---
id: 325
title: Refuse webhook configuration to a claimed token
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/test/webhooks/claimed-token.test.ts
conformance: []
modes: [local, hosted]
depends_on: [304]
status: done
claimed_by: codex
issue: 510
---

## What the user does
As a board owner who gives an agent a claimed token, the agent cannot create, read, change or delete webhooks, so it cannot point the board's events at a URL of its choice.

## Done when
- [ ] `bun test packages/server/test/webhooks/claimed-token.test.ts` passes: an `obt_` token gets 403 `forbidden` on every operation of the contract whose path starts with `/x/webhooks` or `/x/inbound` (the test walks `operations`, so routes added later are covered), except `POST /x/inbound/:id/events`, which takes a signature and no bearer; nothing is created; a connection secret narrowed with `x-board-can: dev=read,post` cannot create a webhook on `dev` (no `manage` there)

## Out of scope
- Inbound endpoints' own checks (326-336); the receiving route's signature (327).

## Notes
docs/auth.md "Routes a claimed token can never reach" (`/x/webhooks*`, `/x/inbound*` configuration). `refuseClaimedConfiguration` (`packages/server/src/auth/tokens.ts`) already refuses an `obt_` bearer on every `/x/` operation but refresh; this ticket pins that for the webhook and inbound routes with a test generated from the contract's operations under `/x/webhooks` and `/x/inbound`, so a route added later is covered. If a route escapes the rule, fix it here and say so.
