---
id: 169
title: Create an organization on a hosted instance
milestone: M5-postgres-driver
package: server
writes:
  - .veebee/tickets/169-create-an-organization-on-a-hosted-instance.md
  - packages/server/test/accounts.test.ts
  - packages/server/test/support/sign-in.ts
  - packages/server/test/hosted.test.ts
  - packages/server/test/support/app.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/http/scope.ts
  - apps/openboard/src/compose.ts
conformance: []
modes: [hosted]
depends_on: [167, 168]
status: done
claimed_by: codex
issue: 249
---

## What the user does
As a person signing in to a hosted OpenBoard, I create my organization and get its board `main`, stored in Postgres.

## Done when
- [ ] with `OPENBOARD_DATABASE_URL`, `OPENBOARD_PUBLIC_URL` and the GitHub sign-in variables set, `bun apps/openboard/src/main.ts serve`, then signing in at `<public URL>/auth/github/start` and `curl -b cookies -H 'x-ob-csrf: <csrf>' -H 'origin: <public URL>' -X POST <public URL>/api/x/orgs -d '{"name":"Acme","slug":"acme"}'` answers the organization, an `owner` membership and board `main`; `curl -b cookies <public URL>/api/acme/main/me` answers role `owner`
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/hosted.test.ts` passes: an app in hosted mode signs a person in through the GitHub provider's test double, creates `acme`, and `/api/acme/main/me` answers `owner`, while `/api/me` (the local alias) answers 404

## Out of scope
- `OPENBOARD_SIGNUP` gating (M7, 195); slug rules and the one-organization rule, already built (136-138).
- The organization and connection conformance runs on (170).
- The sign-up pages (M8).

## Notes
- The flow is 133 and 134's (`docs/auth.md` "Sign-up and sign-in", one transaction), built and tested in local mode. This ticket makes it hold in hosted mode on Postgres: `config.mode === "hosted"` (`packages/server/src/deps.ts`), no local owner verifier (`verifiers()` in `packages/server/src/auth/chain.ts`), no bare `/api` alias (`boardPath()` in `packages/server/src/http/scope.ts`), and `compose.ts` passing the sign-in providers to `createApp` in hosted mode as it does locally.
- `makeApp()` (`packages/server/test/support/app.ts`) gains a hosted-mode option; GitHub is never called from tests (outbound HTTP comes from `deps`, docs/codebase.md 5.6), and there is no auth bypass: the provider's test double answers the real token exchange.
- Migration 0001 seeds `local/main` on Postgres too; in hosted mode no credential reaches it. Whether `local` should be a reserved slug in hosted mode is left to 136's reserved list.
- Depends on 167 (both change `apps/openboard/src/compose.ts`) and 168 (makeApp on Postgres).
