---
id: 50
title: Answer 404 for a message that does not exist
milestone: M1-walking-skeleton
package: server
writes:
  - packages/server/src/operations/threads.ts
  - packages/server/test/threads.test.ts
conformance: ["core/answers 404 for an ID that names nothing"]
modes: [local]
depends_on: [44]
status: done
claimed_by: claude-opus-5-5
issue: 50
---

## What the user does
As a person or agent, I am told a message does not exist.

## Done when
- [x] `ob read 9999` prints `error: message_not_found: Couldn't find message #9999.` and exits 1 (one CLI error format, `error: <code>: <message>`, decided on #50)
- [x] `curl -i http://127.0.0.1:8787/api/local/main/messages/no-such-message` answers 404 `message_not_found`: an ID that is not a number names nothing, it is not a 400

## Out of scope
- Unknown paths (42).
- Another organization's message (M4, 155).

## Notes
`03-http.md` "Errors"; `docs/codebase.md` 5.3.
