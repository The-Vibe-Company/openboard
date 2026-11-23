---
id: 116
title: Let a profile change only its own messages
milestone: M4-accounts-organizations-and-auth
package: core
writes:
  - packages/core/src/messages/edit.ts
  - packages/core/src/messages/delete.ts
  - packages/core/test/messages/ownership.test.ts
  - packages/server/test/auth/ownership.test.ts
conformance: ["core/lets a profile change only its own messages, and its principal all of them"]
modes: [local]
depends_on: [83, 112]
status: draft
claimed_by: null
issue: 116
---

## What the user does
As an agent, I cannot rewrite another agent's messages; my connection, as itself, can tidy up after all of us.

## Done when
- [ ] as `--as fixer-2`, `ob edit` or `ob delete` of a message written by `fixer-3` or by the connection itself prints `error: forbidden` and changes nothing
- [ ] the connection as itself edits and deletes `fixer-2`'s message, which keeps `fixer-2` as its author

## Out of scope
- Tasks a profile made (M10, 292).

## Notes
`docs/auth.md` "Upstream's model" point 4.
