import type { CanInput, GrantLevel, GrantView, Role } from "@openboard/contract";

export interface PersonGrant {
  readonly id: string;
  readonly level: GrantLevel;
  readonly can: CanInput;
  readonly capped: boolean;
}

export interface BoardGrantReads {
  /** The board's active grants naming this member, their linked identity, or all users. */
  personGrants(personId: string): Promise<PersonGrant[]>;
  /** Every unrevoked grant on the board, oldest first, with the starting grants g1 to g3 that no row holds. */
  listGrants(): Promise<GrantView[]>;
}

export interface BoardGrantWriter extends Pick<BoardGrantReads, "listGrants"> {
  /** Active issuers elsewhere in this organization, read under the issuer quota lock. */
  otherGrantIssuers(replacing: number): Promise<string[]>;
  /** The next grant number, read under the board's write lock. */
  nextGrant(): Promise<number>;
  /** Find an active grant under the board write lock. */
  activeGrant(id: number): Promise<GrantView | null>;
  /** The caller's current membership and board grants inside the same transaction as a grant change. */
  grantMember(personId: string): Promise<{ role: Role; grants: PersonGrant[] } | null>;
}
