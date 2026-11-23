# Boundaries fixtures: driver-sql is imported only by the two drivers

Inputs for the `driver-sql` rule of `scripts/ci/boundaries.ts` (docs/codebase.md 3.1 universal rules, 3.3 point 1), used by `driver-sql.test.ts`. A file importing `@openboard/driver-sql` must sit in `packages/driver-sqlite`, `packages/driver-postgres` or `driver-sql`'s own workspace. The rule holds even where the graph lets the workspace import a driver, so `apps/openboard/src/serve.ts` is refused while `packages/driver-postgres/src/dialect.ts` is accepted.

- `refused/`: copied into the repository root, `bun run lint` exits 1 naming the file and the module: `packages/server/src/http/store.ts` (a type-only import) and `apps/openboard/src/serve.ts` (a value import from the composition root's workspace). The manifest rule also names `@openboard/driver-sql`, which neither `package.json` declares.
- `allowed/`: a file in each driver and in `driver-sql`'s own workspace, importing `@openboard/driver-sql`; copied in, the `driver-sql` rule accepts them: `bun run lint` reports no `driver-sql` import, only the manifest rule naming the undeclared `@openboard/driver-sql`.

```sh
cp -r scripts/ci/fixtures/boundaries/driver-sql/refused/. . && bun run lint   # exits 1: two driver-sql violations, two manifest messages
git checkout -- packages apps && git clean -fdq packages apps
cp -r scripts/ci/fixtures/boundaries/driver-sql/allowed/. . && bun run lint   # no driver-sql violation; manifest rule names the undeclared @openboard/driver-sql
git checkout -- packages apps && git clean -fdq packages apps
```
