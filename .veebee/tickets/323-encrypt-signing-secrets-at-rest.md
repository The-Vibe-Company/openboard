---
id: 323
title: Encrypt signing secrets at rest
milestone: M11-webhooks-and-watchers
package: server
writes:
  - packages/server/src/webhooks/secret-box.ts
  - packages/server/test/webhooks/secret-box.test.ts
  - packages/server/src/jobs/webhooks.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/serve.ts
  - apps/openboard/test/config.test.ts
  - docs/auth.md
  - docs/decisions.md
  - docs/codebase.md
conformance: []
modes: [local, hosted]
depends_on: [305, 322]
status: draft
claimed_by: null
issue: null
---

## What the user does
As an operator, a stolen database or backup yields no usable webhook secret or receiver header; a hosted instance without its key refuses to start, and a local board needs no setup.

## Done when
- [ ] `bun test packages/server/test/webhooks/secret-box.test.ts` passes: after creating a webhook with a generated secret and a `none` webhook with an `authorization` header, no column of any table holds any of those values or their base64; with a different key, the webhook's deliveries stop with `disabledReason: "secret_unreadable"` and are never sent unsigned or without their headers
- [ ] `OPENBOARD_DATABASE_URL=postgres://… bun apps/openboard/src/main.ts serve` with no `OPENBOARD_SECRET_KEY` exits 2 naming it; `bun apps/openboard/src/main.ts serve` with none creates `~/.config/openboard/local/<port>.key` (mode 0600, 32 random bytes) once and reuses it, and the key is never printed or logged

## Out of scope
- Rotating `OPENBOARD_SECRET_KEY` (not in the cut; docs/decisions.md D29: losing the key means re-entering the secrets).

## Notes
- D29 and docs/auth.md "Threat model" (stolen database or backup: AES-256-GCM under `OPENBOARD_SECRET_KEY`, held only in the service environment). 304 already encrypts with a configured key; 316 and 326 use the same box. This ticket makes the key always present and fails closed when it cannot decrypt.
- **Proposal for the owner (record in docs/decisions.md, docs/auth.md and docs/codebase.md 5.5):** in local mode with no `OPENBOARD_SECRET_KEY`, `ob serve` generates one beside the owner token file (`~/.config/openboard/local/<port>.key`, 0600), outside the data directory so a copied volume or snapshot (212) holds no key. Hosted mode requires the variable. Until the owner agrees, stop with `needs-decision`.
- Depends on 305, the last ticket before it to change `apps/openboard/src/config.ts`, and 322, the last to change `jobs/webhooks.ts`.
