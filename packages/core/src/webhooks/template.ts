const encoder = new TextEncoder();

function resolvePath(payload: object, path: string): unknown {
  let value: unknown = payload;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return null;
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value ?? null;
}

function renderString(text: string, payload: object, byteLimit: number): string | null {
  const placeholders = text.matchAll(/\{\{([\w-]+(?:\.[\w-]+)*)\}\}/g);
  let rendered = "";
  let end = 0;
  for (const match of placeholders) {
    const [placeholder, path] = match;
    if (path === undefined) continue;
    const value = resolvePath(payload, path);
    if (placeholder === text) return JSON.stringify(value);
    rendered +=
      text.slice(end, match.index) + (value === null ? "" : typeof value === "string" ? value : JSON.stringify(value));
    // A UTF-16 code unit needs at least one byte in the final JSON.
    if (rendered.length > byteLimit) return null;
    end = match.index + placeholder.length;
  }
  return JSON.stringify(rendered + text.slice(end));
}

export function renderWebhookTemplate(template: object, payload: object, byteLimit: number): string | null {
  const json = JSON.stringify(template);
  let body = "";
  let remaining = byteLimit;
  let end = 0;
  // Match whole JSON string tokens. A following colon marks an object key.
  for (const match of json.matchAll(/"(?:[^"\\]|\\.)*"(:)?/g)) {
    const [token, colon] = match;
    if (colon || !token.includes("{{")) continue;
    const literal = json.slice(end, match.index);
    remaining -= encoder.encode(literal).length;
    if (remaining < 0) return null;
    const replacement = renderString(JSON.parse(token), payload, remaining);
    if (replacement === null) return null;
    remaining -= encoder.encode(replacement).length;
    if (remaining < 0) return null;
    body += literal + replacement;
    end = match.index + token.length;
  }
  const rest = json.slice(end);
  return encoder.encode(rest).length <= remaining ? body + rest : null;
}
