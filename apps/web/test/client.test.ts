import { expect, test } from "bun:test";
import { browserClient } from "../src/api/client.ts";

test("browser writes use the current session proof and same-origin credentials", async () => {
  const calls: [string, string | null, RequestCredentials | undefined][] = [];
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input);
    const { pathname } = new URL(request.url);
    calls.push([pathname, request.headers.get("x-ob-csrf"), init?.credentials]);
    return Response.json(pathname === "/api/x/session" ? { csrf: "fixture" } : {});
  };
  const client = browserClient("http://localhost:5173", { org: "acme", board: "main" }, fake);
  await client.postMessage({ channel: "dev", text: "hello" });
  expect(calls).toEqual([
    ["/api/x/session", null, "same-origin"],
    ["/api/acme/main/messages", "fixture", "same-origin"],
  ]);
});
