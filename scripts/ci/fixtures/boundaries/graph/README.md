# Boundaries fixtures: the allow-list graph

Inputs for `scripts/ci/boundaries.ts` (docs/codebase.md 3.1, 3.3 point 1), used by `scripts/ci/boundaries.test.ts`. Each fixture mirrors the repository path it stands for; the checker scans only workspaces, so `bun run lint` passes over this directory.

- `refused/`: copied into the repository root, every file makes `bun run lint` exit 1, naming the edge (`core -> server`) or the package (`zod`). Type-only imports count.
- `allowed/`: imports the graph permits, including types-only `ports -> core`, the `ports` test kit, test files and a package subpath; copied in, `bun run lint` passes.

```sh
cp -r scripts/ci/fixtures/boundaries/graph/refused/. . && bun run lint   # exits 1
git clean -fdq packages
cp -r scripts/ci/fixtures/boundaries/graph/allowed/. . && bun run lint   # exits 0
git clean -fdq packages tools
```
