import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
const commit = {
  id: "git-commit@1",
  name: "git-commit",
  version: 1,
  builtIn: true,
  by: null,
  at: null,
  description: "A Git commit.",
  schema: { type: "object" },
};
const deployment = { ...commit, id: "vercel-deployment@1", name: "vercel-deployment", description: null };

async function run(args: string[], path: string, response: Response) {
  const out: string[] = [];
  const err: string[] = [];
  const status = await runCli(
    args,
    { BOARD_URL },
    {
      fetch: async (request) => {
        expect(request.url).toBe(`${BOARD_URL}${path}`);
        return response;
      },
      output: { out: (line) => out.push(line), err: (line) => err.push(line) },
    },
  );
  return { status, out, err };
}

test("schemas lists built-in IDs and marks them built in", async () => {
  const result = await run(["schemas"], "/schemas", Response.json({ schemas: [commit, deployment] }));
  expect(result).toEqual({
    status: 0,
    out: ["git-commit@1  built in  A Git commit.\nvercel-deployment@1  built in"],
    err: [],
  });
});

test("schemas inspect --json prints the schema envelope", async () => {
  const result = await run(
    ["schemas", "inspect", commit.id, "--json"],
    `/schemas/${encodeURIComponent(commit.id)}`,
    Response.json({ schema: commit }),
  );
  expect(result.status).toBe(0);
  expect(result.err).toEqual([]);
  expect(result.out.map((line) => JSON.parse(line))).toEqual([{ schema: commit }]);
});

test("schemas inspect reports an unknown version as a CLI error", async () => {
  const result = await run(
    ["schemas", "inspect", "conformance-none@1"],
    "/schemas/conformance-none%401",
    Response.json({ error: { code: "schema_not_found", message: "Schema not found." } }, { status: 404 }),
  );
  expect(result).toEqual({ status: 1, out: [], err: ["error: schema_not_found: Schema not found."] });
});
