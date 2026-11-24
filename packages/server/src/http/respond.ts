import type { Operation } from "@openboard/contract";

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_TYPE });
}

export function operationResponse({ responseType, status }: Operation, output: unknown): Response {
  const created =
    typeof status === "object" &&
    typeof output === "object" &&
    output !== null &&
    Reflect.get(output, status.createdWhen) === true;
  const code = typeof status === "object" ? (created ? 201 : 200) : (status ?? 200);
  if (responseType === undefined) return json(output, code);
  if (typeof output !== "string") throw new TypeError("expected a string response body");
  return new Response(output, {
    status: code,
    headers: {
      "content-type": responseType,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
