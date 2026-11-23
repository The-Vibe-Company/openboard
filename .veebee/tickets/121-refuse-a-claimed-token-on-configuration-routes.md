---
id: 121
title: Refuse a claimed token on configuration routes
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/tokens.ts
  - packages/server/test/auth/config-routes.test.ts
conformance: []
modes: [local]
depends_on: [120]
status: draft
claimed_by: null
issue: 121
---

## What the user does
As an owner, a leaked sandbox token cannot change my board's configuration.

## Done when
- [ ] with an `obt_` bearer, `curl http://127.0.0.1:8787/api/local/main/x/connections` and `curl http://127.0.0.1:8787/api/x/me` answer 403 `forbidden`, while `ob read dev` still works

## Out of scope
- Routes added later (webhooks, grants, watchers) refuse it in their own tickets.

## Notes
`docs/auth.md` "Routes a claimed token can never reach".
