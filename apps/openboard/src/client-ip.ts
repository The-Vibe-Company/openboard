import { isIP } from "node:net";

/** Resolve a client IP using only the configured suffix of the forwarded chain. */
export function clientIp(headers: Headers, peer: string | undefined, trustedProxies: number): string | undefined {
  if (peer === undefined || trustedProxies === 0) return peer;
  const chain = headers.get("x-forwarded-for")?.split(",");
  const address = chain?.at(-trustedProxies)?.trim();
  if (!address) return peer;
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6 && !address.includes("%")) return new URL(`http://[${address}]`).hostname.slice(1, -1);
  return peer;
}
