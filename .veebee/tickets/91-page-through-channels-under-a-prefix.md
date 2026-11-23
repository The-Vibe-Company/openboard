---
id: 91
title: Page through channels under a prefix
milestone: M2-messages-and-threads
package: server
writes:
  - packages/contract/src/operations/channels.ts
  - packages/server/src/operations/channels.ts
  - packages/driver-sql/src/views/channels.ts
  - packages/server/test/channels.test.ts
  - packages/ports/src/store.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/store/channels.test-suite.ts
  - packages/cli/src/main.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/output.ts
  - packages/cli/test/cli.test.ts
  - README.md
conformance: ["core/lists channels a page at a time, and the ones under a prefix"]
modes: [local]
depends_on: [52]
status: done
claimed_by: claude-t91
issue: 91
---

## What the user does
As a person, I list a board's channels a page at a time, or only those under a prefix.

## Done when
- [x] `ob channels dev --limit 1` prints one channel and the command for the next page; following it lists `dev` and `dev/web` once each

## Out of scope
- Creating channels (92).

## Notes
`vb channels` reference (`prefix`, `--limit`, `--after`).
