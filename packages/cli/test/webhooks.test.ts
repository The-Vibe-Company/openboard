import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/main.ts";

const env = { BOARD_URL: "http://127.0.0.1:8787/api/local/main" };
const secret = ["whsec", Buffer.alloc(32, 3).toString("base64")].join("_");
const spec = { name: "dev", url: "http://127.0.0.1:9000/hook", filter: { tail: "dev" } };
const webhook = { ...spec, id: "wh_fixture" };
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "openboard-webhook-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function fixture(result: unknown, status = 200) {
  const out: string[] = [];
  const errors: string[] = [];
  const requests: Request[] = [];
  return {
    out,
    errors,
    requests,
    run: (args: string[]) =>
      runCli(["webhooks", ...args], env, {
        output: { out: (line) => out.push(line), err: (line) => errors.push(line) },
        fetch: async (request) => {
          requests.push(request);
          return Response.json(result, { status });
        },
      }),
  };
}

for (const existing of [false, true]) {
  test(`ob webhooks create ${existing ? "uses" : "creates"} a private secret file and prints only the ID`, async () => {
    const config = join(directory, "spec.json");
    const path = join(directory, "hook.secret");
    writeFileSync(config, JSON.stringify(spec));
    if (existing) writeFileSync(path, `${secret}\n`, { mode: 0o600 });
    const capture = fixture({ webhook, secret }, 201);
    expect(await capture.run(["create", "--file", config, "--secret-file", path])).toBe(0);
    const request = capture.requests[0]!;
    expect(request.url).toBe(`${env.BOARD_URL}/x/webhooks`);
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual(existing ? { ...spec, signing: { secret } } : spec);
    expect(readFileSync(path, "utf8")).toBe(`${secret}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(capture.out).toEqual([webhook.id]);
    expect(capture.errors).toEqual([]);
  });
}

test("ob webhooks create saves a generated stripe secret verbatim", async () => {
  const config = join(directory, "spec.json");
  const path = join(directory, "hook.secret");
  writeFileSync(config, JSON.stringify({ ...spec, signing: { preset: "stripe" } }));
  const capture = fixture({ webhook, secret }, 201);

  expect(await capture.run(["create", "--file", config, "--secret-file", path])).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(secret);
});

test.each(["github", "stripe"])("ob webhooks create sends the %s secret file verbatim", async (preset) => {
  const config = join(directory, "spec.json");
  const path = join(directory, "hook.secret");
  const receiverSpec = { ...spec, signing: { preset } };
  const contents = "  receiver's café fixture\n";
  writeFileSync(config, JSON.stringify(receiverSpec));
  writeFileSync(path, contents, { mode: 0o600 });
  const capture = fixture({ webhook }, 201);

  expect(await capture.run(["create", "--file", config, "--secret-file", path])).toBe(0);
  const [request] = capture.requests;
  if (!request) throw new Error("missing create request");
  expect(await request.json()).toEqual({ ...receiverSpec, signing: { ...receiverSpec.signing, secret: contents } });
  expect(readFileSync(path, "utf8")).toBe(contents);
  expect(capture.out).toEqual([webhook.id]);
  expect(capture.errors).toEqual([]);
});

test("ob webhooks, show and delete print the board response without credentials", async () => {
  const commands = [
    { args: [], response: { webhooks: [webhook] }, path: "", method: "GET" },
    { args: ["show", webhook.id], response: webhook, path: `/${webhook.id}`, method: "GET" },
    { args: ["delete", webhook.id], response: { id: webhook.id }, path: `/${webhook.id}/delete`, method: "POST" },
  ];
  for (const { args, response, path, method } of commands) {
    const capture = fixture(response);
    expect(await capture.run(args)).toBe(0);
    expect(capture.requests[0]?.url).toBe(`${env.BOARD_URL}/x/webhooks${path}`);
    expect(capture.requests[0]?.method).toBe(method);
    expect(JSON.parse(capture.out.join("\n"))).toEqual(response);
    expect(capture.errors).toEqual([]);
  }
});
