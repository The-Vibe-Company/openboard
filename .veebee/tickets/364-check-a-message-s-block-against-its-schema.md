---
id: 364
title: Check a message's block against its schema
milestone: M13-data-files-schedules
package: core
writes:
  - packages/core/src/schemas/blocks.ts
  - packages/core/src/schemas/value.ts
  - packages/core/test/schemas/blocks.test.ts
  - packages/core/test/schemas/value.test.ts
  - packages/core/src/messages/post.ts
  - packages/core/src/messages/edit.ts
  - packages/core/src/index.ts
  - packages/driver-sql/src/views/schemas.ts
  - packages/server/src/operations/messages.ts
  - packages/server/test/schemas/blocks.test.ts
  - tools/conformance/test/schemas-parity.test.ts
conformance: ["schemas/carries a block in a message, checked against the schema its fence names"]
modes: [local, hosted]
depends_on: [272, 362]
status: draft
claimed_by: null
issue: 559
---

## What the user does
As an agent, I post a message whose text holds a ```` ```json#sandbox@1 ```` fence, and the board checks it against `sandbox@1`, refuses it if it does not match, and gives it back as a block readers can use.

## Done when
- [ ] with `sandbox@1` registered, `ob post dev --file report.md` (prose, a `json#sandbox@1` fence holding `{"id":"sbx-1","action":"stopped"}`, more prose) prints the message, and `ob read <id> --json` shows `blocks: [{ schema: "sandbox", version: 1, data: { id: "sbx-1", action: "stopped" } }]` with the text unchanged; a fence whose object misses `action` prints `error: invalid_block: …`, one naming `nothing@1` prints `error: schema_not_found: …`, and neither posts
- [ ] `bun test packages/server/test/schemas/blocks.test.ts` passes on SQLite and Postgres: an edit whose block does not match answers 400 `invalid_block` and leaves the message and its blocks as they were; a fence inside a longer fence, in a quote or under a list item is text with no block; a message with no fence has `blocks: []`; `bun test tools/conformance/test/schemas-parity.test.ts` gives the same answer as upstream's `findBlocks` and `checkValue` on its fixture corpus
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `schemas/carries a block in a message, checked against the schema its fence names`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Blocks in a schedule's text: 373 checks them with this ticket's functions when it is scheduled.
- Showing blocks in the front (366).
- Imports by a sync, whose text is never checked (M14, 386).

## Notes
- Upstream `docs/04-reference/03-http.md` "Schemas" (a block is a fence whose info string is `json#<name>@<version>` holding a JSON object; `POST /messages` and `POST /messages/:id/edit` check each block; nothing is written on a refusal) and `findBlocks`, `checkValue` in `@vercel/board/schemas` (`dist/schemas.mjs`). A format is read as ajv-formats 2.1.1 reads it in full mode; `items` may also be a list of schemas, one per place.
- Core decides: `packages/core/src/schemas/blocks.ts` finds the blocks, `value.ts` checks each against its definition, and `messages/post.ts` and `messages/edit.ts` (whose views now say `blocks: []`) put the found blocks in the view. The server loads the schemas a text names inside the same board write (`packages/driver-sql/src/views/schemas.ts`), so a schema registered a moment before is seen and nothing is read for a text without a fence: `bun run bench --quick` counters must not move.
- The parity test lives in `tools/conformance`, the only workspace allowed to import `@vercel/board` (docs/codebase.md 3.1), and imports core's functions alongside upstream's.
- Upstream's error message names the first problem (`id must be a string`); keep its wording where the corpus shows it.
- Depends on 272, the last ticket before it to change `packages/core/src/messages/edit.ts` and `packages/server/src/operations/messages.ts`.
