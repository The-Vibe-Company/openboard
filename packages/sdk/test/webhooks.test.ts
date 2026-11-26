import { expect, test } from "bun:test";
import { parseWebhookEvent, verifyWebhookSignature } from "../src/index.ts";

const id = "dl_fixture";
const now = () => 1_700_000_000_000;
const timestamp = String(now() / 1000);
const key = Buffer.alloc(32, 7);
const secret = `whsec_${key.toString("base64")}`;
const ping = {
  type: "board.ping",
  version: 1,
  board: { org: "local", board: "main", url: "https://board.example/api/local/main" },
  delivery: { id, attempt: 1, webhook: "wh_fixture", name: "Café" },
} as const;

async function signed(body: string | Uint8Array = JSON.stringify(ping)) {
  const signingKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = Buffer.from(`${id}.${timestamp}.`);
  const bytes = Buffer.concat([prefix, typeof body === "string" ? Buffer.from(body) : body]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", signingKey, bytes)).toString("base64");
  return {
    headers: { "Webhook-ID": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` },
    body,
    secret,
    now,
  };
}

test("verifies the exact UTF-8 bytes and parses a signed ping", async () => {
  const input = await signed(new TextEncoder().encode(JSON.stringify(ping, null, 2)));
  expect(await verifyWebhookSignature(input)).toBe(true);
  expect(await parseWebhookEvent({ ...input, headers: new Headers(input.headers) })).toEqual(ping);
  expect(await verifyWebhookSignature({ ...input, body: JSON.stringify(ping) })).toBe(false);
});

test("rejects tampered bodies, bad secrets, and invalid timestamp windows", async () => {
  const input = await signed();
  expect(await verifyWebhookSignature({ ...input, secret: "whsec_%%%" })).toBe(false);
  await expect(parseWebhookEvent({ ...input, body: "{}" })).rejects.toMatchObject({ code: "unauthorized" });
  for (const offset of [-301_000, 301_000]) {
    const late = { ...input, now: () => now() + offset };
    expect(await verifyWebhookSignature(late)).toBe(false);
    expect(await verifyWebhookSignature({ ...late, toleranceSeconds: 301 })).toBe(true);
  }
  expect(await verifyWebhookSignature({ ...input, toleranceSeconds: Infinity })).toBe(false);
});

test("tries multiple v1 signatures, including coalesced Headers values", async () => {
  const input = await signed();
  const headers = new Headers(input.headers);
  const wrong = `v1,${Buffer.alloc(32).toString("base64")}`;
  headers.set("webhook-signature", `v2,ignored ${wrong}`);
  headers.append("webhook-signature", input.headers["webhook-signature"]);
  expect(await verifyWebhookSignature({ ...input, headers })).toBe(true);
  headers.set("webhook-signature", `v1,%%% ${wrong}`);
  expect(await verifyWebhookSignature({ ...input, headers })).toBe(false);
});

test("requires all three signing headers", async () => {
  const input = await signed();
  for (const name of Object.keys(input.headers)) {
    const headers = new Headers(input.headers);
    headers.delete(name);
    expect(await verifyWebhookSignature({ ...input, headers })).toBe(false);
  }
});

test("accepts signatures for custom bodies but requires the v1 envelope when parsing", async () => {
  for (const body of [
    "{",
    "{}",
    JSON.stringify({ ...ping, version: 2 }),
    JSON.stringify({ ...ping, delivery: { ...ping.delivery, id: "other" } }),
    JSON.stringify({ ...ping, type: "board.event", event: {} }),
  ]) {
    const input = await signed(body);
    expect(await verifyWebhookSignature(input)).toBe(true);
    await expect(parseWebhookEvent(input)).rejects.toMatchObject({ code: "invalid_request" });
  }
});
