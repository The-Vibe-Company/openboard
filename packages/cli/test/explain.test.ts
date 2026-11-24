import { expect, test } from "bun:test";
import { runCli } from "../src/main.ts";

test("grants explain formats upstream grant details and wraps the JSON output", async () => {
  const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
  const explanation = {
    channel: "dev/web",
    pattern: "dev/",
    over: ["*"],
    level: "principal",
    grants: [{ id: "g5", principals: [{ kind: "connection" }] }],
    capped: null,
    can: ["read", "post"],
  };
  const out: string[] = [];
  const user = `u_${"a".repeat(16)}`;
  const send = (args: string[], query: string) =>
    runCli(
      ["grants", "explain", ...args],
      { BOARD_URL },
      {
        fetch: async (request) => {
          expect(request.url).toBe(`${BOARD_URL}/grants/explain?channel=dev%2Fweb${query}`);
          return Response.json(explanation);
        },
        output: {
          out: (line) => out.push(line),
          err: (line) => {
            throw new Error(line);
          },
        },
      },
    );
  expect(await send(["dev/web"], "")).toBe(0);
  expect(await send(["--user", user, "dev/web", "--json"], `&user=${user}`)).toBe(0);
  expect(out[0]).toBe("dev/ wins over *. Closest grant for you: g5 (--connection): read, post.");
  expect(JSON.parse(out[1] ?? "")).toEqual({ explanation });
});
