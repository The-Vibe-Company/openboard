# Boundaries fixtures: a login provider is reachable only through its registry

Inputs for the provider rule of `scripts/ci/boundaries.ts` (docs/codebase.md 3.2, the provider directory row and the GitHub paragraph), used by `provider.test.ts`. A provider's code under `packages/server/src/auth/providers/<name>/` is imported only by `packages/server/src/auth/providers/index.ts`; a file inside the same provider may import its siblings.

- `refused/`: copied into the repository root, `bun run lint` exits 1 naming both files: `packages/server/src/auth/chain.ts` importing `./providers/github/start`, a type-only import from `providers/chain-type.ts`, and a subpath import of the server package from `chain-subpath.ts`.
- `allowed/`: the registry importing a provider, and a provider importing its own files; copied in, the graph check accepts them.

```sh
cp -r scripts/ci/fixtures/boundaries/provider/refused/. . && bun run lint   # exits 1
git clean -fdq packages
cp -r scripts/ci/fixtures/boundaries/provider/allowed/. . && bun run lint   # graph accepted; the manifest rule names the undeclared import
git clean -fdq packages
```
