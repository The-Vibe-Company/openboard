---
id: 314
title: Sign deliveries with the ts-id-body preset
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/core/src/webhooks/signing.ts
  - packages/core/test/webhooks/signing.test.ts
  - packages/server/src/jobs/sign.ts
  - packages/server/test/webhooks/sign-ts-id-body.test.ts
conformance: []
modes: [local, hosted]
depends_on: [313]
status: draft
claimed_by: null
issue: null
---

## What the user does
As a board admin pointing a webhook at an orchestrator's trigger that signs `v1=` over `timestamp.id.body` with header names of its own, I name those headers and paste its secret, and the trigger accepts the deliveries.

## Done when
- [ ] `bun test packages/server/test/webhooks/sign-ts-id-body.test.ts` passes: with `{ "preset": "ts-id-body", "signatureHeader": "x-sig", "timestampHeader": "x-ts", "idHeader": "x-id", "secret": … }` a delivery carries `x-id: dl_…`, `x-ts: <unix seconds>` and `x-sig: v1=<hex HMAC-SHA256 of "<ts>.<id>.<body>">`, which `openssl dgst -sha256 -hmac` reproduces
- [ ] `bun test packages/core/test/webhooks/signing.test.ts` passes: the preset without any of its three header names, or with a header name that is not a valid token or is one the board sets itself (`content-type`, `content-length`, `host`, `user-agent`), answers 400 `invalid_signing` naming the field

## Out of scope
- Verifying inbound events in this scheme (327 reuses `jobs/sign.ts`); any receiver's name in code: header names are configuration (AGENTS.md non-negotiable 1).

## Notes
docs/protocol.md "Signing" (ts-id-body: "header names supplied by the receiver"), D16, and the worked example "board event → … routine" whose subscription uses this preset with the receiver's header names and secret. The receiver's name never appears in `packages/` (the boundaries deny list fails the build).
