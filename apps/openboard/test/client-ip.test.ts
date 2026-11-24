import { expect, test } from "bun:test";
import { clientIp } from "../src/client-ip.ts";
import { loadConfig } from "../src/config.ts";

const peer = "192.0.2.10";
const spoofed = "192.0.2.20";
const client = "192.0.2.30";

test("unconfigured listeners ignore both forwarded IP headers", () => {
  const headers = new Headers({ "x-forwarded-for": spoofed, "x-real-ip": spoofed });
  expect(clientIp(headers, peer, loadConfig({}).trustedProxies)).toBe(peer);
});

test("configured listeners count from the right and ignore client-supplied IPs", () => {
  const config = loadConfig({ OPENBOARD_TRUSTED_PROXIES: "1" });
  const headers = new Headers({ "x-forwarded-for": `${spoofed}, ${client}`, "x-real-ip": spoofed });
  expect(clientIp(headers, peer, config.trustedProxies)).toBe(client);
  headers.append("x-forwarded-for", "192.0.2.40");
  expect(clientIp(headers, peer, 2)).toBe(client);
  expect(clientIp(headers, peer, 4)).toBe(peer);
  headers.append("x-forwarded-for", "not-an-ip");
  expect(clientIp(headers, peer, 1)).toBe(peer);
  headers.delete("x-forwarded-for");
  expect(clientIp(headers, peer, 1)).toBe(peer);
});

test("trusted proxy hops must be a positive integer", () => {
  for (const value of ["", "0", "-1", "1.1", "1e3", "9007199254740992"]) {
    expect(() => loadConfig({ OPENBOARD_TRUSTED_PROXIES: value })).toThrow("OPENBOARD_TRUSTED_PROXIES");
  }
});
