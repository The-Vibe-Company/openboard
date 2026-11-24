---
id: 302
title: Refuse a narrowed caller's watchers
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/src/operations/watchers/index.ts
  - packages/server/src/auth/access.ts
  - packages/server/src/deps.ts
  - packages/contract/src/operations/watchers/index.ts
  - docs/protocol.md
  - tools/conformance/score.json
  - packages/server/test/watchers/narrowed.test.ts
conformance: ["watchers/refuses a caller narrowed with x-board-can its principal's watchers: registering, pulling, and acking"]
modes: [local, hosted]
depends_on: [286, 300]
status: done
claimed_by: codex
issue: 487
---

## What the user does
As a board owner who hands an agent a narrowed credential, I know it cannot register, pull or ack watchers in its principal's name.

## Done when
- [x] `bun test packages/server/test/watchers/narrowed.test.ts` passes: with `x-board-can: dev=all`, `POST /watchers`, `GET /watchers/matches` and `POST /watchers/matches/<any id>/ack` each answer 403 `forbidden` before looking anything up (an unknown match ID is 403, not 404), and the principal's registration is unchanged; an `obt_` token, always narrowed by its pin, gets the same 403 on all three while `GET /watchers` still answers
- [x] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `watchers/refuses a caller narrowed with x-board-can its principal's watchers: registering, pulling, and acking`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Narrowed callers on sync's records (M14); on grants (288, 289); on webhooks (325).

## Notes
docs/auth.md "Upstream's model" 6 and "Routes a claimed token can never reach" (watchers: `POST /watchers`, `GET /watchers/matches`, acks); D17 ("Narrowed callers, including claimed tokens, still cannot register"). The kit's `narrowedOut` accepts only 403 `forbidden`. Whether a request was narrowed is what 286 records on the principal (`packages/server/src/auth/access.ts`); an `obt_` token counts as narrowed even without the header (docs/auth.md "Pinned narrowing").
