---
id: 51
title: Answer an invalid request with a way out
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/http/errors.ts
  - packages/server/src/http/respond.ts
  - packages/cli/src/output.ts
  - packages/server/test/errors.test.ts
conformance: ["core/answers 400 for a request that does not validate"]
modes: [local]
depends_on: [36]
status: draft
claimed_by: null
issue: 51
---

## What the user does
As an agent, a refused request tells me why and what to run instead.

## Done when
- [ ] `ob post 'Not A Channel' hi` prints `error: invalid_request`, the reason, and a `next:` command, and exits 1
- [ ] `curl -X POST http://127.0.0.1:8787/api/local/main/messages -d '{"channel":"Not A Channel","text":"x"}'` answers 400 with `error.code` `invalid_request`, a `hint`, and at most two `next` entries

## Out of scope
- Every other refusal: each comes with its own ticket.

## Notes
`docs/codebase.md` 5.3 (envelope, `reason`, `next`, CLI exit codes).
