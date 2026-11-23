# oxlint fixtures: environment reads

Inputs for the `.oxlintrc.json` overrides that restrict environment reads to the two config modules (docs/codebase.md 3.2, 5.5). The `no-restricted-properties` entries refuse `process.env`, `Bun.env`, `globalThis.process` and `globalThis.Bun`; the `no-restricted-imports` entries refuse the `env` binding of `node:process`, `process` and `bun`, and the default import of `bun` (whose default export is the `Bun` global). The overrides apply to `packages/**` and `apps/**` only: CI scripts and tools read their own environment. Each fixture mirrors the repository path it stands for, so `bun run lint` passes over this directory.

Run these commands in a disposable checkout containing the lint configuration and fixtures. Check one fixture at a time and restore or remove the destination after each run.

| Command | Expected lint exit |
| --- | --- |
| `cat scripts/ci/fixtures/oxlint/env/refused/packages/server/src/app.ts >> packages/server/src/app.ts && bun run lint` | 1 with diagnostics in `packages/server/src/app.ts` |
| `cat scripts/ci/fixtures/oxlint/env/refused/packages/sdk/src/env.ts >> packages/sdk/src/env.ts && bun run lint` | 1 with diagnostics in `packages/sdk/src/env.ts` |
| `mkdir -p apps/openboard/src && cat scripts/ci/fixtures/oxlint/env/allowed/apps/openboard/src/config.ts >> apps/openboard/src/config.ts && bun run lint` | 0 |
| `mkdir -p packages/cli/src && cat scripts/ci/fixtures/oxlint/env/allowed/packages/cli/src/config.ts >> packages/cli/src/config.ts && bun run lint` | 0 |
