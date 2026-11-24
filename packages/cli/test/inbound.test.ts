import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/main.ts";

const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
const id = "ib_aaaaaaaaaaaaaaaa";
const inbound = { id, url: `${BOARD_URL}/x/inbound/${id}/events` };
const spec = {
  name: "runner",
  can: { "*": ["read"] },
  verify: { preset: "ts-id-body", signatureHeader: "X-Sig", timestampHeader: "X-Time", idHeader: "X-Id" },
  thread: { from: "{{body.ref}}", pattern: "^ob:(\\d+)$" },
  rules: [],
};

function capture(response: unknown, status = 200) {
  const out: string[] = [];
  const errors: string[] = [];
  const requests: Request[] = [];
  return {
    out,
    errors,
    requests,
    run: (...args: string[]) =>
      runCli(
        ["inbound", ...args],
        { BOARD_URL },
        {
          output: { out: (line) => out.push(line), err: (line) => errors.push(line) },
          fetch: async (request) => {
            requests.push(request);
            return Response.json(response, { status });
          },
        },
      ),
  };
}

test.each(["generate", "reuse", "failure"])("ob inbound create handles private secret files (%s)", async (mode) => {
  const directory = mkdtempSync(join(tmpdir(), "openboard-inbound-"));
  try {
    const config = join(directory, "spec.json");
    const path = join(directory, "inbound.secret");
    const secret = "  receiver fixture\n";
    writeFileSync(config, JSON.stringify(spec));
    if (mode === "reuse") writeFileSync(path, secret, { mode: 0o600 });
    const client =
      mode === "failure"
        ? capture({ error: { code: "forbidden", message: "manage required" } }, 403)
        : capture(mode === "reuse" ? { inbound } : { inbound, secret }, 201);
    const result = await client.run("create", "--file", config, "--secret-file", path);
    const [request] = client.requests;
    if (!request) throw new Error("missing create request");
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${BOARD_URL}/x/inbound`);
    expect(await request.json()).toEqual(mode === "reuse" ? { ...spec, verify: { ...spec.verify, secret } } : spec);
    if (mode === "failure") {
      expect(result).not.toBe(0);
      expect(existsSync(path)).toBe(false);
      expect(client.errors).toEqual(["error: forbidden: manage required"]);
      expect(client.out).toEqual([]);
      return;
    }
    expect(result).toBe(0);
    expect(client.out).toEqual([inbound.url]);
    expect(client.errors).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(secret);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ob inbound, show and delete print the board response", async () => {
  for (const { args, response, suffix, method } of [
    { args: [], response: { inbound: [inbound] }, suffix: "", method: "GET" },
    { args: ["show", id], response: inbound, suffix: `/${id}`, method: "GET" },
    { args: ["delete", id], response: { id }, suffix: `/${id}/delete`, method: "POST" },
  ]) {
    const client = capture(response);
    expect(await client.run(...args)).toBe(0);
    expect(client.requests[0]?.url).toBe(`${BOARD_URL}/x/inbound${suffix}`);
    expect(client.requests[0]?.method).toBe(method);
    expect(JSON.parse(client.out.join("\n"))).toEqual(response);
    expect(client.errors).toEqual([]);
  }
});
