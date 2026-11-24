import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

test("grants create sends the upstream modifiers with their principal and prints the created grant", async () => {
  const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
  const id = `cn_${"a".repeat(16)}`;
  const expected = {
    principals: [
      { kind: "connection", connection: id },
      { kind: "github", repository: "example/web", workflow: "ci.yml", branch: "main" },
      { kind: "oidc", issuer: "https://issuer.example", claims: { sub: "repo:example/*", group: ["one", "two"] } },
    ],
    can: { "deploys/": ["read", "post"], ops: "all" },
  };
  const out: string[] = [];
  const code = await runCli(
    [
      "grants",
      "create",
      "--connection",
      id,
      "--github",
      "example/web",
      "--workflow",
      "ci.yml",
      "--git-branch",
      "main",
      "--oidc",
      "https://issuer.example",
      "--claim",
      "sub=repo:example/*",
      "--claim",
      "group=one",
      "--claim",
      "group=two",
      "--can",
      "deploys/=read,post",
      "--can",
      "ops=all",
    ],
    { BOARD_URL },
    {
      fetch: async (request) => {
        expect(request.url).toBe(`${BOARD_URL}/grants`);
        expect(await request.json()).toEqual(expected);
        return Response.json({ grant: { id: "g5", can: expected.can } });
      },
      output: {
        out: (line) => out.push(line),
        err: (line) => {
          throw new Error(line);
        },
      },
    },
  );
  expect(code).toBe(0);
  expect(out).toEqual([
    `created g5  --connection ${id} --github example/web --workflow ci.yml --git-branch main --oidc https://issuer.example --claim sub=repo:example/* --claim group=one --claim group=two  deploys/=read,post ops=all`,
  ]);
});

test("rejects duplicate channel patterns before sending the request", async () => {
  const errors: string[] = [];
  const status = await runCli(
    ["grants", "create", "--all-users", "--can", "dev=read;ops=read", "--can", "dev=post"],
    { BOARD_URL: "http://127.0.0.1:8787/api/local/main" },
    {
      fetch: async () => {
        throw new Error("unexpected request");
      },
      output: { out: () => {}, err: (line) => errors.push(line) },
    },
  );
  expect(status).toBe(2);
  expect(errors[0]).toContain("--can names dev more than once");
});
