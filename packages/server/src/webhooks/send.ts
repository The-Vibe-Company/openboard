import { BoardError } from "@openboard/contract";
import type { Deps } from "../deps.ts";
import type { SignedWebhookRequest } from "./request.ts";
import { type TargetConfig, webhookTarget, webhookTimeoutMs } from "./target.ts";

const responseLimit = 8192;
type CheckedTarget = Awaited<ReturnType<typeof webhookTarget>>;
type Transport = NonNullable<Deps["webhookFetch"]>;

async function drainResponse(response: Response): Promise<void> {
  const { body } = response;
  if (!body) return;
  let reader: ReadableStreamBYOBReader;
  try {
    reader = body.getReader({ mode: "byob" });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Bun may expose buffered responses as default streams with unbounded chunk sizes.
    void body.cancel().catch(() => {});
    return;
  }

  let remaining = responseLimit;
  try {
    while (remaining > 0) {
      const next = await reader.read(new Uint8Array(remaining));
      if (next.done) return;
      remaining -= next.value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function refused(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ECONNREFUSED";
}

function transportError(error: unknown): "tls" | "request_failed" {
  const code = error instanceof Error && "code" in error ? error.code : null;
  // Bun fetch reports a failed TLS handshake as EPROTO.
  if (code === "EPROTO") return "tls";
  return typeof code === "string" &&
    /^(?:ERR_(?:TLS|SSL)_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|UNABLE_TO_(?:VERIFY_LEAF_SIGNATURE|GET_ISSUER_CERT))/.test(
      code,
    )
    ? "tls"
    : "request_failed";
}

async function fetchChecked(
  { url, addresses }: CheckedTarget,
  { headers, body }: SignedWebhookRequest,
  signal: AbortSignal,
  fetch: Transport,
): Promise<Response> {
  const endpoint = new URL(url);
  headers.set("host", url.host);
  headers.set("accept-encoding", "identity");
  for (const address of addresses) {
    signal.throwIfAborted();
    endpoint.hostname = address.includes(":") ? `[${address}]` : address;
    const request = new Request(endpoint.href, { method: "POST", body, headers, signal, redirect: "manual" });
    try {
      return await fetch(request, {
        proxy: false,
        redirect: "manual",
        keepalive: false,
        decompress: false,
        ...(url.protocol === "https:" && {
          tls: { serverName: url.hostname.replace(/^\[|\]$/g, ""), rejectUnauthorized: true },
        }),
      });
    } catch (error) {
      // A refused connection sent no POST. An ambiguous failure cannot be replayed here.
      if (!refused(error)) throw error;
    }
  }
  throw new Error("webhook target refused all connections");
}

export async function sendWebhook(
  target: string,
  config: TargetConfig,
  { webhookFetch, resolveHost, schedule }: Pick<Deps, "webhookFetch" | "resolveHost" | "schedule">,
  payload: SignedWebhookRequest,
) {
  if (!webhookFetch) return { status: null, retryAfter: null, error: "fetch_unavailable" };
  const controller = new AbortController();
  let status: number | null = null;
  let retryAfter: string | null = null;
  const timeout = Promise.withResolvers<{ status: number | null; error: string }>();
  const cancel = schedule(webhookTimeoutMs, () => {
    timeout.resolve({ status, error: "timeout" });
    controller.abort();
  });
  try {
    const send = async () => {
      const checked = await webhookTarget(target, config, resolveHost);
      const response = await fetchChecked(checked, payload, controller.signal, webhookFetch);
      status = response.status;
      retryAfter = response.headers.get("retry-after");
      await drainResponse(response);
      return { status, error: null };
    };
    const result = await Promise.race([send(), timeout.promise]);
    return { ...result, retryAfter };
  } catch (error) {
    if (error instanceof BoardError && error.code === "invalid_url" && error.reason !== "dns")
      return { status: null, retryAfter: null, error: "invalid_url" };
    return { status, retryAfter, error: status === null ? transportError(error) : "response_body_failed" };
  } finally {
    cancel();
  }
}
