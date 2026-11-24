/** Public signing keys and refresh reservations shared by every instance. */
export interface OidcKeyStore {
  reserveOidcReload(issuer: string, now: number, leaseUntil: number): Promise<boolean>;
  readOidcKeys(issuer: string, now: number): Promise<{ document: string; expiresAt: number } | null>;
  finishOidcReload(
    issuer: string,
    leaseUntil: number,
    completedAt: number,
    retryAt: number,
    loaded: { document: string; expiresAt: number } | null,
  ): Promise<void>;
}
