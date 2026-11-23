---
id: 37
title: Keep the local owner token in a file only I can read
milestone: M1-walking-skeleton
package: app
writes:
  - apps/openboard/src/serve.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/auth/local-owner.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/test/auth/local-owner.test.ts
  - packages/cli/src/config.ts
  - tools/conformance/src/run.ts
conformance: []
modes: [local]
depends_on: [36]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a developer, I start `ob serve` and `ob` finds the owner credential by itself, without it ever being printed.

## Done when
- [ ] after `ob serve`, `~/.config/openboard/local/8787.json` exists with mode `0600`, and nothing the server printed contains the token
- [ ] with no `BOARD_TOKEN` set, `ob post dev hi` succeeds and `ob read dev --json` shows it written by `ob:user:local-<your OS user>`

## Out of scope
- Refusing a request with no credential (38).
- `ob whoami` (43).
- Connections and people (M4).

## Notes
`docs/auth.md` "Local mode", "Secret and token formats" (`obl_`) and verifier chain step 4. `bun run conformance` uses this token until 111 (`docs/codebase.md` 6.3 step 2).
