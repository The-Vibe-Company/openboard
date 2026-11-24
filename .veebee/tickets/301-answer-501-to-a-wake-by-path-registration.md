---
id: 301
title: Answer 501 to a wake-by-path registration
milestone: M11-webhooks-and-watchers
package: core
writes:
  - tools/conformance/score.json
  - packages/contract/src/operations/watchers/index.ts
  - packages/server/src/operations/watchers/index.ts
  - packages/server/openapi.json
  - packages/core/src/watchers/register.ts
  - packages/core/test/watchers/register.test.ts
  - packages/server/test/watchers/wake.test.ts
conformance: ["watchers/wakes by path only where its discovery says so, and only a Vercel project"]
modes: [local, hosted]
depends_on: [300]
status: done
claimed_by: codex
issue: 486
---

## What the user does
As an agent built for upstream's board, I learn at once that this board wakes no URL and no path, so I pull my matches instead.

## Done when
- [ ] `bun test packages/server/test/watchers/wake.test.ts` passes: `POST /watchers` with `{ "path": "/conformance", "watch": {} }` answers 501 `no_wake_by_path`, with a `url` 501 `no_wake_by_url`, and neither replaces the caller's registration; discovery (`GET /`) still has no `wake_by_path`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `watchers/wakes by path only where its discovery says so, and only a Vercel project`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Outbound webhooks, this board's way of waking code (304); `POST /wake` stays 404 (docs/protocol.md "Sync (deferred)").

## Notes
docs/protocol.md "Watchers" (`url` → 501 `no_wake_by_url`, `path` → 501 `no_wake_by_path`) and "Deferred and dropped" (wake by path or URL dropped). The upstream message for `no_wake_by_path` is "this board wakes a url, not a path: register `url` instead"; ours says it wakes neither and points at `GET /watchers/matches` and webhooks. The check also re-registers `{ watch: {} }` afterwards, which 300 accepts.
