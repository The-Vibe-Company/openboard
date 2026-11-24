---
id: 241
title: Make a task once for a client ID
milestone: M9-tasks
package: server
writes:
  - packages/contract/src/operations/tasks.ts
  - packages/core/src/tasks/create.ts
  - packages/core/test/tasks/create.test.ts
  - packages/server/src/operations/tasks.ts
  - packages/server/test/tasks/client-id.test.ts
  - packages/cli/test/tasks.test.ts
conformance: ["tasks/makes a task once for a client ID, and none under an ID a reply or a plain thread landed with"]
modes: [local, hosted]
depends_on: [240]
status: draft
claimed_by: null
issue: 414
---

## What the user does
As an agent that retries, I create a task with `--idempotency-key` and get the same task however many times the request is sent.

## Done when
- [ ] `ob tasks create dev "deploy" --idempotency-key deploy-42` run twice prints the same ID both times, and `ob tasks dev --state all` lists one task
- [ ] after `ob reply 2 "x" --idempotency-key r-1` and `ob post dev "plain" --idempotency-key p-1`, `ob tasks create dev "y" --idempotency-key r-1` and `ob tasks create dev "y" --idempotency-key p-1` each print `error: duplicate_id: …`, exit 1, make nothing, and the plain thread is still no task
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` both pass `tasks/makes a task once for a client ID, and none under an ID a reply or a plain thread landed with`, and `--update` records it in `tools/conformance/score.json` under `local` and `hosted`

## Out of scope
- A batch's `id` (260).

## Notes
Upstream `POST /tasks` takes `id` "as a post does"; ticket 68's client-ID rule (`clientPost` under the lock, the `messages_client` index). A client ID that landed a task answers that task; one that landed a reply, or a thread that is no task, is 409 `duplicate_id`.
