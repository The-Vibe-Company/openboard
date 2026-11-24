import type { Deps } from "./deps.ts";

export function publicHttps(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.port &&
    !url.username &&
    !url.password &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(url.hostname) &&
    url.hostname.length <= 253 &&
    !/\.(?:localhost|local|internal|test|invalid|onion|home|arpa)$/i.test(url.hostname)
  );
}

function publicV4(address: string): boolean {
  const canonical = URL.parse(`http://${address}`)?.hostname;
  if (canonical !== address || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
}

export function publicAddress(address: string): boolean {
  if (!address.includes(":")) return publicV4(address);
  const canonical = URL.parse(`http://[${address}]`)?.hostname.slice(1, -1);
  if (!canonical) return false;
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const high = Number.parseInt(mapped[1] ?? "", 16);
    const low = Number.parseInt(mapped[2] ?? "", 16);
    return publicV4([high >> 8, high & 255, low >> 8, low & 255].join("."));
  }
  // Permit global unicast only, excluding IETF special-purpose, transition and documentation ranges.
  const [first = "", second = ""] = canonical.split(":");
  const prefix = Number.parseInt(first, 16);
  return (
    prefix >= 0x2000 &&
    prefix < 0x4000 &&
    prefix !== 0x2002 &&
    !(prefix === 0x2001 && (second === "db8" || Number.parseInt(second || "0", 16) < 0x200)) &&
    prefix !== 0x3ffe &&
    prefix !== 0x3fff
  );
}

export async function resolvesPublicly(url: URL, resolve: NonNullable<Deps["resolveHost"]>): Promise<boolean> {
  if (!publicHttps(url)) return false;
  const addresses = await resolve(url.hostname);
  return addresses.length > 0 && addresses.every(publicAddress);
}
