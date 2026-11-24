---
id: 315
title: Sign deliveries with a custom scheme
milestone: M11-webhooks-and-watchers
package: server
writes:
  - apps/openboard/src/compose.ts
  - apps/openboard/src/config.ts
  - apps/openboard/test/config.test.ts
  - docs/codebase.md
  - docs/decisions.md
  - docs/protocol.md
  - packages/cli/src/commands/webhooks/create.ts
  - packages/cli/test/webhooks.test.ts
  - packages/contract/src/entities/webhooks/index.ts
  - packages/core/src/webhooks/payload.ts
  - packages/core/src/webhooks/signing.ts
  - packages/core/test/webhooks/signing.test.ts
  - packages/server/openapi.json
  - packages/server/src/deps.ts
  - packages/server/src/jobs/sign.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/operations/webhooks/index.ts
  - packages/server/src/webhooks/request.ts
  - packages/server/test/support/app.ts
  - packages/server/test/webhooks/sign-custom.test.ts
  - packages/server/test/webhooks/sign-github.test.ts
  - skills/openboard/references/webhooks.md
conformance: []
modes: [local, hosted]
depends_on: [314]
status: done
claimed_by: codex
issue: 500
---

## What the user does
As a board admin whose receiver signs in no preset's shape, I describe its scheme field by field and the board signs exactly that way.

## Done when
- [x] `bun test packages/server/test/webhooks/sign-custom.test.ts` passes: `{ "algorithm": "hmac-sha512", "signatureHeader": "x-signature", "signatureFormat": "sha512={sig}", "encoding": "base64url", "signedPayload": "{method} {url}\n{ts}\n{body}", "timestampHeader": "x-when", "timestampFormat": "iso8601", "idHeader": "x-delivery" }` produces headers an independent computation in the test reproduces; each `encoding` and `timestampFormat` has a case
- [x] `bun test packages/core/test/webhooks/signing.test.ts` passes: an unknown token in `signatureFormat` or `signedPayload`, a `signatureFormat` without `{sig}`, a `{ts}` with no timestamp, an `algorithm` outside `hmac-sha256|hmac-sha512|none`, or a scheme that also names a preset answer 400 `invalid_signing` naming the field

## Out of scope
- Asymmetric signatures (not in docs); the `none` algorithm and static headers (316).

## Notes
docs/protocol.md "Signing" (the scheme object: tokens `{sig}` `{ts}` in the format, `{ts}` `{id}` `{body}` `{method}` `{url}` in the signed payload). The presets of 304 and 312-314 become fixed instances of this object, so `jobs/sign.ts` keeps one code path; say so in the PR if the earlier tickets left branches to fold in.


Rollout and review follow-up approved on [issue #500](https://github.com/The-Vibe-Company/openboard/issues/500#issuecomment-7141464319): gate custom scheme creation by default, bound signing template expansion, and preserve custom CLI secret files verbatim.
