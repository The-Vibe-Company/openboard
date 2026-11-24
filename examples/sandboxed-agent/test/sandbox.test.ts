import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { createApp, mintLocalOwnerToken } from "@openboard/server";
import { createClient } from "@the-vibe-company/openboard";

const profile = "fixer-2";
const root = await mkdtemp(join(tmpdir(), "openboard-sandboxed-agent-"));
const agentDir = join(root, "agent");
const launcher = Bun.fileURLToPath(new URL("../src/main.ts", import.meta.url));

beforeAll(async () => {
  // Stage the npm launcher and its Node bundle with the SDK as a separate package.
  const cli = new URL("../", Bun.pathToFileURL(Bun.resolveSync("@the-vibe-company/openboard-cli", import.meta.dir)));
  const sdk = join(agentDir, "node_modules/@the-vibe-company/openboard");
  await Promise.all([
    Bun.build({
      entrypoints: [Bun.fileURLToPath(new URL("src/main.ts", cli))],
      outdir: join(agentDir, "dist"),
      target: "node",
      format: "esm",
      external: ["@the-vibe-company/openboard"],
    }),
    Bun.build({
      entrypoints: [Bun.resolveSync("@the-vibe-company/openboard", import.meta.dir)],
      outdir: sdk,
      target: "browser",
    }),
  ]);
  await Bun.write(join(sdk, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
  await Bun.write(join(agentDir, "package.json"), JSON.stringify({ type: "module" }));
  await mkdir(join(agentDir, "bin"));
  await copyFile(new URL("bin/ob.js", cli), join(agentDir, "bin/ob.js"));
  await Bun.write(
    join(agentDir, "agent.mjs"),
    `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { request } from "node:http";

    const [,, mode] = process.argv;
    const env = process.env;
    assert.deepEqual(Object.keys(env).sort(), ["BOARD_PROFILE", "BOARD_TOKEN", "BOARD_URL"]);
    assert.equal(env.BOARD_PROFILE, "fixer-2");
    assert.ok(mode === "claim" ? env.BOARD_TOKEN.startsWith("obt_") : env.BOARD_TOKEN === "<placeholder>");
    assert.ok(!JSON.stringify([env, process.argv, process.execArgv]).includes("ob" + "c_"));
    assert.throws(() => readFileSync("../policy.json"), { code: "ERR_ACCESS_DENIED" });

    for (const args of [["whoami"], ["post", "dev", "hi"]]) {
      process.argv = [process.execPath, "./bin/ob.js", ...args];
      await import("./bin/ob.js?" + args[0]);
      assert.equal(process.exitCode, 0);
    }

    const headers = { authorization: "Bearer " + env.BOARD_TOKEN, "content-type": "application/json" };
    for (const path of ["/grants", "/x/webhooks"]) {
      const response = await fetch(env.BOARD_URL + path, { method: "POST", headers, body: "{}" });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "forbidden");
      console.log("POST " + path + " → " + response.status + " forbidden");
    }

    if (mode === "proxy") {
      assert.equal((await fetch(env.BOARD_URL + "/")).status, 200);
      const messages = new URL(env.BOARD_URL).pathname + "/messages";
      for (const [path, host] of [[messages, "other.example"], ["http://other.example" + messages]]) {
        const status = await new Promise((resolve, reject) => {
          const probe = request(env.BOARD_URL, { method: "POST", path, headers: host ? { host } : {} }, (response) => {
            response.resume();
            resolve(response.statusCode);
          });
          probe.on("error", reject);
          probe.end();
        });
        assert.equal(status, 403);
        console.log((host ? "foreign Host header" : "absolute foreign target") + " → " + status);
      }
    }
  `,
  );
});

afterAll(() => rm(root, { force: true, recursive: true }));

function board() {
  const now = () => 1_700_000_000_000;
  const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
  const store = sqliteDriver({ memory: true }, now);
  let drawn = 0;
  let requests = 0;
  let handle = (_request: Request): Response | Promise<Response> => new Response(null, { status: 503 });
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handle(request) });
  const app = createApp(
    {
      mode: "local",
      publicUrl: listener.url.origin,
      localOwner: "ob:user:local-test",
      localOwnerTokenHash: owner.hash,
      secretKey: new Uint8Array(32).fill(12),
    },
    { store, jobs: store.jobs },
    {
      now,
      requestId: () => `req-${++requests}`,
      randomBytes: (length) => new Uint8Array(length).fill(++drawn),
      log: { info: () => {}, error: () => {} },
      schedule: () => () => {},
    },
  );
  handle = app.fetch;
  const url = `${listener.url.origin}/api/local/main`;
  return {
    url,
    owner: createClient({ url, token: owner.token }),
    close: async () => {
      await listener.stop(true);
      await app.close();
    },
  };
}

async function launch(mode: "claim" | "proxy", args: string[], secret: string) {
  const node = Bun.which("node");
  if (!node) throw new Error("Node is required to test the npm CLI");
  const command = [
    process.execPath,
    launcher,
    mode,
    ...args,
    "--",
    node,
    "--experimental-permission",
    `--allow-fs-read=${agentDir}`,
    "./agent.mjs",
    mode,
  ];
  const child = Bun.spawn(command, {
    cwd: mode === "claim" ? agentDir : root,
    stdin: new Blob([secret]),
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await child.exited).toBe(0);

  for (const file of await readdir(agentDir, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    // CLI code can mention a credential prefix. Inspect files for complete connection secrets.
    const content = await Bun.file(join(file.parentPath, file.name)).text();
    if (/obc_[a-z2-7]{16}_[A-Za-z0-9_-]{43}/.test(content)) throw new Error("agent file contains a connection secret");
  }
}

for (const mode of ["claim", "proxy"] as const) {
  test(`${mode} launches the npm CLI with scrubbed credentials and refuses restricted requests`, async () => {
    const app = board();
    try {
      const { connection, secret } = await app.owner.createConnection({
        name: `${mode}-test`,
        profiles: ["fixer-*"],
        direct: mode === "proxy",
        can: { dev: ["read", "post"] },
      });
      const args = [app.url, profile];
      if (mode === "proxy") {
        const policy = await app.owner.getConnectionPolicy({ id: connection.id, profile, can: "dev=read,post" });
        const path = join(root, "policy.json");
        await Bun.write(path, JSON.stringify(policy));
        args.splice(0, args.length, path, agentDir);
      }
      await launch(mode, args, secret);
      const { messages } = await app.owner.listMessages({ channel: "dev" });
      const actor = `ob:conn:${connection.id}+${profile}`;
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ by: { actor }, text: "hi" });
      console.log(`verified post #${messages[0]?.id} by ${actor}; child env, argv and files checked`);
    } finally {
      await app.close();
    }
  });
}
