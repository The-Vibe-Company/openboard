import { BoardError } from "@openboard/contract";
import type { Deps } from "../deps.ts";
import type { SignedWebhookRequest } from "./request.ts";
import { type TargetConfig, webhookTarget, webhookTimeoutMs } from "./target.ts";

const responseLimit = 8192;
type CheckedTarget = Awaited<ReturnType<typeof webhookTarget>>;
type Transport = NonNullable<Deps["webhookFetch"]>;
type Preparation = { payload: SignedWebhookRequest } | { error: string };
type PrepareSend = SignedWebhookRequest | ((signal: AbortSignal) => Promise<Preparation>);

function prepareSend(prepare: PrepareSend, signal: AbortSignal) {
  signal.throwIfAborted();
  return typeof prepare === "function" ? prepare(signal) : { payload: prepare };
}

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
  prepare: PrepareSend,
  signal: AbortSignal,
  fetch: Transport,
): Promise<Response | { error: string }> {
  const endpoint = new URL(url);
  for (const address of addresses) {
    const prepared = await prepareSend(prepare, signal);
    if ("error" in prepared) return prepared;
    signal.throwIfAborted();
    const { headers, body } = prepared.payload;
    headers.set("host", url.host);
    headers.set("accept-encoding", "identity");
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
  prepare: PrepareSend,
  remainingLeaseMs = webhookTimeoutMs,
) {
  const timeoutMs = Math.min(webhookTimeoutMs, remainingLeaseMs);
  if (timeoutMs <= 0) return { status: null, retryAfter: null, error: "timeout" };
  if (!webhookFetch) return { status: null, retryAfter: null, error: "fetch_unavailable" };
  const controller = new AbortController();
  let status: number | null = null;
  let retryAfter: string | null = null;
  const timeout = Promise.withResolvers<{ status: number | null; error: string }>();
  const cancel = schedule(timeoutMs, () => {
    timeout.resolve({ status, error: "timeout" });
    controller.abort();
  });
  try {
    const send = async () => {
      const checked = await webhookTarget(target, config, resolveHost).then(
        (target) => ({ target }),
        (failure: unknown) => ({ failure }),
      );
      if ("failure" in checked) {
        const prepared = await prepareSend(prepare, controller.signal);
        if ("error" in prepared) return { status: null, error: prepared.error };
        throw checked.failure;
      }
      const response = await fetchChecked(checked.target, prepare, controller.signal, webhookFetch);
      if ("error" in response) return { status: null, error: response.error };
      status = response.status;
      retryAfter = response.headers.get("retry-after");
      await drainResponse(response);
      return { status, error: null };
    };
    const inflight = send();
    inflight.catch(() => {});
    const result = await Promise.race([inflight, timeout.promise]);
    return { ...result, retryAfter };
  } catch (error) {
    if (error instanceof BoardError && error.code === "invalid_url" && error.reason !== "dns")
      return { status: null, retryAfter: null, error: "invalid_url" };
    return { status, retryAfter, error: status === null ? transportError(error) : "response_body_failed" };
  } finally {
    cancel();
  }
}
