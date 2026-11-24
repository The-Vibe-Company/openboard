import type { GrantPrincipal, GrantView } from "@openboard/contract";

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

/** Keep only authenticated workload attributes needed for grant matching. */
export function grantMatchingClaims(grantViews: readonly GrantView[], workload: OidcPrincipal): OidcPrincipal {
  const keys = new Set(["sub"]);
  for (const { principals } of grantViews) {
    for (const grant of principals) {
      if (grant.kind !== "oidc" || !matchesOidcClaims(grant, workload)) continue;
      for (const key of Object.keys(grant.claims)) keys.add(key);
    }
  }
  const claims = Object.fromEntries(Object.entries(workload.claims).filter(([key]) => keys.has(key)));
  return { kind: "oidc", issuer: workload.issuer, claims };
}
