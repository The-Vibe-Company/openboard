---
id: 297
title: Accept a grant naming another OIDC issuer
milestone: M10-access
package: server
writes:
  - packages/server/src/auth/oidc.ts
  - packages/core/src/access/oidc-claims.ts
  - packages/core/test/access/oidc-claims.test.ts
  - packages/server/test/auth/oidc-issuer.test.ts
  - apps/openboard/src/compose.ts
  - docs/auth.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/core/src/index.ts
  - packages/driver-sql/migrations/0025-oidc-keys.sql
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/src/views/auth/oidc.ts
  - packages/driver-sql/src/views/grants.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/ports/src/grants.ts
  - packages/ports/src/oidc-keys.ts
  - packages/ports/src/store.ts
  - packages/ports/testkit/isolation-seed.ts
  - packages/ports/testkit/isolation.test-suite.ts
  - packages/server/src/auth/author.ts
  - packages/server/src/auth/chain.ts
  - packages/server/src/deps.ts
  - packages/server/src/operations/grants/create.ts
  - packages/server/src/operations/grants/oidc.ts
  - packages/server/src/operations/grants/update.ts
  - packages/server/src/public-host.ts
  - packages/server/test/auth/github-oidc.test.ts
  - packages/server/test/support/app.ts
  - skills/openboard/SKILL.md
conformance: []
modes: [local, hosted]
depends_on: [296]
status: done
claimed_by: codex
issue: 472
---

## What the user does
As a team on another CI, my pipeline posts with its own issuer's token through a grant naming that issuer and a `sub`.

## Done when
- [x] after `ob grants create --oidc https://gitlab.example.com --claim 'sub=project_path:acme/api:*' --claim project_id=42 --can 'ci/=post'`, `bun test packages/server/test/auth/oidc-issuer.test.ts` passes: a token from that issuer whose `sub` starts with `project_path:acme/api:` and whose `project_id` is `42` posts as `oidc:<issuer>:<sub>`; another `sub` or claim answers 403; an issuer no grant on the board names answers 401 without any fetch

## Out of scope
- The `oidc` principal's shape, checked when the grant is made (276).

## Notes
docs/auth.md "The verifier chain" 5 ("any issuer a grant on this board names; keys by OIDC discovery, cached, https only, no redirects, no private hosts"); upstream "Grants" on `oidc` claims (a repeated claim is any of its values).
