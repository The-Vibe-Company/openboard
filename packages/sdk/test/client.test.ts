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

test("CSRF covers a board write and is omitted on reads", async () => {
  const requests: Request[] = [];
  const client = createClient({
    url: "http://127.0.0.1:8787/api/acme/main",
    csrf: "fixture",
    fetch: async (request) => {
      requests.push(request);
      return Response.json({});
    },
  });
  await client.postMessage({ channel: "dev", text: "hello" });
  await client.getSession({});
  expect(requests.map((request) => request.headers.get("x-ob-csrf"))).toEqual(["fixture", null]);
});

test("getAvatar reads SVG and preserves JSON errors", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const client = createClient({
    url: "http://127.0.0.1:8787/api/acme/main",
    fetch: async (request) => {
      expect(request.headers.get("accept")).toBe("image/svg+xml");
      const path = new URL(request.url).pathname;
      if (path === "/api/acme/main/avatars/agent") {
        return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
      }
      expect(path).toBe("/api/acme/main/avatars/unknown");
      return Response.json({ error: { code: "not_found", message: "no such avatar" } }, { status: 404 });
    },
  });
  expect(await client.getAvatar({ name: "agent" })).toBe(svg);
  await expect(client.getAvatar({ name: "unknown" })).rejects.toMatchObject({ code: "not_found" });
});

test("only opted-in account operations send the personal bearer", async () => {
  const requests: Request[] = [];
  const token = ["obp", "fixture"].join("_");
  const client = createClient({
    url: "http://127.0.0.1:8787/api/acme/main",
    token,
    fetch: async (request) => {
      requests.push(request);
      return Response.json({});
    },
  });
  await client.listPersonalTokens({});
  await client.revokePersonalToken({ id: "example" });
  await client.getAccount({});
  expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
    `Bearer ${token}`,
    `Bearer ${token}`,
    null,
  ]);
});

test("signed events send the supplied headers and raw bytes", async () => {
  const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0xff);
  const result = { ok: true as const, matched: [], results: [] };
  const client = createClient({
    url: "http://127.0.0.1:8787/api/acme/main",
    token: "board bearer fixture",
    fetch: async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/acme/main/x/inbound/ib_fixture/events");
      expect(request.method).toBe("POST");
      expect(request.headers.get("webhook-signature")).toBe("signature fixture");
      expect(request.headers.has("authorization")).toBe(false);
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
      return Response.json(result);
    },
  });
  const headers = { "webhook-signature": "signature fixture" };
  expect(await client.receiveInboundEvent({ id: "ib_fixture" }, { signed: { headers, body: bytes } })).toEqual(result);
});

test("the metrics client sends the operator bearer and reads the Prometheus response as text", async () => {
  const client = createClient({
    url: "https://board.example/api/local/main",
    token: "example-metrics",
    fetch: async (request) => {
      expect(request.url).toBe("https://board.example/api/x/metrics");
      expect(request.headers.get("authorization")).toBe("Bearer example-metrics");
      return new Response("sample 1\n", { headers: { "content-type": "text/plain; version=0.0.4" } });
    },
  });
  expect(await client.getMetrics({})).toBe("sample 1\n");
});
