import { BoardError, WebhookEventPayloadV1 } from "@openboard/contract";

const placeholderPath = /\{\{([\w-]+(?:\.[\w-]+)*)\}\}/g;
const arrayIndex = /^(0|[1-9][0-9]*)$/;

interface PathSchema {
  readonly type?: string;
  readonly [keyword: string]: unknown;
  readonly anyOf?: readonly PathSchema[];
  readonly properties?: Readonly<Record<string, PathSchema>>;
  readonly patternProperties?: Readonly<Record<string, PathSchema>>;
  readonly items?: PathSchema;
}

function children(schema: PathSchema, key: string): PathSchema[] {
  if (schema.anyOf) return schema.anyOf.flatMap((variant) => children(variant, key));
  const property = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
  if (property) return [property];
  if (schema.patternProperties) {
    return Object.entries(schema.patternProperties)
      .filter(([pattern]) => new RegExp(pattern).test(key))
      .map(([, value]) => value);
  }
  if (schema.items && arrayIndex.test(key)) return [schema.items];
  // TypeBox Unknown has no JSON Schema type and permits any descendant.
  return schema.type === undefined ? [schema] : [];
}

function propertyNames(schema: PathSchema): string[] {
  return schema.anyOf?.flatMap(propertyNames) ?? Object.keys(schema.properties ?? {});
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    let diagonal = i;
    let previous = i + 1;
    row[0] = previous;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j] ?? Infinity;
      previous = Math.min(previous + 1, above + 1, diagonal + Number(left[i] !== right[j - 1]));
      row[j] = previous;
      diagonal = above;
    }
  }
  return row[right.length] ?? Infinity;
}

function descend(schemas: readonly PathSchema[], key: string): PathSchema[] {
  return schemas.flatMap((schema) => children(schema, key));
}

function closestPath(prefix: readonly string[], key: string, suffix: string[], schemas: readonly PathSchema[]): string {
  const candidates = [...new Set(schemas.flatMap(propertyNames))]
    .map((name) => ({ name, distance: editDistance(key, name) }))
    .sort((a, b) => a.distance - b.distance);
  // Keep the suffix when correcting one segment makes the entire path valid.
  const complete = candidates.find(({ name }) => suffix.reduce(descend, descend(schemas, name)).length > 0);
  if (complete) return [...prefix, complete.name, ...suffix].join(".");
  const nearest = candidates[0];
  return (nearest ? [...prefix, nearest.name] : prefix).join(".");
}

function validatePath(path: string): void {
  let schemas: PathSchema[] = [WebhookEventPayloadV1];
  const keys = path.split(".");
  for (const [index, key] of keys.entries()) {
    const next = descend(schemas, key);
    if (next.length === 0) {
      const suggestion = closestPath(keys.slice(0, index), key, keys.slice(index + 1), schemas);
      throw new BoardError(
        "invalid_request",
        `unknown webhook template path "${path}"; closest valid path is "${suggestion}"`,
      );
    }
    schemas = next;
  }
}

function validateString(text: string): void {
  // Validate syntax separately from substitution so closed literal expressions keep their existing behavior.
  let openings = 0;
  for (const [delimiter] of text.matchAll(/\{\{|\}\}/g)) {
    openings = delimiter === "{{" ? openings + 1 : Math.max(0, openings - 1);
  }
  if (openings > 0) throw new BoardError("invalid_request", "unclosed {{ in webhook body template");
  for (const [, path] of text.matchAll(placeholderPath)) {
    if (path !== undefined) validatePath(path);
  }
}

export function validateWebhookTemplate(template: object): void {
  const pending: unknown[] = [template];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") validateString(value);
    else if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push(child);
    }
  }
}

const encoder = new TextEncoder();

export function resolvePath(payload: object, path: readonly string[]): unknown {
  let value: unknown = payload;
  for (const key of path) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    if (Array.isArray(value) && !arrayIndex.test(key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function textValue(value: unknown): string {
  return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
}

export function renderTemplateText(
  parts: readonly (string | { path: string[] })[],
  payload: object,
  limit: number,
): { text: string; truncated: boolean } | null {
  let text = "";
  for (const part of parts) {
    let value: string;
    try {
      value = typeof part === "string" ? part : textValue(resolvePath(payload, part.path));
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
    const remaining = limit - text.length;
    text += value.slice(0, remaining);
    if (value.length > remaining) return { text, truncated: true };
  }
  return { text, truncated: false };
}

function renderString(text: string, payload: object, byteLimit: number): string | null {
  const placeholders = text.matchAll(placeholderPath);
  let rendered = "";
  let end = 0;
  for (const match of placeholders) {
    const [placeholder, path] = match;
    if (path === undefined) continue;
    const value = resolvePath(payload, path.split(".")) ?? null;
    if (placeholder === text) return JSON.stringify(value);
    rendered += text.slice(end, match.index) + textValue(value);
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
