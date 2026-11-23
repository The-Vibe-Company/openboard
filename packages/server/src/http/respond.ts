const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

/** Every answer under `/api` is JSON, never HTML and never a redirect (D8). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_TYPE });
}
