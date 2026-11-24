import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const customSigning = {
  algorithm: "hmac-sha256",
  signatureHeader: "x-signature",
  signatureFormat: "sha256={sig}",
  encoding: "hex",
  signedPayload: "{body}",
};

test.each([[false], [true]])("ob webhooks create preserves custom key bytes (existing: %s)", async (existing) => {
  const config = join(directory, "spec.json");
  const path = join(directory, "hook.secret");
  const receiverSpec = { ...spec, signing: customSigning };
  const key = existing ? "\uFEFF  receiver café fixture\n" : secret;
  writeFileSync(config, JSON.stringify(receiverSpec));
  if (existing) writeFileSync(path, key, { mode: 0o600 });
  const capture = fixture(existing ? { webhook } : { webhook, secret: key }, 201);

  expect(await capture.run(["create", "--file", config, "--secret-file", path])).toBe(0);
  const [request] = capture.requests;
  if (!request) throw new Error("missing create request");
  expect(await request.json()).toEqual(
    existing ? { ...spec, signing: { ...customSigning, secret: key } } : receiverSpec,
  );
  expect(readFileSync(path, "utf8")).toBe(key);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(capture.out).toEqual([webhook.id]);
  expect(capture.errors).toEqual([]);
});

test("ob webhooks create rejects custom key files with malformed UTF-8", async () => {
  const config = join(directory, "spec.json");
  const path = join(directory, "hook.secret");
  const bytes = Buffer.from([0xff]);
  writeFileSync(config, JSON.stringify({ ...spec, signing: customSigning }));
  writeFileSync(path, bytes, { mode: 0o600 });
  const capture = fixture({ webhook }, 201);

  expect(await capture.run(["create", "--file", config, "--secret-file", path])).toBe(2);
  expect(capture.errors.join("\n")).toContain("--secret-file must contain valid UTF-8");
  expect(capture.requests).toHaveLength(0);
  expect(readFileSync(path)).toEqual(bytes);
});

test.each(["stripe", "ts-id-body"])("ob webhooks create saves a generated %s secret verbatim", async (preset) => {
  const config = join(directory, "spec.json");
  const path = join(directory, "hook.secret");
  writeFileSync(config, JSON.stringify({ ...spec, signing: { preset } }));
  const capture = fixture({ webhook, secret }, 201);

  expect(await capture.run(["create", "--file", config, "--secret-file", path])).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(secret);
});

test.each(["github", "stripe", "ts-id-body"])(
  "ob webhooks create sends the %s secret file verbatim",
  async (preset) => {
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
  },
);

test("ob webhooks, show and delete print the board response without credentials", async () => {
  const commands = [
    { args: [], response: { webhooks: [webhook] }, path: "", method: "GET" },
    { args: ["show", webhook.id, "--json"], response: webhook, path: `/${webhook.id}`, method: "GET" },
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

test("ob webhooks deliveries help shows the retention windows", async () => {
  const capture = fixture(null);
  expect(await capture.run(["deliveries", "--help"])).toBe(0);
  expect(capture.out).toEqual([
    "ob webhooks deliveries <id> [--state <state>] [--before <before>] [--limit <limit>]",
    "List a webhook's deliveries newest first. Done and skipped deliveries are kept for 7 days, and dead deliveries for 30 days.",
  ]);
  expect(capture.requests).toEqual([]);
});

test("ob webhooks deliveries keeps the status and the failure class when both carry information", async () => {
  const response = {
    deliveries: [
      { id: "dl_timeout", state: "dead", attempt: 10, lastStatus: 200, lastError: "timeout" },
      { id: "dl_status", state: "dead", attempt: 10, lastStatus: 503, lastError: "status" },
      { id: "dl_tls", state: "dead", attempt: 10, lastStatus: null, lastError: "tls" },
    ],
    older: null,
  };
  const args = ["deliveries", webhook.id, "--state", "dead"];
  const text = fixture(response);
  expect(await text.run(args)).toBe(0);
  expect(text.out).toEqual([
    "dl_timeout  dead  attempt 10  200  timeout\ndl_status  dead  attempt 10  503\ndl_tls  dead  attempt 10  tls",
  ]);
  const json = fixture(response);
  expect(await json.run([...args, "--json"])).toBe(0);
  expect(JSON.parse(json.out.join("\n"))).toEqual(response);
});

test.each([true, false])("webhooks updates and displays enabled=%s without leaking credentials", async (enabled) => {
  const changed = { ...webhook, enabled, disabledReason: enabled ? null : "gone" };
  const capture = fixture({ webhook: changed, secret });
  expect(await capture.run([enabled ? "enable" : "disable", webhook.id])).toBe(0);
  expect(capture.requests[0]?.url).toBe(`${env.BOARD_URL}/x/webhooks/${webhook.id}`);
  expect(capture.requests[0]?.method).toBe("POST");
  expect(await capture.requests[0]?.json()).toEqual({ enabled });
  expect(capture.out).toEqual([
    `${webhook.id}  ${webhook.name}  ${webhook.url}  ${enabled ? "enabled" : "disabled: gone"}`,
  ]);
});

test("webhooks show escapes terminal controls in a stored name", async () => {
  const capture = fixture({ ...webhook, name: "line\n\u001b[2K", enabled: false, disabledReason: "gone" });
  expect(await capture.run(["show", webhook.id])).toBe(0);
  expect(capture.out).toEqual([`${webhook.id}  line\\u{a}\\u{1b}[2K  ${webhook.url}  disabled: gone`]);
});

test.each(["omitted", "new", "existing"])(
  "ob webhooks create with none skips the %s signing secret file",
  async (file) => {
    const config = join(directory, "spec.json");
    const path = join(directory, "hook.secret");
    const unsigned = { ...spec, signing: { preset: "none" } };
    writeFileSync(config, JSON.stringify(unsigned));
    if (file === "existing") writeFileSync(path, "fixture");
    const capture = fixture({ webhook }, 201);
    const flags = file === "omitted" ? [] : ["--secret-file", path];
    expect(await capture.run(["create", "--file", config, ...flags])).toBe(0);
    expect(capture.requests).toHaveLength(1);
    expect(await capture.requests[0]?.json()).toEqual(unsigned);
    if (file === "existing") expect(readFileSync(path, "utf8")).toBe("fixture");
    else expect(existsSync(path)).toBe(false);
    expect(capture.out).toEqual([webhook.id]);
    expect(capture.errors).toEqual([]);
  },
);
