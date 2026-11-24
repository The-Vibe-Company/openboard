---
id: 203
title: Rate-limit organization creation per person or IP
milestone: M7-hosted-deploy
package: server
writes:
  - packages/server/src/operations/orgs.ts
  - packages/server/test/ha/org-creation-limit.test.ts
conformance: []
modes: [local, hosted]
depends_on: [201]
status: draft
claimed_by: null
issue: null
---

## What the user does
As the operator of a shared instance, someone creating organizations in a loop is stopped after three a day per person and ten a day per IP, on every instance.

## Done when
- [ ] `OPENBOARD_TEST_DRIVER=postgres OPENBOARD_TEST_DATABASE_URL=postgres://openboard:openboard@127.0.0.1:55432/openboard bun test packages/server/test/ha/org-creation-limit.test.ts` passes, requests alternating between two instances: a person's fourth attempt to create an organization within a day answers 429 `rate_limited` with a `retry-after` (the second and third answered 409 `already_in_org`: attempts count, not creations), and the eleventh attempt from one IP across several people answers it too; a refused attempt writes nothing
- [ ] the same file passes on SQLite: `bun test packages/server/test/ha/org-creation-limit.test.ts`

## Out of scope
- The one-organization rule itself (138); sign-up gating (195).
- Invitations per organization (204).

## Notes
- docs/auth.md "Rate limits" († org creation per person 3/day, per IP 10/day) and "Sign-up and sign-in" ("Rate-limited per person and per IP"). Use the platform-level counter 201 landed (`takeRate`), keyed by person ID and by the client IP 199 provides; count every attempt that passes validation, before the transaction in `createOrgHandler` (`packages/server/src/operations/orgs.ts`).
- Attempts count, not creations: with one organization per person (138), a per-person limit on creations alone could never bite, while repeated attempts still cost a transaction each.
- Organization deletion (207) changes the same file and comes after this ticket.
