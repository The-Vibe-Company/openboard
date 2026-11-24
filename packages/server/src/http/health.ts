import manifest from "../../package.json" with { type: "json" };
import type { Pipeline } from "./pipeline.ts";

const READY_TIMEOUT_MS = 1_000;

/** Concurrent probes share an outstanding query so slow storage cannot build a queue of probe queries. */
export function readinessCheck(checkSchema: () => Promise<boolean>): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  return () => {
    pending ??= Promise.resolve()
      .then(checkSchema)
      .catch(() => false)
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

async function ready(pipeline: Pipeline): Promise<Response> {
  let ready = false;
  if (!pipeline.shutdown.aborted) {
    const deadline = Promise.withResolvers<boolean>();
    const stop = () => deadline.resolve(false);
    const cancel = pipeline.deps.schedule(READY_TIMEOUT_MS, stop);
    pipeline.shutdown.addEventListener("abort", stop, { once: true });
    try {
      ready = (await Promise.race([pipeline.schemaReady(), deadline.promise])) && !pipeline.shutdown.aborted;
    } finally {
      cancel();
      pipeline.shutdown.removeEventListener("abort", stop);
    }
  }
  return Response.json({ ready }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}

export function healthProbe(path: string, pipeline: Pipeline): Response | Promise<Response> | undefined {
  if (path === "/healthz") {
    return Response.json({ version: manifest.version }, { headers: { "cache-control": "no-store" } });
  }
  if (path === "/readyz") return ready(pipeline);
}
