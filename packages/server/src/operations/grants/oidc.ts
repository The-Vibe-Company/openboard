import { BoardError, type GrantPrincipal } from "@openboard/contract";
import type { BoardGrantWriter } from "@openboard/ports";
import { publicHttps } from "../../public-host.ts";

export function validateGrantIssuers(principals: readonly GrantPrincipal[]) {
  for (const grant of principals) {
    if (grant.kind !== "oidc") continue;
    const url = URL.parse(grant.issuer);
    if (!url || !publicHttps(url) || !grant.issuer.startsWith("https://")) {
      throw new BoardError("invalid_grant", "an oidc issuer needs a public HTTPS hostname on port 443");
    }
  }
}

export async function checkIssuerLimit(writer: BoardGrantWriter, principals: readonly GrantPrincipal[], replacing = 0) {
  const issuers = new Set(principals.flatMap((principal) => (principal.kind === "oidc" ? [principal.issuer] : [])));
  if (!issuers.size) return;
  for (const issuer of await writer.otherGrantIssuers(replacing)) issuers.add(issuer);
  if (issuers.size > 8)
    throw new BoardError("invalid_grant", "an organization can grant access to at most 8 OIDC issuers");
}
