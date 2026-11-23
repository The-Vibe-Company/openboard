---
id: 03
title: Refuse a conformance pin that differs from the contract's protocol version
milestone: M0-foundations
package: tools
writes:
  - tools/conformance/test/pin.test.ts
  - tools/conformance/package.json
  - tools/conformance/tsconfig.json
  - packages/contract/src/index.ts
  - bun.lock
conformance: []
modes: []
depends_on: [02]
status: claimed
claimed_by: claude-opus-t03
issue: 3
---

## What the user does
As a contributor, I cannot bump the upstream kit without the protocol version the board reports moving with it.

## Done when
- [ ] changing the `@vercel/board` version in `tools/conformance/package.json` without changing `UPSTREAM_VERSION` makes `bun run verify` fail with both versions in the message

## Out of scope
- Raising the pin itself: an owner-only `chore(conformance)` PR (`docs/codebase.md` 7.3).
- Discovery reporting the version (40).

## Notes
`docs/codebase.md` 6.3 step 2 and 7.3.
