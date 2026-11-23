# Boundaries fixtures: relative imports stay in their workspace

Inputs for the relative-path rule of `scripts/ci/boundaries.ts` (docs/codebase.md 3.1 universal rules), used by `relative.test.ts`. A workspace reaches another only by its package name; a relative or absolute path that resolves into another workspace, or outside every workspace, is refused.

- `refused/`: copied into the repository root, `bun run lint` exits 1 naming the path: `packages/core/src` importing `../../contract/src/errors` (a value import and a type-only one).
- `allowed/`: a relative import to a sibling file in the same workspace, next to a package-name import across workspaces; copied in, the graph check accepts them.

```sh
cp -r scripts/ci/fixtures/boundaries/relative/refused/. . && bun run lint   # exits 1
git clean -fdq packages
cp -r scripts/ci/fixtures/boundaries/relative/allowed/. . && bun run lint   # graph accepted; the manifest rule names the undeclared import
git clean -fdq packages
```
