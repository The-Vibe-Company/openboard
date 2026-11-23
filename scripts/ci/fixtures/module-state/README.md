# Fixtures: module-level mutable state

Inputs for `scripts/ci/module-state.ts` (docs/codebase.md 3.2, 3.3 point 6, 5.6), checked by `scripts/ci/module-state.test.ts`. Each fixture mirrors the repository path it stands for; the check walks only the real `packages/*/src` and `apps/openboard/src`, so `bun run lint` passes over this directory.

- `refused/`: a module-level `let` and `var`; module-level `new Map()`, `new Set()`, arrays and objects later changed in place (by a method, assignment, `++`, `delete` or `Object.assign`), in their own file or a file importing them; and `static` mutable class fields. Copied into the repository root, `bun run lint` exits 1 naming each file and line.
- `allowed/`: constants never changed, `static readonly` values, parameters and locals that shadow a module name, instance fields reached through `this`, methods of a plain object, and a `let` outside `src`.

```sh
cp -r scripts/ci/fixtures/module-state/refused/. . && bun run lint   # exits 1
rm packages/core/src/let.ts packages/core/src/map.ts packages/server/src/registry.ts packages/server/src/use.ts packages/server/src/forms.ts apps/openboard/src/static.ts
```
