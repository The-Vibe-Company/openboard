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
conformance: []
modes: [local, hosted]
depends_on: [296]
status: draft
claimed_by: null
issue: 472
---

## What the user does
As a team on another CI, my pipeline posts with its own issuer's token through a grant naming that issuer and a `sub`.

## Done when
- [ ] after `ob grants create --oidc https://gitlab.example.com --claim 'sub=project_path:acme/api:*' --claim project_id=42 --can 'ci/=post'`, `bun test packages/server/test/auth/oidc-issuer.test.ts` passes: a token from that issuer whose `sub` starts with `project_path:acme/api:` and whose `project_id` is `42` posts as `oidc:<issuer>:<sub>`; another `sub` or claim answers 403; an issuer no grant on the board names answers 401 without any fetch

## Out of scope
- The `oidc` principal's shape, checked when the grant is made (276).

## Notes
docs/auth.md "The verifier chain" 5 ("any issuer a grant on this board names; keys by OIDC discovery, cached, https only, no redirects, no private hosts"); upstream "Grants" on `oidc` claims (a repeated claim is any of its values).
