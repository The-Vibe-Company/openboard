import type { Method, Operation } from "@openboard/contract";

interface Route<Op extends Operation = Operation> {
  readonly operation: Op;
  readonly segments: readonly string[];
}

type RouteBuckets<Op extends Operation> = Map<number, Route<Op>[]>;
export type RouteTable<Op extends Operation> = ReadonlyMap<string, ReadonlyMap<number, readonly Route<Op>[]>>;

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
export function routeTable<Op extends Operation>(operations: readonly Op[]): RouteTable<Op> {
  const table = new Map<Method, RouteBuckets<Op>>();
  for (const operation of operations) {
    const { method, path } = operation.route;
    const segments = split(path);
    const byLength = table.get(method) ?? new Map<number, Route<Op>[]>();
    const routes = byLength.get(segments.length) ?? [];
    routes.push({ operation, segments });
    byLength.set(segments.length, routes);
    table.set(method, byLength);
  }
  return table;
}

/** The operation a method and a `BOARD_URL`-relative path name, with its path params decoded; null for none. */
export function matchRoute<Op extends Operation>(
  table: RouteTable<Op>,
  method: string,
  path: string,
): Matched<Op> | null {
  const byLength = table.get(method);
  if (!byLength) return null;
  const segments = split(path);
  const routes = byLength.get(segments.length);
  if (!routes) return null;

  let decoded: (string | null | undefined)[] | undefined;
  for (const route of routes) {
    const fits = route.segments.every((segment, at) => {
      const actual = segments[at] ?? "";
      if (!segment.startsWith(":")) return segment === actual;
      // Upstream's `([^/]+)` requires at least one character.
      if (actual === "") return false;
      if (!actual.includes("%")) return true;
      decoded ??= [];
      if (decoded[at] === undefined) decoded[at] = decode(actual);
      return decoded[at] !== null;
    });
    if (!fits) continue;

    const params: Record<string, string> = {};
    route.segments.forEach((segment, at) => {
      if (segment.startsWith(":")) params[segment.slice(1)] = decoded?.[at] ?? segments[at] ?? "";
    });
    return { operation: route.operation, params };
  }
  return null;
}
