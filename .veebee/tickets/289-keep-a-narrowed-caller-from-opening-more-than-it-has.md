---
id: 289
title: Keep a narrowed caller from opening more than it has
milestone: M10-access
package: core
writes:
  - packages/core/src/access/grant-changes.ts
  - packages/core/test/access/grant-changes.test.ts
  - packages/server/test/grants/narrowed-everyone.test.ts
conformance: ["grants/lets no caller narrowed with x-board-can let anyone in where everyone gets more than it has"]
modes: [local, hosted]
depends_on: [288]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, an agent narrowed out of a pattern that everyone reads cannot grant anyone anything while it lacks what everyone has.

## Done when
- [ ] narrowed with `x-board-can: *=all;ops/open/=` while an everyone grant gives `read` at `ops/open/`, any `POST /grants`, even one on `ops/ci/`, answers 403 `forbidden`
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `grants/lets no caller narrowed with x-board-can let anyone in where everyone gets more than it has`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- Batches judged the same way (285 already judges `everyone` with all made).

## Notes
Upstream `POST /grants` "and what `everyone` gives wherever it gives something".
