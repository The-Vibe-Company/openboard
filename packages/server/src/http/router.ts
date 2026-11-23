import type { Method, Operation } from "@openboard/contract";

export interface Route<Op extends Operation = Operation> {
  readonly operation: Op;
  readonly method: Method;
  readonly segments: readonly string[];
}

export interface Matched<Op extends Operation = Operation> {
  readonly operation: Op;
  readonly params: Readonly<Record<string, string>>;
}

/** A path segment URL-decoded, or null for a malformed escape, which then names no route. */
function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * A path's segments. Trailing slashes are dropped, as upstream does (`pathname.replace(/\/+$/, "")`); an empty
 * segment anywhere else is kept, so `//messages` names no route instead of quietly becoming `/messages`.
 */
function split(path: string): string[] {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return [];
  return (trimmed.startsWith("/") ? trimmed.slice(1) : trimmed).split("/");
}

/** The static route table, built once per app from the contract (docs/codebase.md 4.2). */
export function routeTable<Op extends Operation>(operations: readonly Op[]): readonly Route<Op>[] {
  return operations.map((operation) => ({
    operation,
    method: operation.route.method,
    segments: split(operation.route.path),
  }));
}

/** The operation a method and a `BOARD_URL`-relative path name, with its path params decoded; null for none. */
export function matchRoute<Op extends Operation>(
  table: readonly Route<Op>[],
  method: string,
  path: string,
): Matched<Op> | null {
  const segments = split(path);
  for (const route of table) {
    if (route.method !== method || route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = route.segments.every((segment, at) => {
      const actual = segments[at] ?? "";
      if (!segment.startsWith(":")) return segment === actual;
      // Upstream's `([^/]+)` takes at least one character: an empty segment names no route.
      if (actual === "") return false;
      const decoded = decode(actual);
      if (decoded === null) return false;
      params[segment.slice(1)] = decoded;
      return true;
    });
    if (fits) return { operation: route.operation, params };
  }
  return null;
}
