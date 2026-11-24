import type { GrantPrincipal } from "@openboard/contract";

export interface OidcPrincipal {
  readonly kind: "oidc";
  readonly issuer: string;
  readonly claims: Readonly<Record<string, unknown>>;
}

export function matchesOidcClaims(grant: Extract<GrantPrincipal, { kind: "oidc" }>, token: OidcPrincipal): boolean {
  return (
    grant.issuer === token.issuer &&
    Object.entries(grant.claims).every(([name, allowed]) => {
      if (!Object.hasOwn(token.claims, name)) return false;
      const actual = token.claims[name];
      if (typeof actual !== "string" && typeof actual !== "number" && typeof actual !== "boolean") return false;
      return [allowed]
        .flat()
        .some((value) =>
          name === "sub" && value.endsWith("*")
            ? typeof actual === "string" && actual.startsWith(value.slice(0, -1))
            : value === String(actual),
        );
    })
  );
}
