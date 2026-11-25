import { BoardError } from "@openboard/contract";
import type { Deps, ServerConfig } from "../deps.ts";
import { publicAddress } from "../public-host.ts";

export const webhookTimeoutMs = 10_000;

export type TargetConfig = Pick<ServerConfig, "mode" | "publicUrl" | "webhookTargets">;

function invalid(message: string, reason: string): never {
  throw new BoardError("invalid_url", message, { reason });
}

function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$|\.$/g, "");
}

function addressOf(text: string): string | undefined {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(text) && URL.parse(`http://${text}`)?.hostname === text) return text;
  if (text.includes(":") && /^[a-f0-9:.]+$/i.test(text)) {
    const host = URL.parse(`http://[${text}]`)?.hostname;
    if (host) return bareHost(host);
  }
}

function loopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.");
}

function privateAddress(address: string): boolean {
  if (address.includes(":")) return /^f[cd][0-9a-f]{2}:/.test(address);
  const [a, b = 0] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function resolveAddresses(host: string, resolve: Deps["resolveHost"]): Promise<readonly string[]> {
  const literal = addressOf(host);
  if (literal) return [literal];
  try {
    return (await resolve?.(host)) ?? [];
  } catch {
    return invalid("webhook target DNS lookup failed", "dns");
  }
}

export function withDnsDeadline(resolve: Deps["resolveHost"], schedule: Deps["schedule"]): Deps["resolveHost"] {
  if (!resolve) return undefined;
  return async (host) => {
    const deadline = Promise.withResolvers<never>();
    const cancel = schedule(webhookTimeoutMs, () => deadline.reject(new Error("DNS lookup timed out")));
    const lookup = resolve(host);
    lookup.catch(() => {});
    try {
      return await Promise.race([lookup, deadline.promise]);
    } finally {
      cancel();
    }
  };
}

export async function webhookTarget(text: string, config: TargetConfig, resolve: Deps["resolveHost"]) {
  const url = URL.parse(text);
  if (!url?.hostname) return invalid("expected an absolute webhook URL with a host", "syntax");
  if (url.username || url.password) return invalid("webhook URLs cannot contain credentials", "credentials");
  if (url.hash) return invalid("webhook URLs cannot contain fragments", "fragment");
  const host = bareHost(url.hostname);
  const localHttp =
    config.mode === "local" && url.protocol === "http:" && (host === "localhost" || loopback(addressOf(host) ?? ""));
  if (url.protocol !== "https:" && !localHttp) return invalid("webhook targets require HTTPS", "scheme");
  const port = Number(url.port || 443);
  if (!localHttp && port !== 443 && !config.webhookTargets?.ports.includes(port)) {
    return invalid("webhook target port is not allowed", "port");
  }
  const own = new URL(config.publicUrl);
  if (bareHost(own.hostname) === host && (!localHttp || url.port === own.port)) {
    return invalid("webhook targets cannot use the board's public host", "service_host");
  }
  if (!localHttp && /(?:^|\.)(?:localhost|local|internal)$/.test(host)) {
    return invalid("webhook target uses a reserved hostname", "reserved_host");
  }
  // Normalize the hostname before using it for both the policy and TLS identity.
  if (url.hostname.endsWith(".")) url.hostname = host;
  const addresses = await resolveAddresses(host, resolve);
  const allowPrivate = config.webhookTargets?.hosts.includes(host);
  const checked: string[] = [];
  for (const answer of addresses) {
    const address = addressOf(answer);
    const allowed =
      address &&
      (localHttp
        ? loopback(address)
        : (!address.startsWith("::ffff:") && publicAddress(address)) || (allowPrivate && privateAddress(address)));
    if (!allowed) return invalid("webhook target resolves to a forbidden address", "address");
    checked.push(address);
  }
  if (!checked.length) return invalid("webhook target did not resolve to an address", "dns");
  return { url, addresses: checked };
}
