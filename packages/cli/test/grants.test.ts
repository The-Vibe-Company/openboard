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
    can: { "deploys/": ["read", "post"], "deploys/secret/": [], ops: "all" },
    lockMeOut: true,
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
      "deploys/secret/=none",
      "--can",
      "ops=all",
      "--lock-me-out",
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
    `created g5  --connection ${id} --github example/web --workflow ci.yml --git-branch main --oidc https://issuer.example --claim sub=repo:example/* --claim group=one --claim group=two  deploys/=read,post deploys/secret/=none ops=all`,
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

test("grants lists each grant as upstream's vb grants prints it, and --json prints { grants }", async () => {
  const id = `cn_${"b".repeat(16)}`;
  const grants = [
    { id: "g1", principals: [{ kind: "all-users" }], can: { "*": "all" }, capped: true, by: null, at: null },
    { id: "g3", principals: [{ kind: "all-apps" }], can: { "*": ["read", "post"] }, capped: false, by: null, at: null },
    {
      id: "g4",
      principals: [{ kind: "connection", connection: id }],
      can: { dev: ["read", "post"], "dev/secret": [] },
      capped: false,
      by: "ob:user:local",
      at: "2026-11-24T00:00:00.000Z",
    },
    {
      id: "g12",
      principals: [{ kind: "user", userId: "u_example", email: null }, { kind: "all-connections" }],
      can: { "*": [] },
      capped: false,
      by: "ob:user:local",
      at: "2026-11-24T00:00:00.000Z",
    },
  ];
  const run = async (args: string[]) => {
    const out: string[] = [];
    const code = await runCli(
      args,
      { BOARD_URL: "http://127.0.0.1:8787/api/local/main" },
      {
        fetch: async (request) => {
          expect(request.method).toBe("GET");
          expect(request.url).toBe("http://127.0.0.1:8787/api/local/main/grants");
          return Response.json({ grants });
        },
        output: { out: (line) => out.push(line), err: (line) => out.push(line) },
      },
    );
    return { code, out };
  };
  expect(await run(["grants"])).toEqual({
    code: 0,
    out: [
      [
        "g1   --all-users                         everything your role allows",
        "g3   --all-apps                          read post",
        `g4   --connection ${id}    dev=read,post dev/secret=none`,
        "g12  --user u_example --all-connections  nothing",
      ].join("\n"),
    ],
  });
  const json = await run(["grants", "--json"]);
  expect(JSON.parse(json.out.join("\n"))).toEqual({ grants });
});

test("grants revoke prints the result and projects --lock-me-out into the request", async () => {
  const boardUrl = "http://127.0.0.1:8787/api/local/main";
  const run = async (revoked: boolean, ...flags: string[]) => {
    const out: string[] = [];
    const code = await runCli(
      ["grants", "revoke", "g5", ...flags],
      { BOARD_URL: boardUrl },
      {
        fetch: async (request) => {
          expect(request.method).toBe("POST");
          expect(request.url).toBe(`${boardUrl}/grants/g5/revoke`);
          expect(await request.json()).toEqual(flags.includes("--lock-me-out") ? { lockMeOut: true } : {});
          return Response.json({ revoked });
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
    return out;
  };
  expect(await run(true)).toEqual(["revoked g5"]);
  expect(await run(false, "--lock-me-out", "--json")).toEqual(['{\n  "revoked": false\n}']);
});

test("grants update sends add and remove flags and prints the returned principals", async () => {
  const boardUrl = "http://127.0.0.1:8787/api/local/main";
  const connection = `cn_${"a".repeat(16)}`;
  const out: string[] = [];
  const status = await runCli(
    [
      "grants",
      "update",
      "g5",
      "--add-connection",
      connection,
      "--add-project",
      "prj_x",
      "--environment",
      "production",
      "--remove-all-users",
      "--can",
      "deploys/=read",
    ],
    { BOARD_URL: boardUrl },
    {
      fetch: async (request) => {
        expect(request.method).toBe("PATCH");
        expect(request.url).toBe(`${boardUrl}/grants/g5`);
        expect(await request.json()).toEqual({
          add: [
            { kind: "connection", connection },
            { kind: "project", project: "prj_x", environments: ["production"] },
          ],
          remove: [{ kind: "all-users" }],
          can: { "deploys/": ["read"] },
        });
        return Response.json({
          grant: {
            id: "g5",
            principals: [
              { kind: "project", projectId: "prj_x", environments: ["production", "preview"] },
              { kind: "connection", connection },
            ],
            can: { "deploys/": ["read"] },
          },
        });
      },
      output: {
        out: (line) => out.push(line),
        err: (line) => {
          throw new Error(line);
        },
      },
    },
  );
  expect(status).toBe(0);
  expect(out).toEqual([
    `updated g5  --project prj_x --environment production,preview --connection ${connection}  deploys/=read`,
  ]);
});

test("grants update refuses environment modifiers on project removals before sending a request", async () => {
  const errors: string[] = [];
  const status = await runCli(
    ["grants", "update", "g5", "--remove-project", "prj_x", "--environment", "preview"],
    { BOARD_URL: "http://127.0.0.1:8787/api/local/main" },
    {
      fetch: async () => {
        throw new Error("unexpected request");
      },
      output: { out: () => {}, err: (line) => errors.push(line) },
    },
  );
  expect(status).toBe(2);
  expect(errors[0]).toContain("re-add it with the environments to keep");
});
