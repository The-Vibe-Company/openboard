import type { Operation } from "@openboard/contract";

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

/** Every answer under `/api` is JSON, never HTML and never a redirect (D8). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_TYPE });
}

export function operationResponse({ status }: Operation, output: unknown): Response {
  if (typeof status !== "object") return json(output, status ?? 200);
  const created = typeof output === "object" && output !== null && Reflect.get(output, status.createdWhen) === true;
  return json(output, created ? 201 : 200);
}
