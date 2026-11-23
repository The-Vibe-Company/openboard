---
id: 118
title: Connect an agent from the terminal
milestone: M4-accounts-organizations-and-auth
package: cli
writes:
  - packages/cli/src/commands/connect.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/config.ts
  - packages/cli/test/connect.test.ts
conformance: []
modes: [local]
depends_on: [117]
status: draft
claimed_by: null
issue: 118
---

## What the user does
As an agent in a sandbox, I connect with the board URL and the secret on stdin, never on the command line.

## Done when
- [ ] `ob connect http://127.0.0.1:8787/api/local/main --as fixer-2 < fixers.secret` stores the agent token, and `ob whoami` then prints `fixer-2 via fixers` with credential `agent`
- [ ] `OPENBOARD_SECRET=… ob connect <url> --as fixer-3` and `--secret-file fixers.secret` work the same

## Out of scope
- Refreshing the stored token before expiry: the CLI calls 122's route.

## Notes
D42; `docs/codebase.md` 5.5.
