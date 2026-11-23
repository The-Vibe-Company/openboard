# oxlint fixtures: function length

Inputs for the `max-lines-per-function` override in `.oxlintrc.json` (docs/codebase.md 5.1, 3.3 point 2). Each fixture mirrors the repository path it stands for; the override matches only the real workspace paths, so `bun run lint` passes over this directory.

- `refused/`: copied into the repository root, every file makes `bun run lint` exit 1, naming the file and the function.
- `allowed/`: a function of exactly 80 lines; copied in, `bun run lint` passes.

Run these commands in a disposable checkout containing the lint configuration and fixtures. Check one fixture at a time and remove the copy after each run.

| Command | Expected lint exit |
| --- | --- |
| `cp scripts/ci/fixtures/oxlint/fnlen/refused/packages/core/src/over-limit.ts packages/core/src/over-limit.ts && bun run lint` | 1 with a diagnostic in `packages/core/src/over-limit.ts` |
| `cp scripts/ci/fixtures/oxlint/fnlen/refused/apps/openboard/src/over-limit.ts apps/openboard/src/over-limit.ts && bun run lint` | 1 with a diagnostic in `apps/openboard/src/over-limit.ts` |
| `cp scripts/ci/fixtures/oxlint/fnlen/refused/tools/bench/src/over-limit.ts tools/bench/src/over-limit.ts && bun run lint` | 1 with a diagnostic in `tools/bench/src/over-limit.ts` |
| `cp scripts/ci/fixtures/oxlint/fnlen/allowed/packages/core/src/at-limit.ts packages/core/src/at-limit.ts && bun run lint` | 0 |

```sh
cp -r scripts/ci/fixtures/oxlint/fnlen/refused/. . && bun run lint   # exits 1
git clean -fdq packages apps tools
cp -r scripts/ci/fixtures/oxlint/fnlen/allowed/. . && bun run lint   # exits 0
git clean -fdq packages apps tools
```
