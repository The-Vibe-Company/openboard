import { timingSafeEqual } from "node:crypto";
import { BoardError, type getMetrics } from "@openboard/contract";
import type { Jobs } from "@openboard/ports";
import { bearer, hashToken } from "../../auth/secrets.ts";
import { notFound } from "../../http/scope.ts";
import type { Metrics } from "../../metrics.ts";
import type { Handler } from "../index.ts";

export interface MetricsContext {
  readonly metrics: Metrics;
  readonly dueMetrics: Jobs["dueMetrics"];
  readonly jobKinds: readonly string[];
  readonly now: () => number;
}

export function authorizeMetrics(request: Request, expected: string | undefined): void {
  if (expected === undefined) throw notFound();
  const token = bearer(request);
  if (
    !token ||
    /^ob[ctpl]_/.test(token) ||
    !timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(expected, "hex"))
  ) {
    throw new BoardError("unauthorized", "an operator bearer token is required");
  }
}

export const getMetricsHandler: Handler<typeof getMetrics> = async ({ metrics, dueMetrics, jobKinds, now }) => {
  const at = now();
  return metrics.render(await dueMetrics(jobKinds, at), at);
};
