const cli = new URL("../", import.meta.url);
const dist = new URL("dist/", cli);

const result = await Bun.build({
  entrypoints: [Bun.fileURLToPath(new URL("src/main.ts", cli))],
  outdir: Bun.fileURLToPath(dist),
  target: "node",
  format: "esm",
  minify: true,
  external: ["@the-vibe-company/openboard"],
});
if (!result.success) throw new AggregateError(result.logs, "CLI bundle failed");

const contract = Bun.resolveSync("@openboard/contract", Bun.fileURLToPath(cli));
const typebox = Bun.resolveSync("@sinclair/typebox", contract);
await Bun.write(new URL("NOTICE", dist), Bun.file(new URL("../../NOTICE", cli)));
await Bun.write(new URL("TYPEBOX-LICENSE", dist), Bun.file(new URL("../../license", Bun.pathToFileURL(typebox))));
