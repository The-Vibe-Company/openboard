import { beforeAll, expect, test } from "bun:test";

const sdk = new URL("../", import.meta.url);

beforeAll(async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { cwd: Bun.fileURLToPath(sdk), stderr: "pipe" });
  const stderr = await new Response(build.stderr).text();
  if ((await build.exited) !== 0) throw new Error(stderr);
}, 30_000);

test("the SDK builds a self-contained ESM entry and declarations", async () => {
  for (const path of ["dist/index.js", "dist/index.d.ts"]) {
    const source = await Bun.file(new URL(path, sdk)).text();
    expect(source.length).toBeGreaterThan(0);
    expect(source).not.toContain("@openboard/");
    expect(source).not.toContain("@sinclair/typebox");
  }
  const node = Bun.spawnSync(
    [
      "node",
      "--input-type=module",
      "-e",
      "import('./dist/index.js').then(m => console.log(typeof m.openboard, typeof m.createClient))",
    ],
    { cwd: Bun.fileURLToPath(sdk) },
  );
  expect(node.stderr.toString()).toBe("");
  expect(node.stdout.toString().trim()).toBe("function function");
  expect(node.exitCode).toBe(0);
});

test("npm packs only the SDK distribution, README, license and manifest", () => {
  const pack = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], { cwd: Bun.fileURLToPath(sdk) });
  if (!pack.success) throw new Error(pack.stderr.toString());
  const [archive] = JSON.parse(pack.stdout.toString());
  expect(archive.files.map(({ path }: { path: string }) => path).sort()).toEqual([
    "LICENSE",
    "README.md",
    "dist/NOTICE",
    "dist/TYPEBOX-LICENSE",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
  ]);
});

test("the release tarball resolves its typed API from outside the workspace", async () => {
  const root = new URL("../../", sdk);
  const { version } = await Bun.file(new URL("package.json", sdk)).json();
  const scratch = (await Bun.$`mktemp -d`.text()).trim();
  try {
    const packer = Bun.fileURLToPath(new URL("scripts/release/npm.ts", root));
    await Bun.$`bun ${packer} v${version} ${scratch}`.quiet();
    const tarball = `./the-vibe-company-openboard-${version}.tgz`;
    await Bun.$`npm install --offline --ignore-scripts --no-audit --no-fund ${tarball}`.cwd(scratch).quiet();

    const consumer = `import { createClient, openboard } from "@the-vibe-company/openboard";
const client = createClient({ url: "https://example.test/api/local/main" });
if (false) {
  // @ts-expect-error The typed operation requires message text.
  void client.postMessage({ channel: "dev" });
}
console.log(typeof openboard, typeof client.postMessage);`;
    await Bun.write(`${scratch}/consumer.mts`, consumer);

    const tsc = Bun.fileURLToPath(new URL("node_modules/.bin/tsc", root));
    await Bun.$`${tsc} --ignoreConfig --strict --noEmit --module nodenext --target es2022 consumer.mts`
      .cwd(scratch)
      .quiet();
    expect((await Bun.$`node --input-type=module -e ${consumer}`.cwd(scratch).text()).trim()).toBe("function function");
  } finally {
    await Bun.$`rm -r ${scratch}`.quiet();
  }
});
