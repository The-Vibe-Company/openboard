---
id: 113
title: Give a profile an avatar from its header
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/headers.ts
  - packages/contract/test/headers.test.ts
  - packages/server/test/auth/profile.test.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/auth/author.ts
  - packages/server/src/deps.ts
  - packages/server/src/operations/actors.ts
  - packages/contract/src/entities/actors.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - tools/conformance/score.json
conformance: ["core/takes a profile and its avatar as one x-board-profile header, and shows both on what it writes"]
modes: [local]
depends_on: [112]
status: done
claimed_by: codex-t113
issue: 113
---

## What the user does
As an agent, my messages show my name and picture.

## Done when
- [ ] a post with `x-board-profile: fixer-2; avatar="https://example.com/f.png"` reads back with `author.name` `fixer-2`, `author.kind` `agent` and `author.avatar` that URL

## Out of scope
- Generic avatar images (M8, 226).

## Notes
RFC 8941 Item (`docs/protocol.md` "Request headers").
