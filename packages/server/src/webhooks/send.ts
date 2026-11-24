import type { Deps } from "../deps.ts";

async function drainResponse(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  let remaining = 8192;
  try {
    while (remaining > 0) {
      const next = await reader.read();
      if (next.done) return;
      remaining -= next.value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function sendWebhook(request: Request, { fetch, schedule }: Pick<Deps, "fetch" | "schedule">) {
  if (!fetch) return { status: null, error: "fetch_unavailable" };
  const controller = new AbortController();
  let status: number | null = null;
  const timeout = Promise.withResolvers<{ status: number | null; error: string }>();
  const cancel = schedule(10_000, () => {
    timeout.resolve({ status, error: "timeout" });
    controller.abort();
  });
  try {
    const send = async () => {
      const response = await fetch(new Request(request, { signal: controller.signal, redirect: "error" }));
      status = response.status;
      await drainResponse(response);
      return { status, error: null };
    };
    return await Promise.race([send(), timeout.promise]);
  } catch {
    return { status, error: status === null ? "request_failed" : "response_body_failed" };
  } finally {
    cancel();
  }
}
