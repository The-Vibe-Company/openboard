---
id: 36
title: Post a first message on a local board
milestone: M1-walking-skeleton
package: server
writes:
  - packages/contract/src/operation.ts
  - packages/contract/src/errors.ts
  - packages/contract/src/index.ts
  - packages/contract/src/operations/index.ts
  - packages/contract/src/operations/messages.ts
  - packages/contract/src/entities/messages.ts
  - packages/core/src/messages/post.ts
  - packages/core/src/ids.ts
  - packages/core/test/messages/post.test.ts
  - packages/ports/src/store.ts
  - packages/ports/src/index.ts
  - packages/ports/testkit/index.ts
  - packages/ports/testkit/store/messages.test-suite.ts
  - packages/driver-sql/src/db.ts
  - packages/driver-sql/src/sql.ts
  - packages/driver-sql/src/index.ts
  - packages/driver-sql/src/views/messages.ts
  - packages/driver-sql/src/statements.ts
  - packages/driver-sql/migrations/0001-init.sql
  - packages/driver-sqlite/src/index.ts
  - packages/driver-sqlite/src/dialect.ts
  - packages/driver-sqlite/src/migrate.ts
  - packages/driver-sqlite/src/ddl.ts
  - packages/driver-sqlite/test/testkit.test.ts
  - packages/server/src/index.ts
  - packages/server/src/app.ts
  - packages/server/src/deps.ts
  - packages/server/src/http/router.ts
  - packages/server/src/http/pipeline.ts
  - packages/server/src/http/scope.ts
  - packages/server/src/http/respond.ts
  - packages/server/src/http/errors.ts
  - packages/server/src/operations/messages.ts
  - packages/server/src/operations/index.ts
  - packages/server/test/messages.test.ts
  - packages/server/test/support/app.ts
  - packages/server/test/support/drivers.ts
  - apps/openboard/src/main.ts
  - apps/openboard/src/config.ts
  - apps/openboard/src/compose.ts
  - apps/openboard/src/serve.ts
  - packages/sdk/src/client.ts
  - packages/sdk/src/index.ts
  - packages/cli/src/main.ts
  - packages/cli/src/config.ts
  - packages/cli/src/output.ts
  - packages/cli/src/commands/derived.ts
  - packages/cli/src/commands/index.ts
  - packages/cli/src/commands/read.ts
  - package.json
  - packages/contract/package.json
  - packages/core/src/index.ts
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/ports/package.json
  - packages/ports/tsconfig.json
  - packages/driver-sql/package.json
  - packages/driver-sql/tsconfig.json
  - packages/driver-sql/src/views/boards.ts
  - packages/driver-sql/src/sql-files.d.ts
  - packages/driver-sqlite/package.json
  - packages/driver-sqlite/tsconfig.json
  - packages/server/package.json
  - packages/server/tsconfig.json
  - packages/sdk/package.json
  - packages/sdk/tsconfig.json
  - packages/cli/package.json
  - packages/cli/tsconfig.json
  - packages/cli/src/index.ts
  - packages/cli/test/cli.test.ts
  - apps/openboard/package.json
  - apps/openboard/tsconfig.json
  - tools/bench/src/drivers.ts
  - tools/bench/test/counters.test.ts
  - tools/bench/package.json
  - tools/bench/tsconfig.json
  - tools/conformance/src/drivers.ts
  - tools/conformance/package.json
  - tools/conformance/tsconfig.json
  - bun.lock
  - scripts/ci/boundaries.json
  - scripts/ci/boundaries.test.ts
  - scripts/ci/fixtures/boundaries/manifest/refused/packages/core/package.json
conformance: []
modes: [local]
depends_on: [32, 33, 34]
status: claimed
claimed_by: claude-opus-5-5
issue: 36
---

## What the user does
As a developer, I start a local board, post a first message to it and read it back.

## Done when
- [ ] `ob serve` prints `BOARD_URL=http://127.0.0.1:8787/api/local/main`; in another terminal, with that `BOARD_URL`, `ob post dev "hello"` prints `1`
- [ ] `ob read dev` prints `#1  hello`

## Out of scope
- The local owner token (37) and refusing a request without a credential (38).
- A data directory that survives a restart (39).
- Discovery (40), the bare `/api` alias (41), replies (45), cursors (47), threads as a list (81), request logs (58).

## Notes
Goes through every step of `docs/codebase.md` 4.3: TypeBox operation (D20) with `scope: "board"`, `core/messages/post.ts`, the `Store` port's board view, the view written once in `driver-sql` (4.3 step 4), `driver-sqlite` on `{ memory: true }`, the pipeline with tenant resolution (4.4), composition in `apps/openboard`. Migration `0001` creates `orgs`, `boards`, `events`, `messages` with `org_id`/`board_id` keys and the implicit organization `local` and board `main` (`docs/data-model.md` "Tenancy", "DDL"); the `message.posted` fold also keeps the channel row. Land upstream's whole error catalog (`03-http.md` "Errors") in `errors.ts` here, so later tickets do not compete for that file.
