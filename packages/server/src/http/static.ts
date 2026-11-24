import { webAssets } from "../web/assets.ts";
import { notFound } from "./scope.ts";

const RESERVED = /^\/(?:api|mcp|auth|healthz|readyz)(?:\/|$)/;
const ENCODINGS = [
  { name: "br", suffix: ".br" },
  { name: "gzip", suffix: ".gz" },
] as const;

function encodings(value: string) {
  const priorities = new Map<string, number>();
  for (const entry of value.toLowerCase().split(",")) {
    const [name, parameter] = entry.trim().split(/\s*;\s*/, 2);
    if (!name) continue;
    const quality = parameter === undefined ? 1 : Number(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(parameter)?.[1]);
    if (Number.isFinite(quality)) priorities.set(name, quality);
  }
  const qualityOf = (name: string) => priorities.get(name) ?? priorities.get("*") ?? 0;
  const identity = priorities.get("identity") ?? (priorities.get("*") === 0 ? 0 : 1);
  return {
    preferred: ENCODINGS.filter(({ name }) => qualityOf(name) > 0)
      .filter(({ name }) => !priorities.has("identity") || qualityOf(name) >= identity)
      .sort((a, b) => qualityOf(b.name) - qualityOf(a.name)),
    identity,
  };
}

export function staticFiles(directory?: string) {
  const read = webAssets(directory);
  async function respond(request: Request, path: string): Promise<Response> {
    const asset = path === "/assets" || path.startsWith("/assets/");
    // The URL never becomes a filesystem path unless all components are filename-safe.
    if (asset && !/^\/assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_-][a-z0-9_.-]*$/i.test(path)) throw notFound();
    if (asset && /\.(br|gz)$/i.test(path)) throw notFound();
    const name = asset ? path.slice(1) : "index.html";
    let body = await read(name);
    if (!body) {
      if (asset) throw notFound();
      return new Response(request.method === "HEAD" ? null : "The front is unavailable. Run bun run dev for Vite.\n", {
        status: 404,
        headers: { "cache-control": "no-cache", "content-type": "text/plain; charset=utf-8" },
      });
    }
    const headers = new Headers({
      "cache-control": asset ? "public, max-age=31536000, immutable" : "no-cache",
      "content-type": Bun.file(name).type,
      vary: "Accept-Encoding",
    });
    const { preferred, identity } = encodings(request.headers.get("accept-encoding") ?? "");
    for (const { name: coding, suffix } of preferred) {
      const compressed = await read(name + suffix);
      if (!compressed) continue;
      body = compressed;
      headers.set("content-encoding", coding);
      break;
    }
    if (identity === 0 && !headers.has("content-encoding")) {
      return new Response(null, { status: 406, headers: { vary: "Accept-Encoding" } });
    }
    headers.set("content-length", String(body.size));
    return new Response(request.method === "HEAD" ? null : body, { headers });
  }
  return (request: Request, path: string): Promise<Response> | undefined => {
    if (request.method !== "GET" && request.method !== "HEAD") return;
    if (RESERVED.test(path)) return;
    return respond(request, path);
  };
}
