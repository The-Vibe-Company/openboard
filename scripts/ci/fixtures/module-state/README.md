# Fixtures: module-level mutable state

Inputs for `scripts/ci/module-state.ts` (docs/codebase.md 3.2, 3.3 point 6, 5.6), checked by `scripts/ci/module-state.test.ts`. Each fixture mirrors the repository path it stands for; the check walks only the real `packages/*/src` and `apps/openboard/src`, so `bun run lint` passes over this directory.

- `refused/`: a module-level `let` and `var`, module-level `new Map()`, `new Set()`, array and object later mutated, and `static` mutable class fields. Copied into the repository root, `bun run lint` exits 1 naming each file and line.
- `allowed/`: constants never mutated, `static readonly` values, state created per call or per instance, and a `let` outside `src`.

```sh
cp -r scripts/ci/fixtures/module-state/refused/. . && bun run lint   # exits 1
git clean -fdq packages apps
```
