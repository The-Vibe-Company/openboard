import { expect, test } from "bun:test";
import { createClient } from "../src/index.ts";

test("a bodyless organization write sends the configured CSRF header", async () => {
  const principal = "ob:user:u_member";
  const client = createClient({
    url: "http://127.0.0.1:8787/api/acme/main",
    csrf: "fixture",
    fetch: async (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe("/api/x/orgs/acme/members/ob%3Auser%3Au_member/remove");
      expect(request.headers.get("x-ob-csrf")).toBe("fixture");
      expect(request.body).toBeNull();
      return Response.json({ principal });
    },
  });

  expect(await client.removeMember({ org: "acme", user: principal })).toEqual({ principal });
});
