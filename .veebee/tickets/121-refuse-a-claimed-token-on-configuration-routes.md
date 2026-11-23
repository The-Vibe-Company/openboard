---
id: 121
title: Refuse a claimed token on configuration routes
milestone: M4-accounts-organizations-and-auth
package: server
writes:
  - packages/server/src/auth/tokens.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/test/auth/config-routes.test.ts
conformance: []
modes: [local]
depends_on: [120]
status: done
claimed_by: codex
issue: 121
---

## What the user does
As an owner, a leaked sandbox token cannot change my board's configuration.

## Done when
- [x] with an `obt_` bearer, `curl -X POST http://127.0.0.1:8787/api/local/main/x/connections -d '{"name":"x","can":{"*":["all"]}}'` answers 403 `forbidden` and creates nothing, while `ob read dev` still works
- [x] the refusal is one rule for every `/x/` operation (board or platform scope), checked before the handler, so `GET /x/connections` (131) and `GET /api/x/me` (134) refuse an `obt_` bearer with no change of theirs

## Out of scope
- Building `GET /x/connections` (131) and `GET /api/x/me` (134); they inherit the rule.
- Routes outside `/x/` added later (webhooks, grants, watchers) refuse it in their own tickets.

## Notes
`docs/auth.md` "Routes a claimed token can never reach". Orchestrator decision on #121: do not wait for 131 and 134; put the rule where every `/x/` operation passes (the pipeline, or the operation's contract, e.g. an `xRoute`/`configuration` flag derived from the path) and test it on `POST /x/connections`. Add the files you need to `writes`.
