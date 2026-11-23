# oxlint fixtures for console output

Each fixture mirrors its destination under the repository root. Run these commands in a disposable checkout containing the lint configuration and fixtures. Check one fixture at a time and restore or remove the destination after each run.

| Command | Expected lint exit |
| --- | --- |
| `cat scripts/ci/fixtures/oxlint/console/refused/packages/server/src/app.ts >> packages/server/src/app.ts && bun run lint` | 1 with a diagnostic in `packages/server/src/app.ts` |
| `mkdir -p apps/openboard/src && cat scripts/ci/fixtures/oxlint/console/refused/apps/openboard/src/main.ts >> apps/openboard/src/main.ts && bun run lint` | 1 with a diagnostic in `apps/openboard/src/main.ts` |
| `cat scripts/ci/fixtures/oxlint/console/allowed/packages/server/src/log.ts >> packages/server/src/log.ts && bun run lint` | 0 |
| `cat scripts/ci/fixtures/oxlint/console/allowed/packages/cli/src/output.ts >> packages/cli/src/output.ts && bun run lint` | 0 |
