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
  - .dockerignore
  - .gitignore
  - Dockerfile
  - README.md
  - docker-compose.yml
  - apps/openboard/src/local-secret-key.ts
  - docs/protocol.md
  - skills/openboard/references/webhooks.md
  - packages/contract/src/entities/webhooks/index.ts
  - packages/driver-postgres/src/catalog.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/purge-test-data.ts
  - packages/driver-sqlite/src/catalog.ts
  - packages/server/openapi.json
  - packages/server/test/webhooks/deliver.test.ts
conformance: []
modes: [local, hosted]
depends_on: [305, 322]
status: done
claimed_by: codex
issue: 508
---

## What the user does
As an operator, a stolen database or backup yields no usable webhook secret or receiver header; a hosted instance without its key refuses to start, and a local board needs no setup.

## Done when
- [x] `bun test packages/server/test/webhooks/secret-box.test.ts` passes: after creating a webhook with a generated secret and a `none` webhook with an `authorization` header, no column of any table holds any of those values or their base64; with a different key, the webhook's deliveries stop with `disabledReason: "secret_unreadable"` and are never sent unsigned or without their headers
- [x] `OPENBOARD_DATABASE_URL=postgres://… bun apps/openboard/src/main.ts serve` with no `OPENBOARD_SECRET_KEY` exits 2 naming it; `bun apps/openboard/src/main.ts serve` with none creates `~/.config/openboard/secret-key` (directory mode 0700, file mode 0600, 32 random bytes) once and reuses it without printing or logging it. Startup refuses a data directory that contains the key directory.
- [x] The Docker image generates no key and webhook or inbound credential creation returns `not_supported` with the existing hint until a separate key source is provided. The example mounts it at `/run/secrets/openboard_key`.

## Out of scope
- Rotating `OPENBOARD_SECRET_KEY` (not in the cut; docs/decisions.md D29: losing the key means re-entering the secrets).

## Notes
- D29 and docs/auth.md "Threat model" (stolen database or backup: AES-256-GCM under `OPENBOARD_SECRET_KEY`, held only in the service environment). 304 already encrypts with a configured key; 316 and 326 use the same box. This ticket makes the key always present and fails closed when it cannot decrypt.
- **Decision on #508:** Plain local startup generates the key outside the data directory. Docker requires a separate key source for secret storage, and hosted mode requires the key at startup.
- Depends on 305, the last ticket before it to change `apps/openboard/src/config.ts`, and 322, the last to change `jobs/webhooks.ts`.
