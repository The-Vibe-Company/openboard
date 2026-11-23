---
id: 402
title: Hold every caller to its can on every operation
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/tokens.ts
  - packages/server/src/auth/access.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/deps.ts
  - packages/server/test/auth/caller-can.test.ts
conformance: []
modes: [local]
depends_on: [120, 152]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, a connection I created with `--can 'dev=read'`, or a member whose role caps them, can do on a channel only what that `can` allows, on every route.

## Done when
- [ ] with the secret of a direct connection created with `--can 'dev=read'`, `ob read dev` works, while `ob post dev hi` and `ob post ops hi` print `error: forbidden` and post nothing
- [ ] a member's session posting works but `POST /x/connections` stays 403, and an `obt_` token keeps its pinned-can behaviour unchanged (120's tests still pass)

## Out of scope
- Making, changing or explaining grants (M10, 276-295); `x-board-can` narrowing (286).

## Notes
Found by the orchestrator while reviewing #311: only `obt_` tokens are held to a `can` today (`keepInsidePin` in `packages/server/src/auth/tokens.ts`, via `pinnedCan`); a direct connection's grant `can` and a member's role-capped `can` (`grants.allUsersCan`, 152) are shown in `/me` but not enforced. Generalize the same check: every verified principal carries the `can` it acts under (pinned can for `obt_`, the connection's grant can for `obc_`, the role-capped `*` grant for a session member, everything for the local owner), and the pipeline checks each operation's `access` against it exactly as `keepInsidePin` does (fromInput by channel/path and `re`, fromMessage by the message's channel with unreadable answering 404 `message_not_found`, `any` needing the permission everywhere). Keep the implications of upstream's `IMPLIES` (`grants.withImplied`). Move the shared check out of `tokens.ts` into `auth/access.ts` if it helps the size limits.
