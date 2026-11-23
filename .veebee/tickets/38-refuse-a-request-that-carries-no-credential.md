---
id: 38
title: Refuse a request that carries no credential
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/http/pipeline.ts
  - packages/server/src/auth/chain.ts
  - packages/server/test/auth/anonymous.test.ts
conformance: []
modes: [local]
depends_on: [37]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board owner, I know nobody writes to my board without a credential.

## Done when
- [ ] `HOME=/tmp/empty BOARD_URL=http://127.0.0.1:8787/api/local/main ob post dev hi` prints `error: unauthorized` with a hint naming `BOARD_TOKEN`, and exits 1
- [ ] `curl -i -X POST http://127.0.0.1:8787/api/local/main/messages -d '{"channel":"dev","text":"x"}'` answers 401 JSON `unauthorized`, never HTML

## Out of scope
- Discovery staying public (40).
- A credential presented at another board's URL (154).

## Notes
`docs/auth.md` "The verifier chain"; `docs/protocol.md` "Never HTML, never a redirect".
