/** Request admission control. */
export interface RateLimits {
  /** Consumes one organization write or returns the number of seconds before it can be retried. */
  takeWrite(org: string): number | undefined;
  /** Consumes one refresh for an agent on this instance or returns the retry delay in seconds. */
  takeRefresh(agent: string): number | undefined;
  /** Reserves a stream on this instance and returns its release callback, or declines at capacity. */
  reserveStream(org: string, principal: string): (() => void) | undefined;
  /** Reserves space for one signed request body on this instance. */
  reserveInbound(ip: string | undefined): (() => void) | undefined;
  /** Consumes a browser sign-in attempt or returns the retry delay in seconds. */
  takeSignIn(ip: string | undefined): Promise<number | undefined>;
  /** Reserves a check, or returns retry seconds. Finishing debits the bucket only for an unauthorized result. */
  admitAuth(ip: string): Promise<number | ((failed: boolean) => void)>;
}
