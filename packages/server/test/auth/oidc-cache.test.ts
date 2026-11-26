import { expect, test } from "bun:test";
import type { BoardView } from "@openboard/ports";
import { oidcVerifier } from "../../src/auth/oidc.ts";
import { BOARD_URL, NOW } from "../support/app.ts";

function issuerAt(at: number) {
  return `https://issuer-${at}.example`;
}

function fixture(read: (issuer: string) => Promise<null>) {
  let now = NOW;
  const verifier = oidcVerifier(
    {
      now: () => now,
      log: { info() {}, error() {} },
      residentBytes: () => 0,
      requestId: () => "test-request",
      schedule: () => () => {},
      randomBytes: (length) => new Uint8Array(length),
      resolveHost: async () => ["8.8.8.8"],
      fetch: async () => {
        throw new Error("a lost lease must never fetch");
      },
    },
    { url: "https://builtin.example", identify: () => null },
    { readOidcKeys: read, reserveOidcReload: async () => false, finishOidcReload: async () => {} },
  );
  return {
    advance: (ms: number) => {
      now += ms;
    },
    verify(issuer: string) {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const header = encode({ alg: "RS256", kid: "first" });
      const payload = encode({ iss: issuer, aud: BOARD_URL, exp: NOW / 1000 + 3600 });
      const request = new Request(BOARD_URL, { headers: { authorization: `Bearer ${header}.${payload}.fixture` } });
      const board = {
        listGrants: async () => [{ principals: [{ kind: "oidc", issuer, claims: {} }] }],
      } as Pick<BoardView, "listGrants">;
      return verifier.verify(request, board as BoardView, "getMe", BOARD_URL);
    },
  };
}

test("OIDC waits one second to read shared keys again after losing the reload lease", async () => {
  let reads = 0;
  const { advance, verify } = fixture(async () => {
    reads++;
    return null;
  });
  await verify(issuerAt(0));
  advance(999);
  await verify(issuerAt(0));
  expect(reads).toBe(1);
  advance(1);
  await verify(issuerAt(0));
  expect(reads).toBe(2);
});

test("OIDC cache caps issuers at 128 and keeps their in-flight refreshes", async () => {
  const loads = Array.from({ length: 128 }, () => Promise.withResolvers<null>());
  const full = Promise.withResolvers<void>();
  let reads = 0;
  const { advance, verify } = fixture(async (issuer) => {
    reads++;
    if (reads === loads.length) full.resolve();
    return loads.find((_, at) => issuerAt(at) === issuer)?.promise ?? null;
  });
  const pending = loads.map((_, at) => verify(issuerAt(at)));
  try {
    await full.promise;
    const overflow = issuerAt(loads.length);
    expect(await verify(overflow)).toBeNull();
    expect(reads).toBe(128);

    const joined = verify(issuerAt(1));
    loads[0]?.resolve(null);
    await pending[0];
    expect(await verify(overflow)).toBeNull();
    expect(await verify(issuerAt(0))).toBeNull();
    expect(reads).toBe(128);

    advance(1_000);
    expect(await verify(overflow)).toBeNull();
    expect(reads).toBe(129);

    loads[1]?.resolve(null);
    expect(await joined).toBeNull();
    expect(reads).toBe(129);
  } finally {
    for (const load of loads) load.resolve(null);
    await Promise.all(pending);
  }
});
