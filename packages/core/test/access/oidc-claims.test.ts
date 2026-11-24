import { expect, test } from "bun:test";
import { type OidcPrincipal, matchesOidcClaims } from "../../src/index.ts";

test("OIDC grants require every claim, with alternatives within each claim", () => {
  const issuer = "https://issuer.example";
  const grant = {
    kind: "oidc" as const,
    issuer,
    claims: { sub: ["project:acme/*", "admin"], project_id: ["41", "42"] },
  };
  const token: OidcPrincipal = { kind: "oidc", issuer, claims: { sub: "project:acme/api", project_id: 42 } };
  expect(matchesOidcClaims(grant, token)).toBe(true);
  expect(matchesOidcClaims(grant, { ...token, claims: { sub: "admin", project_id: "41" } })).toBe(true);
  expect(matchesOidcClaims(grant, { ...token, issuer: "https://other.example" })).toBe(false);
  for (const claims of [
    { sub: "project:acme-other/api", project_id: 42 },
    { sub: "ADMIN", project_id: 42 },
    { sub: "admin" },
    { sub: "admin", project_id: [42] },
    { sub: "admin", project_id: "43" },
  ])
    expect(matchesOidcClaims(grant, { ...token, claims })).toBe(false);
});
