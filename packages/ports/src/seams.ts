/** Admission control for requests scoped to a tenant. */
export interface RateLimits {
  /** Consumes one organization write or returns the number of seconds before it can be retried. */
  takeWrite(org: string): number | undefined;
}
