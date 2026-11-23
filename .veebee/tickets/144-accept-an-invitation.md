---
id: 144
title: Accept an invitation
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/contract/src/operations/invitations.ts
  - packages/server/src/operations/invitations.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/ports/testkit/store/invitations.test-suite.ts
  - packages/server/test/invitations.test.ts
  - packages/ports/src/store.ts
  - .veebee/tickets/144-accept-an-invitation.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/sdk/src/client.ts
  - packages/server/openapi.json
  - packages/server/src/http/openapi.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/operations/index.ts
conformance: []
modes: [local]
depends_on: [143]
status: done
claimed_by: Codex
issue: 145
---

## What the user does
As an invited person, I join the organization with the role I was given.

## Done when
- [x] a second person, signed in with GitHub, `POST http://127.0.0.1:8787/api/x/invitations/accept {"token":…}` becomes a `member` of `acme`, and `GET http://127.0.0.1:8787/api/x/orgs/acme/members` lists both people

## Out of scope
- Used, revoked or expired links (147).
- Membership caps on boards (152).

## Notes
One transaction with `ob.member.added` (`docs/auth.md`). The [orchestrator confirmed](https://github.com/The-Vibe-Company/openboard/issues/145#issuecomment-7116543071) that M4 acceptance runs on local SQLite with `OPENBOARD_SIGNUP=open` and GitHub configured. Tests fake the provider and use the `/api/x/…` routes with the session cookie and `x-ob-csrf`.
