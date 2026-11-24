import type { Instance } from "../drivers";

/** The board the workloads run on, and a token that may write there. */
export interface Board {
  readonly url: string;
  readonly token: string;
}

/** What one request cost: its time through the in-process handler and the statements its store ran. */
export interface Cost {
  readonly ms: number;
  readonly statements: number;
}

/**
 * Sends one request to `instance` on `board` with its token and measures it, body read included. A status other than
 * `expected` throws: a failing workload measures nothing.
 */
export async function send(
  instance: Instance,
  board: Board,
  request: { readonly method: string; readonly path: string; readonly body?: unknown; readonly expected: number },
): Promise<{ readonly cost: Cost; readonly body: unknown }> {
  const headers: Record<string, string> = { authorization: `Bearer ${board.token}` };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method: request.method, headers };
  if (request.body !== undefined) init.body = JSON.stringify(request.body);
  const before = instance.statements.statements;
  const started = performance.now();
  const response = await instance.app.fetch(new Request(`${board.url}${request.path}`, init));
  const body: unknown = await response.json();
  const ms = performance.now() - started;
  if (response.status !== request.expected) {
    throw new Error(`${request.method} ${request.path} answered ${response.status}, not ${request.expected}`);
  }
  return { cost: { ms, statements: instance.statements.statements - before }, body };
}

/** The nearest-rank percentile `p` (0 to 100) of `values`, which must not be empty. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("no values to take a percentile of");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}
