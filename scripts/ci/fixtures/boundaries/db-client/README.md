# Boundaries fixtures: a database client only inside its own driver

Inputs for the database-client rule of `scripts/ci/boundaries.ts` (docs/codebase.md 3.2 second row, 3.3 point 1), used by `db-client.test.ts`. `bun:sqlite` is opened only in `packages/driver-sqlite` and Bun's `SQL` (also `sql` and `postgres`, from `bun` or the `Bun` global) only in `packages/driver-postgres`; `driver-sql` opens neither. The rule holds where the graph allows the module, so `packages/server` may import `serve` from `bun` but not `SQL`. Outside `driver-postgres`, a run-time `import("bun")` or `require("bun")` and an `export *` from `bun` are refused too, since what they reach cannot be read. The list lives under `dbClients` in `scripts/ci/boundaries.json`.

- `refused/`: copied into the repository root, `bun run lint` exits 1 naming each file and the module: `packages/server/src/http/db.ts` (`SQL` from `bun`), `apps/openboard/src/sqlite.ts` (`bun:sqlite`), `packages/driver-sql/src/postgres.ts` and `sqlite.ts` (type-only imports of either client; the graph also refuses `bun` in `driver-sql`), and `packages/driver-sqlite/src/postgres.ts` (`Bun.SQL` through the global).
- `allowed/`: `bun:sqlite` in `driver-sqlite`, `SQL` from `bun` in `driver-postgres`, and `serve` and `Bun.version` in `server`; copied in, `bun run lint` exits 0.

```sh
cp -r scripts/ci/fixtures/boundaries/db-client/refused/. . && bun run lint   # exits 1: five database-client violations, one graph violation
git checkout -- packages apps && git clean -fdq packages apps
cp -r scripts/ci/fixtures/boundaries/db-client/allowed/. . && bun run lint   # exits 0: no violation
git checkout -- packages apps && git clean -fdq packages apps
```
