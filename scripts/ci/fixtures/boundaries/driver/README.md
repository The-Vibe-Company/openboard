# Boundaries fixtures: a driver is imported only by a composition root

Inputs for the driver rule of `scripts/ci/boundaries.ts` (docs/codebase.md 3.1 universal rules, 3.3 point 1), used by `driver.test.ts`. A file importing `@openboard/driver-sqlite` or `@openboard/driver-postgres` must be one of the composition roots listed under `drivers` in `scripts/ci/boundaries.json`, or sit in the driver's own workspace (its tests). The rule holds even where the graph lets the workspace import a driver, so `apps/openboard/src/serve.ts` is refused while `apps/openboard/src/compose.ts` is accepted.

- `refused/`: copied into the repository root, `bun run lint` exits 1 naming the file and the driver: `packages/server/src/app.ts`, a type-only import from `packages/server/src/http/store-type.ts`, `apps/openboard/src/serve.ts`, a subpath import of the Postgres driver from `apps/openboard/src/postgres-subpath.ts`, and `packages/server/test/support/app.ts`. The manifest rule also names `@openboard/driver-postgres`, which `apps/openboard/package.json` does not declare.
- `allowed/`: each composition root, and a driver's own test support, importing `@openboard/driver-sqlite`; copied in, the driver rule accepts them: `bun run lint` reports no driver import, only the manifest rule naming `@openboard/server`, which the stubs replace the real roots' imports of.

```sh
cp -r scripts/ci/fixtures/boundaries/driver/refused/. . && bun run lint   # exits 1: five driver violations, one manifest message
git checkout -- packages apps && git clean -fdq packages apps
cp -r scripts/ci/fixtures/boundaries/driver/allowed/. . && bun run lint   # no driver violation; manifest rule names the unused @openboard/server
git checkout -- packages apps tools && git clean -fdq packages apps tools
```
