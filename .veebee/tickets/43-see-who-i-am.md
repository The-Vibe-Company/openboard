---
id: 43
title: See who I am
milestone: M1-walking-skeleton
package: cli
writes:
  - packages/contract/src/operations/actors.ts
  - packages/contract/src/entities/actors.ts
  - packages/server/src/operations/actors.ts
  - packages/server/test/me.test.ts
  - packages/cli/src/commands/whoami.ts
  - packages/cli/src/commands/index.ts
conformance: []
modes: [local]
depends_on: [38]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a developer, I ask the board who it thinks I am.

## Done when
- [ ] `ob whoami` prints the local owner, `org local (owner)`, `board main` with its URL, and credential `local`
- [ ] `curl -H "authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/local/main/me` answers upstream's `/me` fields plus `openboard: { org, board, role, credential: "local" }`

## Out of scope
- People, personal tokens and the full four-line view (158).
- Choosing a board (157).

## Notes
`docs/auth.md` "CLI sign-in" (`ob whoami` layout and the `openboard` object of `GET /me`).
