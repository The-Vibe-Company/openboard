# oxlint fixtures: environment reads

Inputs for the `.oxlintrc.json` overrides that restrict environment reads to the two config modules (docs/codebase.md 3.2, 5.5). The `no-restricted-properties` entries refuse `process.env`, `Bun.env`, `globalThis.process` and `globalThis.Bun`; the `no-restricted-imports` entries refuse the `env` binding of `node:process`, `process` and `bun`, and the default import of `bun` (whose default export is the `Bun` global). The overrides apply to `packages/**` and `apps/**` only: CI scripts and tools read their own environment. Each fixture mirrors the repository path it stands for, so `bun run lint` passes over this directory.

Run these commands in a disposable checkout containing the lint configuration and fixtures. Check one fixture at a time and restore or remove the destination after each run.

| Command | Expected lint exit |
| --- | --- |
| `cat scripts/ci/fixtures/oxlint/env/refused/packages/server/src/app.ts >> packages/server/src/app.ts && bun run lint` | 1 with 7 diagnostics in `packages/server/src/app.ts` |
| `cp scripts/ci/fixtures/oxlint/env/refused/packages/sdk/src/env.ts packages/sdk/src/env.ts && bun run lint` | 1 with 4 diagnostics in `packages/sdk/src/env.ts` |
| `mkdir -p apps/openboard/src && cp scripts/ci/fixtures/oxlint/env/refused/apps/openboard/src/env.ts apps/openboard/src/env.ts && bun run lint` | 1 with 8 diagnostics in `apps/openboard/src/env.ts` |
| `mkdir -p apps/openboard/src && cp scripts/ci/fixtures/oxlint/env/allowed/apps/openboard/src/config.ts apps/openboard/src/config.ts && bun run lint` | 0 |
| `cp scripts/ci/fixtures/oxlint/env/allowed/packages/cli/src/config.ts packages/cli/src/config.ts && bun run lint` | 0 |

The refused `packages/sdk` fixture carries only the four property forms: `packages/sdk` may not import `bun` (docs/codebase.md 3.1), so the import forms would fail the boundary check rather than the env rule. The allowed `packages/cli` fixture likewise imports only `node:process`, chosen as the representative environment-bearing builtin among the `node:*` modules `packages/cli` may reach. The refused `apps/openboard` fixture also carries the bare `process` specifier, which no workspace may import; `bun run lint` runs oxlint before the boundary check, so the env rule reports it first. Its `biome-ignore` comment keeps the fixture itself lint-clean.
