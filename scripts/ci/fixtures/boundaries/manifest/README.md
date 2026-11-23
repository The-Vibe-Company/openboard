# Boundaries fixtures: manifests agree with imports

Inputs for the manifest rule of `scripts/ci/boundaries.ts` (docs/codebase.md 3.3 point 1), used by `scripts/ci/boundaries.test.ts`. Each fixture mirrors the repository path it stands for; a `package.json` replaces the workspace's own manifest.

- `refused/`: copied into the repository root, `bun run lint` exits 1 naming each package: `core` imports `@openboard/contract` without declaring it, `contract` declares `zod` outside its allow-list, and `sdk` declares `@openboard/contract` but no file imports it.
- `allowed/`: a declared workspace import, a type import in test support declared as a dev dependency, and `@types/bun`, which the compiler uses without an import; copied in, `bun run lint` passes.

```sh
cp -r scripts/ci/fixtures/boundaries/manifest/refused/. . && bun run lint   # exits 1
git checkout -- packages && git clean -fdq packages
cp -r scripts/ci/fixtures/boundaries/manifest/allowed/. . && bun run lint   # exits 0
git checkout -- packages && git clean -fdq packages
```
