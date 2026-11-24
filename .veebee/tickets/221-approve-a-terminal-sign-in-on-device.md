---
id: 221
title: Approve a terminal sign-in on /device
milestone: M8-front
package: web
writes:
  - apps/web/src/routes/device.tsx
  - apps/web/e2e/device.spec.ts
  - packages/contract/src/operations/accounts.ts
  - packages/server/src/operations/accounts.ts
  - packages/ports/src/store.ts
  - packages/driver-sql/src/views/device.ts
  - packages/server/test/device-preview.test.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/server/src/operations/index.ts
  - packages/server/src/http/pipeline.ts
  - docs/auth.md
  - packages/server/test/isolation/cases.ts
  - apps/web/src/routes/device.css
  - packages/server/test/log.test.ts
conformance: []
modes: [local, hosted]
depends_on: [218]
status: done
claimed_by: Codex
issue: 382
---

## What the user does
As a person signing in from a terminal with `ob login`, I open `/device`, check that the code and the client name match my terminal, and approve it.

## Done when
- [ ] `bun run e2e apps/web/e2e/device.spec.ts` passes: with a device sign-in started (`POST /api/x/auth/device { clientName: "ob" }`), a signed-in person opening `/device` types the user code, sees the client name `ob` and their organization, approves, and the poll (`POST /api/x/auth/device/token`) then answers an `obp_` token for that organization
- [ ] in the same spec, an unknown or expired code shows "This code is not valid" and approves nothing, and a person not signed in sees "Sign in to approve" linking to `/signin`, with no approve button
- [ ] `bun test packages/server/test/device-preview.test.ts` passes: `GET /api/x/auth/device/:userCode` answers the client name and expiry to a signed-in person only, 404 `not_found` for an unknown or used code, and never the device code

## Out of scope
- The CLI side of the flow, already built (156).
- Choosing among several organizations (v1: one per person, D34).

## Notes
- docs/auth.md "CLI sign-in (device flow)": the person "sees the code and the client name, picks the organization (v1: their only one), and approves" through `POST /api/x/auth/device/approve { userCode, org }` with the session, `Origin` and `x-ob-csrf`. No route lets the page read the client name for a user code yet: this ticket adds `previewDeviceSignIn` to the contract (`packages/contract/src/operations/accounts.ts`, account scope, `no-store`) and lists it in docs/protocol.md's route inventory.
- `verificationUri` is `<origin>/device`; the CLI prints the user code to type there.
