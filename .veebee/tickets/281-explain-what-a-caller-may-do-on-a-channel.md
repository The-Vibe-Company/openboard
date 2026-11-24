---
id: 281
title: Explain what a caller may do on a channel
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/explain.ts
  - packages/contract/src/operations/index.ts
  - packages/core/src/access/resolve.ts
  - packages/core/test/access/resolve.test.ts
  - packages/core/src/access/explain.ts
  - packages/core/test/access/explain.test.ts
  - packages/server/src/operations/explain.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/grants/explain.test.ts
  - packages/cli/src/commands/explain.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/test/explain.test.ts
  - tools/conformance/src/run.ts
  - tools/conformance/src/drivers.ts
  - tools/conformance/src/score.ts
  - tools/conformance/test/score.test.ts
  - docs/decisions.md
  - docs/auth.md
  - docs/codebase.md
conformance: ["grants/lets the most specific pattern decide, then the closest principal there, and adds up ties"]
modes: [local, hosted]
depends_on: [280, 213]
status: draft
claimed_by: null
issue: 456
---

## What the user does
As a board owner or an agent, I ask why someone may or may not act on a channel, `ob grants explain dev/web`, and see the pattern and grants that decide.

## Done when
- [ ] `ob grants explain dev/web` prints upstream's sentence (`dev/ wins over *. Closest grant for you: g5 (--connection): read, post.`), `--json` prints `{ explanation: { channel, pattern, over, level, grants, capped, can } }`; with `manage` at `*`, `ob grants explain --user u_… dev/web` explains that person, while a caller without it gets `error: forbidden: …` explaining someone else and `grants: []` explaining itself
- [ ] `bun test packages/server/test/grants/explain.test.ts` passes: the most specific pattern decides, then the closest principal level there (`principal`, then `group`, then `everyone`), grants tied at that level add up, then the role cap; every request's own `can` follows the same order
- [ ] `bun run conformance` runs upstream's kit as D43's connection and then as a person (the local owner; hosted, the conformance organization's owner through a personal token), counting the second run only for checks the first skipped; in both modes it passes `grants/lets the most specific pattern decide, then the closest principal there, and adds up ties`, recorded with `--update` under `local` and `hosted`

## Out of scope
- `everyone` (282); explaining a connection (295).

## Notes
- Upstream `GET /grants/explain` (query `channel`, and for someone else `user`, `project` and `environment`, `github` and `workflow`, `branch`, `event`, `oidc` and `claim=name=value`, `app`) and `Explanation` in `@vercel/board`; `docs/01-board/09-access.md` "How grants combine". Explain lives in its own files (`contract/operations/explain.ts`, `server/operations/explain.ts`, `core/access/explain.ts`, `cli/commands/explain.ts`) so 295 changes it while 282-289 change grants.
- **Proposal for the owner: a second conformance run.** Upstream's grant checks keep their run inside a pattern they close with a grant naming the run itself (`self()` in `@vercel/board`'s `dist/conformance-*.mjs`), which can name a person, a project or an app, never a connection: with D43's connection, the checks recorded by 281, 282, 285, 288 and 289 are skipped ("closing a pattern to everyone would close it to this run too…"). A run as the owner skips the lockout check instead (284). Proposed: run the kit twice in `tools/conformance/src/run.ts`, the second run counted only where the first skipped, so no recorded check can be lost to it; record a decision amending D43 in docs/decisions.md and update docs/auth.md "The credential that runs conformance" and docs/codebase.md 6.3. Until the owner agrees, stop with `needs-decision`: without it M10's "10 pass" cannot be met. Depends on 213 and 214, the last tickets before it to change `tools/conformance/src/run.ts` (through 192), docs/codebase.md and docs/auth.md.

No longer waits for 214 (orchestrator, 2026-11-24): it only ordered edits to `tools/conformance/src/run.ts` and the docs; whichever lands second rebases. The second conformance run proposed above is approved (orchestrator, for the owner): it counts only checks the first run skipped, so no recorded check can be lost; record the decision amending D43 as proposed and go ahead without `needs-decision`.
