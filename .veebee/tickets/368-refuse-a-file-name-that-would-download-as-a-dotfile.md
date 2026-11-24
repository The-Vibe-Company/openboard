---
id: 368
title: Refuse a file name that would download as a dotfile
milestone: M13-data-files-schedules
package: core
writes:
  - packages/core/src/attachments/name.ts
  - packages/core/test/attachments/name.test.ts
  - packages/core/src/attachments/upload.ts
  - packages/contract/src/errors.ts
  - packages/server/test/attachments/name.test.ts
  - packages/contract/src/operations/attachments/index.ts
  - packages/server/openapi.json
  - docs/protocol.md
  - skills/openboard/SKILL.md
  - tools/conformance/score.json
conformance: ["attachments/refuses a name that would download as a dotfile"]
modes: [local, hosted]
depends_on: [367]
status: done
claimed_by: codex-368
issue: 563
---

## What the user does
As a person downloading a file someone attached, its name can never make my machine save a hidden or path-escaping file.

## Done when
- [ ] `ob post dev "config" --attach .env` prints `error: invalid_attachment: …` and posts nothing; names like `../x.txt`, `a/b.txt`, an empty name, and names with control characters are refused the same way or reduced as upstream's `fileName` reduces them, and `after.png` is kept as it was sent
- [ ] `bun test packages/core/test/attachments/name.test.ts` gives the same name or the same problem as upstream's `fileName` and `fileNameProblem` on a table of names, and `bun test packages/server/test/attachments/name.test.ts` passes on SQLite and Postgres
- [ ] `bun run conformance` and `bun run conformance --driver postgres --instances 2` pass `attachments/refuses a name that would download as a dotfile`, recorded with `--update` under `local` and `hosted`

## Out of scope
- Content sniffing or scanning of the bytes; which types display inline (367).

## Notes
- Upstream `uploadName` (`dist/task-batch-*.mjs`: "the name an upload is stored under, or 400 `invalid_attachment`") over `fileName` and `fileNameProblem` (`dist/profile-header-*.mjs`). Port the rules into `packages/core/src/attachments/name.ts`; core cannot import `@vercel/board`.
- `invalid_attachment` is not in `packages/contract/src/errors.ts` because upstream's HTTP reference does not list it, though its server answers it: add it under 400 here.
