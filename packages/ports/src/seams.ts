/** Request admission control. */
export interface RateLimits {
  /** Consumes one organization write or returns the number of seconds before it can be retried. */
  takeWrite(org: string): number | undefined;
  /** Reserves a check, or returns retry seconds. Finishing debits the bucket only for an unauthorized result. */
  admitAuth(ip: string): Promise<number | ((failed: boolean) => void)>;
}
