---
id: 195
title: Gate sign-up with OPENBOARD_SIGNUP
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/auth/providers/index.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/src/views/accounts.ts
  - packages/driver-sql/src/views/invitations.ts
  - packages/ports/testkit/store/accounts.test-suite.ts
  - packages/server/test/auth/signup.test.ts
  - docs/auth.md
  - docs/decisions.md
conformance: []
modes: [local, hosted]
depends_on: [169, 177, 182]
status: draft
claimed_by: null
issue: 356
---

## What the user does
As the operator of an invite-only board, only people who arrive with an invitation can sign up, and they land in the organization that invited them.

## Done when
- [ ] `bun test packages/server/test/auth/signup.test.ts` passes, through the GitHub provider's test double: with `signup: "invite"`, a new identity signing in from `/auth/github/start` is refused with 403 `forbidden` and no person is created; one starting from `/auth/github/start?invitation=<token>` of a live invitation becomes a person and a member with the invited role in the sign-in's transaction, and is redirected to `/<org>/main`; with `closed` no new person is created even with an invitation, with `open` anyone is; a known person signs in in all three
- [ ] the same file passes on Postgres: `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/auth/signup.test.ts`
- [ ] in the same file, the callback redirects a returning member to `/<org>/main` and a person without a membership to `/new` (docs/auth.md "Sign-up and sign-in")

## Out of scope
- The `/signin`, `/new` and `/invite/:token` pages (M8, 218, 219, 220).
- Rate limits on sign-in attempts (205) and organization creation (203).
- Choosing the hosted default (Q6): unset stays `closed` in both modes; production sets the variable (215).

## Notes
- Today `admitNew` is `signup === "open"` (`packages/server/src/auth/providers/index.ts`), the callback always lands on `/new`, and `invite` behaves like `closed`.
- docs/auth.md draws `/invite/:token` storing the token "in a short-lived cookie". Make that cookie the pending sign-in one: `GET /auth/<provider>/start?invitation=<token>` adds the token to `__Host-ob_signin` (D48), so any instance finishes the sign-in and the token never sits in server memory. The request log already drops query strings; keep it that way. The callback passes the token's hash to `platform.signIn`, which in `invite` mode admits a new person only when the invitation is live (unrevoked, unused, unexpired, and matching a bound email, 148), and accepts it in the same transaction (one membership per person, 138). Record this in docs/decisions.md and update docs/auth.md's diagram.
- An expired or used invitation refuses the sign-up with the codes acceptance already uses (`invitation_used`, 410); the refusal is a JSON answer at `/auth/<provider>/callback`, outside `/api` (D8).
- `packages/ports/src/store.ts` is an append point; the testkit case runs on both drivers.
- Depends on 177 and 182, which change `packages/server/test/**` and `packages/server/src/auth/**`.
