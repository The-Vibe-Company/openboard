import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cli = new URL("../", import.meta.url);
const cwd = Bun.fileURLToPath(cli);
const nodePath = Bun.which("node");
if (!nodePath) throw new Error("Node is required to test the npm CLI");

const installed = await mkdtemp(join(tmpdir(), "openboard-cli-test-"));

beforeAll(async () => {
  const built = Bun.spawnSync(["bun", "scripts/build.ts"], { cwd });
  if (!built.success) throw new Error(built.stderr.toString());

  const sdk = join(installed, "node_modules/@the-vibe-company/openboard");
  const bundle = await Bun.build({
    entrypoints: [Bun.resolveSync("@the-vibe-company/openboard", cwd)],
    outdir: sdk,
    target: "browser",
  });
  if (!bundle.success) throw new AggregateError(bundle.logs, "SDK bundle failed");
  await Bun.write(join(sdk, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
  await Bun.write(join(installed, "package.json"), JSON.stringify({ type: "module" }));
  for (const file of ["bin/ob.js", "dist/main.js"]) {
    await mkdir(dirname(join(installed, file)), { recursive: true });
    await copyFile(new URL(file, cli), join(installed, file));
  }
}, 30_000);

afterAll(() => rm(installed, { recursive: true, force: true }));

test("the Node client loads the separate SDK and handles CLI validation errors", () => {
  const node = Bun.spawnSync([nodePath, "bin/ob.js", "schemas", "create", "bad-id"], {
    cwd: installed,
    env: { HOME: installed, BOARD_URL: "https://board.example/api/local/main" },
  });
  expect(node.exitCode).toBe(1);
  expect(node.stdout.toString()).toBe("");
  expect(node.stderr.toString()).toBe(
    "error: invalid_schema_id: A schema ID must be name@version, like git-commit@1.\n",
  );
}, 30_000);

test("the npm bin rejects serve and points to the executable or image", () => {
  const node = Bun.spawnSync([nodePath, "bin/ob.js", "serve"], { cwd: installed });
  expect(node.exitCode).toBe(2);
  expect(node.stdout.toString()).toBe("");
  expect(node.stderr.toString()).toBe(
    "error: invalid_request: ob serve needs the openboard binary\n" +
      "next: install the openboard executable or run the OpenBoard container image\n",
  );
}, 30_000);

test("npm packs only the CLI launcher, bundle, licenses and manifest", async () => {
  const { bin } = await Bun.file(new URL("package.json", cli)).json();
  expect(bin).toEqual({ ob: "./bin/ob.js" });

  const pack = Bun.spawnSync(["npm", "pack", "--dry-run", "--json"], { cwd });
  if (!pack.success) throw new Error(pack.stderr.toString());
  const [archive] = JSON.parse(pack.stdout.toString());
  expect(archive.files.map(({ path }: { path: string }) => path).sort()).toEqual([
    "bin/ob.js",
    "dist/NOTICE",
    "dist/TYPEBOX-LICENSE",
    "dist/main.js",
    "package.json",
  ]);
}, 30_000);

test("the npm CLI can print help and reject invalid arguments without loading the SDK", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openboard-cli-help-"));
  try {
    await Bun.write(join(dir, "package.json"), '{"type":"module"}');
    await Bun.write(join(dir, "main.js"), Bun.file(new URL("dist/main.js", cli)));
    for (const [args, code, expected] of [
      [["--help"], 0, "Messages & channels"],
      [["-V"], 0, "ob "],
      [["post", "--help"], 0, "ob post <channel>"],
      [["tail", "--help"], 0, "ob tail <channel>"],
      [["unknown"], 2, "unknown command: unknown"],
      [["tail", "dev", "--unknown"], 2, "unknown option --unknown"],
      [["post", "dev"], 2, "expected a channel"],
    ] as const) {
      const script =
        "import {runCli} from './main.js'; process.exitCode = await runCli(process.argv.slice(1), {BOARD_URL: 'https://board.example'});";
      const node = Bun.spawnSync([nodePath, "--input-type=module", "-e", script, "--", ...args], { cwd: dir });
      expect(node.exitCode).toBe(code);
      expect((code === 0 ? node.stdout : node.stderr).toString()).toContain(expected);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
