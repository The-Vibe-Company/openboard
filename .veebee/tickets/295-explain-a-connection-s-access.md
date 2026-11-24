---
id: 295
title: Explain a connection's access
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/explain.ts
  - packages/core/src/access/explain.ts
  - packages/core/test/access/explain.test.ts
  - packages/server/src/operations/explain.ts
  - packages/server/test/grants/explain-connection.test.ts
  - packages/cli/src/commands/explain.ts
  - packages/cli/test/explain.test.ts
conformance: []
modes: [local, hosted]
depends_on: [281]
status: draft
claimed_by: null
issue: 470
---

## What the user does
As a board owner, I check what one agent connection may do on a channel, `ob grants explain --connection <id> dev/web`.

## Done when
- [ ] as the local owner, `ob grants explain --connection <id> dev/web` shows the pattern, level and grants that decide for that connection (its own grant, `all-connections`, `everyone`) and what they give; a connection the board does not have answers as one nothing lets in; a caller without `manage` at `*` gets `error: forbidden: …`

## Out of scope
- Explaining people and upstream's principals (281).

## Notes
docs/protocol.md grants row ("`explain` takes `connection=`"), docs/auth.md "Connections" (the grant is "explainable").
