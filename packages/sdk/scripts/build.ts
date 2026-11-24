const sdk = new URL("../", import.meta.url);
const dist = new URL("dist/", sdk);
const root = new URL("../../", sdk);

const result = await Bun.build({
  entrypoints: [Bun.fileURLToPath(new URL("src/index.ts", sdk))],
  outdir: Bun.fileURLToPath(dist),
  target: "browser",
  format: "esm",
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, "SDK bundle failed");

const declarations = Bun.spawnSync(
  [
    "bun",
    Bun.fileURLToPath(new URL("node_modules/.bin/dts-bundle-generator", root)),
    "--project",
    "scripts/tsconfig.json",
    "--out-file",
    "dist/index.d.ts",
    "--external-inlines",
    "@sinclair/typebox",
    "--",
    "src/index.ts",
  ],
  { cwd: Bun.fileURLToPath(sdk), stdout: "inherit", stderr: "inherit" },
);
if (!declarations.success) throw new Error("SDK declaration bundle failed");

const contract = Bun.resolveSync("@openboard/contract", Bun.fileURLToPath(sdk));
const typebox = Bun.resolveSync("@sinclair/typebox", contract);
await Bun.write(new URL("NOTICE", dist), Bun.file(new URL("NOTICE", root)));
await Bun.write(new URL("TYPEBOX-LICENSE", dist), Bun.file(new URL("../../license", Bun.pathToFileURL(typebox))));
