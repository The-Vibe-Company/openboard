# Migrations fixtures: an applied migration is edited

Inputs for the applied-migration rule of `scripts/ci/migrations.ts` (docs/codebase.md 3.3 point 4), used by `scripts/ci/migrations.test.ts`. Each side mirrors `packages/driver-sql/migrations/`.

- `main/`: the migrations `main` has applied, `0001` and `0002`.
- `branch/`: the same directory on a branch: `0001-create-boards.sql` differs from `main` by one byte (`name` became `nome`), `0002` is unchanged and `0003` is new. The check names `0001-create-boards.sql` and nothing else.

To see the check refuse it in a throwaway clone, commit `main/` as `origin/main`, then copy `branch/` over it. `bun scripts/ci/migrations.ts` is the last step of `bun run lint`; after `bun install`, `bun run lint` exits 1 with the same message.

```sh
git clone -q . /tmp/ob-edited && cd /tmp/ob-edited
cp -r scripts/ci/fixtures/migrations/edited/main/. . && git add packages && git commit -qm main
git update-ref refs/remotes/origin/main HEAD
cp -r scripts/ci/fixtures/migrations/edited/branch/. . && bun scripts/ci/migrations.ts   # exits 1
```
