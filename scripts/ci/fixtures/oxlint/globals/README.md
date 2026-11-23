# oxlint fixtures: restricted globals

Inputs for the `no-restricted-globals` and `no-restricted-properties` override in `.oxlintrc.json` (docs/codebase.md 3.2, 3.3 point 2). Each fixture mirrors the repository path it stands for; the override matches only the real paths, so `bun run lint` passes over this directory.

- `refused/`: copied into the repository root, every file makes `bun run lint` exit 1, naming the file and the global.
- `allowed/`: the same calls outside `contract`, `core`, `ports` and `server`; copied in, `bun run lint` passes.

```sh
cp -r scripts/ci/fixtures/oxlint/globals/refused/. . && bun run lint   # exits 1
git clean -fdq packages
cp -r scripts/ci/fixtures/oxlint/globals/allowed/. . && bun run lint   # exits 0
git clean -fdq packages apps
```
